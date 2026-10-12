/**
 * Regression tests for the security / correctness fixes in this review round.
 *
 * Covered:
 *  - authenticatePassword must not silently lock out accounts beyond a
 *    verification cap (the previous cap of 15 rejected the 16th+ account's
 *    correct password with a misleading "wrong password" error).
 *  - A truncated authentication scan must report a distinct, diagnosable error.
 *  - POST /api/indices must retry without sort_order on a legacy schema even
 *    when owner_token_hash is also missing (the retry was unreachable before).
 *  - PUT / DELETE /api/admin/passwords must 404 for unknown ids instead of
 *    reporting success for a no-op.
 *  - DELETE /api/indices/stock must 404 for a missing ticker even when the
 *    index holds a single constituent (it used to misreport the invariant).
 *  - Vary: Origin must be emitted even when the request origin is not allowed.
 *  - GET /api/indices must be rate limited per IP.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  clearMemoryRateLimits,
  checkMemoryRateLimit,
  hashPassword,
  hashToken,
  resetPasswordTableEnsured,
  MAX_AUTH_ROW_VERIFICATIONS,
  RATE_LIMIT_MAX,
} from "../../worker/internal";

const MASTER_PASSWORD = "master-admin-password-for-tests";

interface UserRow {
  id: string;
  name: string;
  password_hash: string;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices?: number | null;
  is_active: number;
  created_at: number;
}

beforeEach(() => {
  clearAuthCache();
  clearMemoryRateLimits();
  resetPasswordTableEnsured();
});

afterEach(() => {
  clearMemoryRateLimits();
  vi.restoreAllMocks();
});

/**
 * Minimal D1 adapter that serves an access_passwords table with the given
 * users and (optionally) a master admin row. Everything else returns empty
 * results, and writes succeed.
 */
function createAuthEnv(users: UserRow[], masterHash?: string) {
  const prepare = vi.fn().mockImplementation((query: string) => {
    const statement = {
      bind: vi.fn().mockImplementation(() => statement),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockImplementation(async () => {
        if (query.includes("WHERE id = 'admin-master'")) {
          return {
            results: masterHash
              ? [
                  {
                    id: "admin-master",
                    name: "マスター管理者",
                    password_hash: masterHash,
                    role: "admin",
                    max_stocks: null,
                    max_indices: null,
                    is_active: 1,
                  },
                ]
              : [],
          };
        }
        if (query.includes("FROM access_passwords") && query.includes("is_active = 1")) {
          return { results: users };
        }
        return { results: [] };
      }),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    };
    return statement;
  });

  return {
    DB: {
      prepare,
      batch: vi.fn().mockResolvedValue([{ success: true, meta: { changes: 1 } }]),
    },
    ADMIN_PASSWORD: MASTER_PASSWORD,
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response("asset")) },
  };
}

function verifyRequest(password: string): Request {
  return new Request("http://localhost/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("authenticatePassword row-scan budget", () => {
  it("authenticates an account that sorts beyond the old 15-row cap", async () => {
    const targetPassword = "target-account-password-2026";
    const users: UserRow[] = [];
    for (let i = 1; i <= 19; i += 1) {
      users.push({
        id: `user-${i}`,
        name: `User ${i}`,
        // Legacy hashes keep the filler rows cheap to verify.
        password_hash: await hashToken(`unrelated-password-${i}`),
        role: "user",
        max_stocks: 10,
        max_indices: null,
        is_active: 1,
        created_at: i,
      });
    }
    users.push({
      id: "user-20",
      name: "Twentieth User",
      password_hash: await hashPassword(targetPassword),
      role: "user",
      max_stocks: 25,
      max_indices: 5,
      is_active: 1,
      created_at: 20,
    });

    const env = createAuthEnv(users);
    const res = await worker.fetch(verifyRequest(targetPassword), env as never);

    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; id?: string; role?: string };
    expect(data.ok).toBe(true);
    expect(data.id).toBe("user-20");
    expect(data.role).toBe("user");
  });

  it("reports a distinct error when the verification budget is exhausted", async () => {
    // One row more than the budget: the last account cannot be checked.
    const users: UserRow[] = [];
    for (let i = 0; i <= MAX_AUTH_ROW_VERIFICATIONS; i += 1) {
      users.push({
        id: `user-${i}`,
        name: `User ${i}`,
        password_hash: await hashToken(`no-match-password-${i}`),
        role: "user",
        max_stocks: 10,
        max_indices: null,
        is_active: 1,
        created_at: i,
      });
    }

    const env = createAuthEnv(users);
    const res = await worker.fetch(verifyRequest("password-that-matches-nothing"), env as never);

    expect(res.status).toBe(401);
    const data = (await res.json()) as { ok: boolean; error?: string };
    expect(data.ok).toBe(false);
    // The truncation must be diagnosable: reporting "wrong password" here hid
    // the cause and made the remaining accounts impossible to recover.
    expect(String(data.error)).toContain("検証上限");
    expect(String(data.error)).not.toContain("パスワードが正しくありません");
  });
});

