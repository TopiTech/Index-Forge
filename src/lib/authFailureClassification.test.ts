/**
 * W-01 / W-04: 認証失敗の分類契約。
 *
 * - D1 が読めない (認証情報ストア障害) のみで「パスワードが正しくありません」
 *   (401) に潰さない: 503 + 共通メッセージで返す。
 * - パスワード認証のレートリミット拒否を 401 に分類しない: ミューテーション系
 *   (POST /api/indices, POST/DELETE /api/indices/stock, POST /api/sync-prices
 *   force, PUT /api/admin/admin-password の現行PW再確認) は 429 を返す。
 * - 既存指数のオーナートークン編集は認証レートリミット下でも維持される。
 *
 * すべて worker.fetch の実エントリポイントから検証。429 は認証リミッタ固有の
 * メッセージ (AUTH_RATE_LIMIT_ERROR_MESSAGE) を要求し、入口リミッタ由来の429と
 * 混同しないことを保証する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  AUTH_RATE_LIMIT_ERROR_MESSAGE,
  AUTH_SERVICE_UNAVAILABLE_MESSAGE,
  clearAuthCache,
  clearMemoryRateLimits,
  hashPassword,
  hashToken,
  resetPasswordTableEnsured,
  verifyAdminSecretCode,
  verifyAdminSecretCodeDetailed,
} from "../../worker/internal-impl";
import type { Env } from "../../worker/internal-impl";

const TEST_ADMIN_PASSWORD = "test-master-admin-pwd-2026";
const TEST_SECRET_CODE = "custom-admin-secret-999";

type RouteDecision =
  | { kind: "all"; results: unknown[] }
  | { kind: "run"; changes?: number }
  | { kind: "throw"; error: Error };

/** `params` are the values bound to the statement, in order. */
type Router = (sql: string, params: unknown[]) => RouteDecision | undefined;

const SCHEMA_TABLES = [
  "access_passwords",
  "admin_login_attempts",
  "admin_sessions",
  "basket_items",
  "benchmark_cache",
  "indices",
  "rate_limits",
  "sync_logs",
  "snapshot_cache",
  "stock_series",
  "sync_quota",
];

const SCHEMA_INDEXES = [
  "idx_rate_limits_window_start",
  "idx_sync_quota_day",
  "idx_indices_creator_id",
  "idx_admin_sessions_account_id",
  "idx_admin_sessions_expires_at",
];

function defaultRoute(sql: string): RouteDecision {
  if (sql.includes("FROM sqlite_master")) {
    return {
      kind: "all",
      results: [
        ...SCHEMA_TABLES.map((name) => ({ type: "table", name })),
        ...SCHEMA_INDEXES.map((name) => ({ type: "index", name })),
      ],
    };
  }
  if (sql.startsWith("PRAGMA table_info(access_passwords)")) {
    return {
      kind: "all",
      results: [
        "id",
        "name",
        "password_hash",
        "secret_code_hash",
        "role",
        "max_stocks",
        "max_indices",
        "is_active",
        "created_at",
        "updated_at",
      ].map((name) => ({ name })),
    };
  }
  if (sql.startsWith("PRAGMA table_info(indices)")) {
    return {
      kind: "all",
      results: [
        "id",
        "name",
        "description",
        "base_value",
        "sort_order",
        "owner_token_hash",
        "owner_token_issued_at",
        "creator_id",
        "created_at",
      ].map((name) => ({ name })),
    };
  }
  if (sql.includes("FROM access_passwords WHERE id = 'admin-master'")) {
    return { kind: "all", results: [] };
  }
  if (sql.includes("FROM access_passwords WHERE is_active = 1")) {
    return { kind: "all", results: [] };
  }
  if (sql.includes("FROM admin_login_attempts")) {
    return { kind: "all", results: [] };
  }
  if (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) {
    return { kind: "all", results: [] };
  }
  return { kind: "run", changes: 1 };
}

/**
 * Routing mock D1. `router` overrides the default answers per test; every
 * executed statement is logged (with its bound parameters) so a test can
 * assert which writes happened (e.g. "the lockout counter was not touched").
 */