describe("legacy-schema index save retry", () => {
  it("retries without sort_order when owner_token_hash is also missing", async () => {
    const adminPassword = "legacy-schema-admin-password";
    const adminHash = await hashPassword(adminPassword);
    const batchStatements: string[][] = [];

    const prepare = vi.fn().mockImplementation((query: string) => {
      const statement = {
        query,
        bind: vi.fn().mockImplementation(() => statement),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockImplementation(async () => {
          if (
            query.includes("SELECT id, owner_token_hash, creator_id FROM indices") ||
            query.includes("SELECT id, owner_token_hash FROM indices")
          ) {
            throw new Error("no such column: owner_token_hash");
          }
          if (query.includes("WHERE id = 'admin-master'")) {
            return {
              results: [
                {
                  id: "admin-master",
                  name: "マスター管理者",
                  password_hash: adminHash,
                  role: "admin",
                  max_stocks: null,
                  max_indices: null,
                  is_active: 1,
                },
              ],
            };
          }
          return { results: [] };
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      };
      return statement;
    });

    const env = {
      DB: {
        prepare,
        batch: vi.fn().mockImplementation(async (stmts: Array<{ query?: string }>) => {
          batchStatements.push(stmts.map((s) => s.query ?? ""));
          if (batchStatements.length === 1) {
            // The pre-migration schema has neither owner_token_hash nor
            // sort_order, so the first batch fails on sort_order.
            throw new Error("no such column: sort_order");
          }
          return [{ success: true, meta: { changes: 1 } }];
        }),
      },
      ADMIN_PASSWORD: adminPassword,
      ASSETS: { fetch: vi.fn() },
    };

    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": adminPassword,
        },
        body: JSON.stringify({
          id: "legacy-index-without-owner-column",
          name: "Legacy Index",
          basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(200);
    expect(batchStatements).toHaveLength(2);
    const firstUpsert = batchStatements[0].find((q) => q.includes("INTO indices"));
    const secondUpsert = batchStatements[1].find((q) => q.includes("INTO indices"));
    expect(firstUpsert).toBeDefined();
    expect(firstUpsert).toContain("sort_order");
    expect(secondUpsert).toBeDefined();
    expect(secondUpsert).not.toContain("sort_order");
    expect(secondUpsert).not.toContain("owner_token_hash");
  });
});

describe("admin password mutations for unknown ids", () => {
  it("PUT /api/admin/passwords returns 404 when the account does not exist", async () => {
    const adminPassword = "admin-password-for-404-test";
    const adminHash = await hashPassword(adminPassword);

    const prepare = vi.fn().mockImplementation((query: string) => {
      const statement = {
        bind: vi.fn().mockImplementation(() => statement),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockImplementation(async () => {
          if (query.includes("WHERE id = 'admin-master'")) {
            return {
              results: [
                {
                  id: "admin-master",
                  name: "マスター管理者",
                  password_hash: adminHash,
                  role: "admin",
                  max_stocks: null,
                  max_indices: null,
                  is_active: 1,
                },
              ],
            };
          }
          return { results: [] };
        }),
        run: vi.fn().mockImplementation(async () => {
          if (query.includes("INSERT INTO rate_limits")) {
            return { success: true, meta: { changes: 1 } };
          }
          // The UPDATE matches no row for an unknown id.
          return { success: true, meta: { changes: 0 } };
        }),
      };
      return statement;
    });

    const env = {
      DB: { prepare, batch: vi.fn().mockResolvedValue([]) },
      ADMIN_PASSWORD: adminPassword,
      ASSETS: { fetch: vi.fn() },
    };

    const res = await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-auth-password": adminPassword },
        body: JSON.stringify({ id: "missing-user-id", name: "Renamed" }),
      }),
      env as never,
    );

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error?: string };
    expect(String(data.error)).toContain("見つかりません");
  });

  it("DELETE /api/admin/passwords returns 404 when the account does not exist", async () => {
    const adminPassword = "admin-password-for-delete-404";
    const adminHash = await hashPassword(adminPassword);

    const prepare = vi.fn().mockImplementation((query: string) => {
      const statement = {
        bind: vi.fn().mockImplementation(() => statement),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockImplementation(async () => {
          if (query.includes("WHERE id = 'admin-master'")) {
            return {
              results: [
                {
                  id: "admin-master",
                  name: "マスター管理者",
                  password_hash: adminHash,
                  role: "admin",
                  max_stocks: null,
                  max_indices: null,
                  is_active: 1,
                },
              ],
            };
          }
          return { results: [] };
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      };
      return statement;
    });

    const env = {
      DB: {
        prepare,
        // Both statements report zero changes: the account did not exist.
        batch: vi.fn().mockResolvedValue([
          { success: true, meta: { changes: 0 } },
          { success: true, meta: { changes: 0 } },
        ]),
      },
      ADMIN_PASSWORD: adminPassword,
      ASSETS: { fetch: vi.fn() },
    };

    const res = await worker.fetch(
      new Request("http://localhost/api/admin/passwords?id=missing-user-id", {
        method: "DELETE",
        headers: { "x-auth-password": adminPassword },
      }),
      env as never,
    );

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/indices/stock error semantics", () => {
  function createDeleteEnv(tickerCount: number) {
    const adminPassword = "delete-stock-admin-password";
    let adminHash = "";
    const prepare = vi.fn().mockImplementation((query: string) => {
      const statement = {
        bind: vi.fn().mockImplementation(() => statement),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockImplementation(async () => {
          if (query.includes("SELECT id, owner_token_hash FROM indices")) {
            return { results: [{ id: "solo-index", owner_token_hash: null }] };
          }
          if (query.includes("SELECT COUNT(*) as cnt FROM basket_items")) {
            return { results: [{ cnt: tickerCount }] };
          }
          if (query.includes("WHERE id = 'admin-master'")) {
            return {
              results: [
                {
                  id: "admin-master",
                  name: "マスター管理者",
                  password_hash: adminHash,
                  role: "admin",
                  max_stocks: null,
                  max_indices: null,
                  is_active: 1,
                },
              ],
            };
          }
          return { results: [] };
        }),
        run: vi.fn().mockImplementation(async () => {
          if (query.includes("INSERT INTO rate_limits")) {
            return { success: true, meta: { changes: 1 } };
          }
          if (query.includes("DELETE FROM basket_items")) {
            // The atomic guarded DELETE matched nothing.
            return { success: true, meta: { changes: 0 } };
          }
          return { success: true, meta: { changes: 1 } };
        }),
      };
      return statement;
    });

    return {
      env: {
        DB: { prepare, batch: vi.fn().mockResolvedValue([]) },
        ADMIN_PASSWORD: adminPassword,
        ASSETS: { fetch: vi.fn() },
      },
      adminPassword,
      setAdminHash: (hash: string) => {
        adminHash = hash;
      },
    };
  }

  it("returns 404 when the ticker is absent even on a single-constituent index", async () => {
    const setup = createDeleteEnv(0);
    setup.setAdminHash(await hashPassword(setup.adminPassword));

    const res = await worker.fetch(
      new Request("http://localhost/api/indices/stock?indexId=solo-index&ticker=9999", {
        method: "DELETE",
        headers: { "x-auth-password": setup.adminPassword },
      }),
      setup.env as never,
    );

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error?: string };
    expect(String(data.error)).toContain("指定された銘柄が見つかりません");
  });

  it("returns 400 when the last constituent cannot be removed", async () => {
    const setup = createDeleteEnv(1);
    setup.setAdminHash(await hashPassword(setup.adminPassword));

    const res = await worker.fetch(
      new Request("http://localhost/api/indices/stock?indexId=solo-index&ticker=7203", {
        method: "DELETE",
        headers: { "x-auth-password": setup.adminPassword },
      }),
      setup.env as never,
    );

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(String(data.error)).toContain("構成銘柄が1件のみのため削除できません");
  });
});

describe("CORS Vary and index list rate limiting", () => {
  it("emits Vary: Origin even when the origin is not allowed", async () => {
    const env = createAuthEnv([]);

    const disallowed = await worker.fetch(
      new Request("http://localhost/api/health", {
        method: "GET",
        headers: { Origin: "https://evil.example.com" },
      }),
      env as never,
    );
    expect(disallowed.status).toBe(200);
    expect(disallowed.headers.get("vary")).toBe("Origin");
    expect(disallowed.headers.get("access-control-allow-origin")).toBeNull();

    const allowed = await worker.fetch(
      new Request("http://localhost/api/health", {
        method: "GET",
        headers: { Origin: "http://localhost:5173" },
      }),
      env as never,
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(allowed.headers.get("vary")).toBe("Origin");
  });

  it("rate limits GET /api/indices per IP", async () => {
    const env = createAuthEnv([]);
    // Requests without IP headers share the "unknown" bucket.
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
      expect(checkMemoryRateLimit("unknown", "indices-list", RATE_LIMIT_MAX)).toBe(true);
    }

    const res = await worker.fetch(
      new Request("http://localhost/api/indices", { method: "GET" }),
      env as never,
    );
    expect(res.status).toBe(429);
  });
});