function createMockDb(router: Router = () => undefined) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const decide = (sql: string, params: unknown[]): RouteDecision => {
    executed.push({ sql, params });
    return router(sql, params) ?? defaultRoute(sql);
  };
  const makeStatement = (sql: string) => {
    let params: unknown[] = [];
    const execAll = async () => {
      const decision = decide(sql, params);
      if (decision.kind === "throw") throw decision.error;
      if (decision.kind === "all") return { results: decision.results, success: true };
      return { results: [], success: true, meta: { changes: decision.changes ?? 1 } };
    };
    const execRun = async () => {
      const decision = decide(sql, params);
      if (decision.kind === "throw") throw decision.error;
      return { success: true, meta: { changes: decision.kind === "run" ? (decision.changes ?? 1) : 1 } };
    };
    const statement = {
      bind: (...args: unknown[]) => {
        params = args;
        return statement;
      },
      all: execAll,
      run: execRun,
    };
    return statement;
  };
  const db = {
    prepare(sql: string) {
      return makeStatement(sql);
    },
    batch: async (statements: unknown[]) => {
      decide("-- batch --", []);
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  return { db: db as unknown as Env["DB"], executed };
}

function createEnv(db: Env["DB"], overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response(null) } as unknown as Env["ASSETS"],
    DB: db,
    ...overrides,
  };
}

/**
 * Refuse only the password-auth limiter for `endpoint`, identified by the
 * bound endpoint name (`params[1]` of the rate_limits INSERT). The endpoint
 * entry limiters ("indices", "indices-stock", "sync-prices", ...) share that
 * table, so SQL text alone cannot tell the two apart — and a call-order
 * counter is race-prone because the limiter's probabilistic purge runs
 * concurrently. Refusing exactly one limiter keeps the entry checks passing.
 */
function denyRateLimit(endpoint: string): Router {
  return (sql, params) =>
    sql.includes("INSERT INTO rate_limits") && params[1] === endpoint
      ? { kind: "run", changes: 0 }
      : undefined;
}

/** The credential store cannot be read (any access_passwords query fails). */
function brokenAuthStore(sql: string): RouteDecision | undefined {
  return sql.includes("FROM access_passwords")
    ? { kind: "throw", error: new Error("D1_STORAGE_UNAVAILABLE") }
    : undefined;
}

/** A stubbed Turnstile siteverify that always accepts. */
function stubTurnstileSuccess(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

describe("W-01: D1障害は認証エラーに潰さない (503)", () => {
  beforeEach(() => {
    clearAuthCache();
    resetPasswordTableEnsured();
    clearMemoryRateLimits();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("/api/auth/verify: 認証ストア読取不能は503で、401『パスワードが正しくありません』にはならない", async () => {
    const { db } = createMockDb((sql) => brokenAuthStore(sql));

    const res = await worker.fetch(
      new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "whatever-password" }),
      }),
      createEnv(db),
    );

    expect(res.status).toBe(503);
    const data = (await res.json()) as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe(AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    expect(data.error).not.toBe("パスワードが正しくありません");
  });

  it("/api/auth/verify: 誤ったパスワードは従来どおり401 (回帰)", async () => {
    const { db } = createMockDb();

    const res = await worker.fetch(
      new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" }),
      }),
      createEnv(db),
    );

    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("パスワードが正しくありません");
  });

  it("/api/auth/verify: 認証レートリミットは従来どおり429 (回帰)", async () => {
    const { db } = createMockDb(denyRateLimit("auth-login"));

    const res = await worker.fetch(
      new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" }),
      }),
      createEnv(db),
    );

    expect(res.status).toBe(429);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe(AUTH_RATE_LIMIT_ERROR_MESSAGE);
  });

  it("verifyAdminSecretCodeDetailed: D1障害は unavailable、互換ラッパーは false に畳む", async () => {
    const { db } = createMockDb((sql) =>
      sql.includes("SELECT secret_code_hash")
        ? { kind: "throw", error: new Error("D1_STORAGE_UNAVAILABLE") }
        : undefined,
    );
    const env = createEnv(db);

    const detailed = await verifyAdminSecretCodeDetailed(env, TEST_SECRET_CODE);
    expect(detailed.valid).toBe(false);
    expect(detailed.unavailable).toBe(true);

    // 互換契約: boolean ラッパーは false (既存呼び出し元の挙動は変わらない)
    expect(await verifyAdminSecretCode(env, TEST_SECRET_CODE)).toBe(false);
  });

  it("verifyAdminSecretCodeDetailed: 空コードは検証不能ではなく不正入力 (unavailable なし)", async () => {
    const { db } = createMockDb();
    const env = createEnv(db);

    const result = await verifyAdminSecretCodeDetailed(env, "   ");
    expect(result.valid).toBe(false);
    expect(result.unavailable).toBeUndefined();
  });

  it("POST /api/auth/admin-login: 秘密の暗号照合のD1障害は503でロックアウト予算を消費しない", async () => {
    stubTurnstileSuccess();
    const { db, executed } = createMockDb((sql) =>
      sql.includes("SELECT secret_code_hash")
        ? { kind: "throw", error: new Error("D1_STORAGE_UNAVAILABLE") }
        : undefined,
    );
    const env = createEnv(db);

    const res = await worker.fetch(
      new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: TEST_SECRET_CODE,
          turnstileToken: "test-token",
        }),
      }),
      env,
    );

    expect(res.status).toBe(503);
    const data = (await res.json()) as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe(AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    // 障害は推測ではない: ロックアウトカウンタを進めない
    expect(executed.some((entry) => entry.sql.includes("INSERT INTO admin_login_attempts"))).toBe(
      false,
    );
  });

  it("POST /api/auth/admin-login: パスワード照合のD1障害は503で失敗カウントを増やさない", async () => {
    stubTurnstileSuccess();
    const secretHash = await hashPassword(TEST_SECRET_CODE);
    const { db, executed } = createMockDb((sql) => {
      if (sql.includes("SELECT secret_code_hash")) {
        return { kind: "all", results: [{ secret_code_hash: secretHash }] };
      }
      if (sql.includes("password_hash, role, max_stocks, is_active")) {
        return { kind: "throw", error: new Error("D1_STORAGE_UNAVAILABLE") };
      }
      return undefined;
    });
    const env = createEnv(db);

    const res = await worker.fetch(
      new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "whatever-password",
          secretCode: TEST_SECRET_CODE,
          turnstileToken: "test-token",
        }),
      }),
      env,
    );

    expect(res.status).toBe(503);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe(AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    expect(executed.some((entry) => entry.sql.includes("INSERT INTO admin_login_attempts"))).toBe(
      false,
    );
  });

  it("PUT /api/admin/admin-secret-code: 現行コード照合のD1障害は401ではなく503", async () => {
    const adminHash = await hashPassword(TEST_ADMIN_PASSWORD);
    const { db } = createMockDb((sql) => {
      if (sql.includes("SELECT secret_code_hash")) {
        return { kind: "throw", error: new Error("D1_STORAGE_UNAVAILABLE") };
      }
      if (sql.includes("password_hash, role, max_stocks, is_active")) {
        return {
          kind: "all",
          results: [
            {
              id: "admin-master",
              name: "マスター管理者",
              password_hash: adminHash,
              role: "admin",
              max_stocks: null,
              is_active: 1,
            },
          ],
        };
      }
      return undefined;
    });
    const env = createEnv(db, { ADMIN_PASSWORD: TEST_ADMIN_PASSWORD });

    const res = await worker.fetch(
      new Request("http://localhost/api/admin/admin-secret-code", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          currentSecretCode: "whatever-code",
          newSecretCode: "brand-new-secret-2026",
        }),
      }),
      env,
    );

    expect(res.status).toBe(503);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe(AUTH_SERVICE_UNAVAILABLE_MESSAGE);
  });
});

describe("W-04: ミューテーション系の認証失敗分類 (429/503/401)", () => {
  beforeEach(() => {
    clearAuthCache();
    resetPasswordTableEnsured();
    clearMemoryRateLimits();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const validIndexBody = {
    name: "テスト指数",
    basket: [{ ticker: "7203", name: "トヨタ自動車", theme: "輸送用機器", weight: 100 }],
    password: "whatever-password",
  };

  it("POST /api/indices 新規作成: 認証レートリミットは401ではなく429", async () => {
    // エンドポイント入口 (indices) は通し、認証 (auth-api) のみ拒否される。
    const { db } = createMockDb(denyRateLimit("auth-api"));
    const env = createEnv(db);

    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validIndexBody),
      }),
      env,
    );

    expect(res.status).toBe(429);
    const data = (await res.json()) as { ok?: boolean; error: string };
    expect(data.ok).not.toBe(true);
    // 認証リミッタ固有のメッセージ: 入口リミッタの429と混同していない。
    expect(data.error).toBe(AUTH_RATE_LIMIT_ERROR_MESSAGE);
  });

  it("POST /api/indices 新規作成: 認証ストア読取不能は401ではなく503", async () => {
    const { db } = createMockDb((sql) => brokenAuthStore(sql));
    const env = createEnv(db);

    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validIndexBody),
      }),
      env,
    );

    expect(res.status).toBe(503);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe(AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    expect(data.error).not.toBe("指数の新規作成にはパスワード認証が必要です");
  });

  it("POST /api/indices: 既存指数のオーナートークン編集は認証レートリミット下でも成功する (後方互換)", async () => {
    const ownerToken = "a".repeat(48);
    const ownerTokenHash = await hashToken(ownerToken);
    const issuedAt = Math.floor(Date.now() / 1000);
    // 入口 (indices) は通し、以降のパスワード認証のみ拒否: オーナートークン
    // 編集は独立した認証情報であり、遮断されてはならない。
    const { db } = createMockDb((sql, params) => {
      if (sql.includes("INSERT INTO rate_limits") && params[1] === "auth-api") {
        return { kind: "run", changes: 0 };
      }
      if (sql.includes("SELECT id, owner_token_hash, owner_token_issued_at, creator_id FROM indices")) {
        return {
          kind: "all",
          results: [
            {
              id: "custom-1",
              owner_token_hash: ownerTokenHash,
              owner_token_issued_at: issuedAt,
              creator_id: "creator-1",
            },
          ],
        };
      }
      if (sql.includes("SELECT max_stocks FROM access_passwords WHERE id = ?")) {
        return { kind: "all", results: [{ max_stocks: null }] };
      }
      return undefined;
    });
    const env = createEnv(db);

    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-owner-token": ownerToken },
        body: JSON.stringify({
          id: "custom-1",
          name: "更新済み指数",
          basket: [{ ticker: "7203", name: "トヨタ自動車", theme: "輸送用機器", weight: 100 }],
          ownerToken,
          password: "whatever-password",
        }),
      }),
      env,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; ownerToken?: string; ownerTokenIssuedAt?: number };
    expect(data.ok).toBe(true);
    // 所有権は乗っ取られない: トークンと発行時刻はそのまま維持される。
    expect(data.ownerToken).toBe(ownerToken);
    expect(data.ownerTokenIssuedAt).toBe(issuedAt);
  });

  it("POST /api/indices/stock: レートリミット429 / 認証ストア障害503 / 通常の認証不足401", async () => {
    const stockBody = {
      indexId: "custom-1",
      stock: { ticker: "7203", name: "トヨタ自動車", theme: "輸送用機器", weight: 10 },
      password: "whatever-password",
    };
    const request = () =>
      new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stockBody),
      });

    // レートリミット: 入口 (indices-stock) は通し、認証 (auth-api) のみ拒否
    const limited = createMockDb(denyRateLimit("auth-api"));
    const limitedRes = await worker.fetch(request(), createEnv(limited.db));
    expect(limitedRes.status).toBe(429);
    expect(((await limitedRes.json()) as { error: string }).error).toBe(AUTH_RATE_LIMIT_ERROR_MESSAGE);

    // 認証ストア障害
    const broken = createMockDb((sql) => brokenAuthStore(sql));
    const brokenRes = await worker.fetch(request(), createEnv(broken.db));
    expect(brokenRes.status).toBe(503);
    expect(((await brokenRes.json()) as { error: string }).error).toBe(AUTH_SERVICE_UNAVAILABLE_MESSAGE);

    // 認証に失敗した通常のパスワード (回帰): 401 のまま
    const missing = createMockDb();
    const missingRes = await worker.fetch(request(), createEnv(missing.db));
    expect(missingRes.status).toBe(401);
    expect(((await missingRes.json()) as { error: string }).error).toBe(
      "この操作にはパスワード認証が必要です",
    );
  });

  it("DELETE /api/indices/stock: レートリミットは401ではなく429 / パスワード未指定は401", async () => {
    const request = () =>
      new Request("http://localhost/api/indices/stock?indexId=custom-1&ticker=7203", {
        method: "DELETE",
        headers: { "x-auth-password": "whatever-password" },
      });

    const limited = createMockDb(denyRateLimit("auth-api"));
    const res = await worker.fetch(request(), createEnv(limited.db));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe(AUTH_RATE_LIMIT_ERROR_MESSAGE);

    // 空入力の境界: パスワードが無いリクエストはレートリミット手前で短絡し、
    // 従来どおり401のまま (429/503への意図しない変換がない)。
    const withoutPassword = createMockDb();
    const noPwdRes = await worker.fetch(
      new Request("http://localhost/api/indices/stock?indexId=custom-1&ticker=7203", {
        method: "DELETE",
      }),
      createEnv(withoutPassword.db),
    );
    expect(noPwdRes.status).toBe(401);
    expect(((await noPwdRes.json()) as { error: string }).error).toBe(
      "この操作にはパスワード認証が必要です",
    );
  });

  it("PUT /api/admin/admin-password: 現行PW再確認のレートリミット429 / 認証ストア障害503", async () => {
    const adminHash = await hashPassword(TEST_ADMIN_PASSWORD);
    const adminRow = {
      id: "admin-master",
      name: "マスター管理者",
      password_hash: adminHash,
      role: "admin",
      max_stocks: null,
      is_active: 1,
    };
    const request = () =>
      new Request("http://localhost/api/admin/admin-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          newPassword: "brand-new-admin-pwd-2026",
          currentPassword: "different-current-pw-2026",
        }),
      });

    // 管理者ゲート (fallback認証) の1回目は通し、currentPassword 再確認の
    // 2回目の auth-api リミッタのみ拒否 → 429 (「現在の〜正しくありません」ではない)。
    let authApiInserts = 0;
    const limited = createMockDb((sql, params) => {
      if (sql.includes("INSERT INTO rate_limits") && params[1] === "auth-api") {
        authApiInserts += 1;
        return { kind: "run", changes: authApiInserts === 2 ? 0 : 1 };
      }
      if (sql.includes("password_hash, role, max_stocks, is_active")) {
        return { kind: "all", results: [adminRow] };
      }
      return undefined;
    });
    const limitedRes = await worker.fetch(request(), createEnv(limited.db));
    expect(limitedRes.status).toBe(429);
    expect(((await limitedRes.json()) as { error: string }).error).toBe(
      AUTH_RATE_LIMIT_ERROR_MESSAGE,
    );

    // 2回目の照合のみ D1 障害 → 503。フェーズ間で認証キャッシュを消し、
    // ゲート認証が必ずDBを読む (読取回数で故障点を切り替えるため)。
    clearAuthCache();
    let masterReads = 0;
    const broken = createMockDb((sql) => {
      if (sql.includes("password_hash, role, max_stocks, is_active")) {
        masterReads += 1;
        return masterReads === 2
          ? { kind: "throw", error: new Error("D1_STORAGE_UNAVAILABLE") }
          : { kind: "all", results: [adminRow] };
      }
      return undefined;
    });
    const brokenRes = await worker.fetch(request(), createEnv(broken.db));
    expect(brokenRes.status).toBe(503);
    const data = (await brokenRes.json()) as { error: string };
    expect(data.error).toBe(AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    expect(data.error).not.toBe("現在の管理者パスワードが正しくありません");
  });

  it("POST /api/sync-prices (force): レートリミット429 / 認証ストア障害503 / パスワード未指定401", async () => {
    const request = () =>
      new Request("http://localhost/api/sync-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: ["7203"], force: true, password: "whatever-password" }),
      });

    const limited = createMockDb(denyRateLimit("auth-api"));
    const limitedRes = await worker.fetch(request(), createEnv(limited.db));
    expect(limitedRes.status).toBe(429);
    expect(((await limitedRes.json()) as { error: string }).error).toBe(AUTH_RATE_LIMIT_ERROR_MESSAGE);

    const broken = createMockDb((sql) => brokenAuthStore(sql));
    const brokenRes = await worker.fetch(request(), createEnv(broken.db));
    expect(brokenRes.status).toBe(503);
    expect(((await brokenRes.json()) as { error: string }).error).toBe(
      AUTH_SERVICE_UNAVAILABLE_MESSAGE,
    );

    // force だがパスワード無し: 従来どおり401 (回帰)。
    const withoutPassword = createMockDb();
    const noPwdRes = await worker.fetch(
      new Request("http://localhost/api/sync-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: ["7203"], force: true }),
      }),
      createEnv(withoutPassword.db),
    );
    expect(noPwdRes.status).toBe(401);
    expect(((await noPwdRes.json()) as { error: string }).error).toBe(
      "強制同期にはパスワード認証が必要です",
    );
  });
});
