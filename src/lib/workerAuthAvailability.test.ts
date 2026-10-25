/**
 * Units B1 / B2: infrastructure failures must be classified as infrastructure
 * failures, and a broken schema must not re-run the DDL batch on every attempt.
 *
 * B1: `authenticateAdminSession` records `unavailable` when D1 cannot verify
 * the session; `adminAuthFailureResponse` then answers 503 with the existing
 * `{ error }` envelope. A missing/invalid session stays 403 and a refused
 * limiter stays 429.
 *
 * B2: `ensurePasswordTable` latches a provisioning failure for the isolate, so
 * repeated authentication attempts execute the DDL batch at most once. The
 * tests drive `worker.fetch`, not the helpers directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  ADMIN_REQUIRED_MESSAGE,
  AUTH_SERVICE_UNAVAILABLE_MESSAGE,
  clearAuthCache,
  clearMemoryRateLimits,
  resetPasswordTableEnsured,
  setAllowPasswordAdminFallbackForTests,
  type Env,
} from "../../worker/internal-impl";

const ADMIN_SESSION_TOKEN = "s".repeat(64);

const SCHEMA_TABLES = [
  "access_passwords",
  "admin_login_attempts",
  "admin_sessions",
  "basket_items",
  "benchmark_cache",
  "indices",
  "rate_limits",
  "snapshot_cache",
  "stock_prices",
  "stock_series",
  "sync_logs",
  "sync_quota",
];

const SCHEMA_INDEXES = [
  "idx_access_passwords_created_at",
  "idx_admin_login_attempts_purge",
  "idx_admin_sessions_account_id",
  "idx_admin_sessions_expires_at",
  "idx_indices_creator_id",
  "idx_rate_limits_window_start",
  "idx_sync_quota_day",
];

type Decision =
  | { kind: "all"; results: unknown[] }
  | { kind: "run"; changes?: number }
  | { kind: "throw"; error: Error };

/** `params` are the values bound to the statement, in order. */
type Router = (sql: string, params: unknown[]) => Decision | undefined;

function defaultDecision(sql: string): Decision {
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
  if (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) {
    return { kind: "all", results: [] };
  }
  return { kind: "run" };
}

/**
 * Minimal routing D1 double. Every statement is logged with its bound
 * parameters so a test can count DDL attempts and distinguish endpoints of
 * the shared rate-limit table.
 */
function createMockDb(router: Router = () => undefined) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const decide = (sql: string, params: unknown[]): Decision => {
    executed.push({ sql, params });
    return router(sql, params) ?? defaultDecision(sql);
  };
  const makeStatement = (sql: string) => {
    let params: unknown[] = [];
    const execAll = async () => {
      const decision = decide(sql, params);
      if (decision.kind === "throw") throw decision.error;
      return {
        results: decision.kind === "all" ? decision.results : [],
        success: true,
      };
    };
    const execRun = async () => {
      const decision = decide(sql, params);
      if (decision.kind === "throw") throw decision.error;
      return {
        success: true,
        meta: { changes: decision.kind === "run" ? (decision.changes ?? 1) : 1 },
      };
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
    prepare: (sql: string) => makeStatement(sql),
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true })),
  };
  return { db: db as unknown as Env["DB"], executed };
}

function createEnv(db: Env["DB"]): Env {
  return {
    ASSETS: { fetch: async () => new Response(null) } as unknown as Env["ASSETS"],
    DB: db,
  };
}

function adminListRequest(): Request {
  return new Request("http://localhost/api/admin/passwords", {
    method: "GET",
    headers: { "x-admin-session": ADMIN_SESSION_TOKEN },
  });
}

function verifyRequest(): Request {
  return new Request("http://localhost/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "whatever-password" }),
  });
}

beforeEach(() => {
  clearAuthCache();
  clearMemoryRateLimits();
  resetPasswordTableEnsured();
  setAllowPasswordAdminFallbackForTests(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAllowPasswordAdminFallbackForTests(null);
  resetPasswordTableEnsured();
  clearAuthCache();
});

describe("B1: admin session infrastructure failure", () => {
  it("answers 503 for a D1 failure while verifying the session, never 403", async () => {
    const { db } = createMockDb((sql) =>
      sql.includes("FROM admin_sessions")
        ? { kind: "throw", error: new Error("D1_STORAGE_UNAVAILABLE") }
        : undefined,
    );

    const res = await worker.fetch(adminListRequest(), createEnv(db));

    expect(res.status).toBe(503);
    const data = (await res.json()) as { error?: unknown };
    expect(data).toEqual({ error: AUTH_SERVICE_UNAVAILABLE_MESSAGE });
    expect(data.error).not.toBe(ADMIN_REQUIRED_MESSAGE);
  });

  it("keeps 403 for a session that does not exist", async () => {
    const { db } = createMockDb((sql) =>
      sql.includes("FROM admin_sessions") ? { kind: "all", results: [] } : undefined,
    );

    const res = await worker.fetch(adminListRequest(), createEnv(db));

    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toEqual({ error: ADMIN_REQUIRED_MESSAGE });
  });

  it("keeps 429 when the session limiter refuses the attempt", async () => {
    const { db } = createMockDb((sql) =>
      sql.includes("FROM admin_sessions") ? { kind: "all", results: [] } : undefined,
    );
    const env = createEnv(db);

    // The session limiter is in-memory and allows 120 calls per window.
    const responses: Response[] = [];
    for (let i = 0; i < 121; i++) {
      responses.push(await worker.fetch(adminListRequest(), env));
    }

    const last = responses[responses.length - 1];
    expect(last.status).toBe(429);
    const data = (await last.json()) as { error?: string };
    expect(data.error).toContain("管理操作が多すぎます");
  });
});

describe("B2: schema provisioning failure latch", () => {
  it("runs the DDL batch once across repeated authentication attempts", async () => {
    const { db, executed } = createMockDb((sql) => {
      if (sql.includes("FROM sqlite_master")) return { kind: "all", results: [] };
      if (sql.includes("CREATE TABLE IF NOT EXISTS access_passwords")) {
        return { kind: "throw", error: new Error("D1_SCHEMA_WRITE_FAILED") };
      }
      return undefined;
    });
    const env = createEnv(db);

    const first = await worker.fetch(verifyRequest(), env);
    expect(first.status).toBe(401);

    const ddl = () =>
      executed.filter((entry) => /^\s*(CREATE TABLE|CREATE INDEX|ALTER TABLE)/i.test(entry.sql));
    const ddlAfterFirst = ddl().length;
    expect(ddlAfterFirst).toBeGreaterThan(10);

    for (let i = 0; i < 4; i++) {
      const res = await worker.fetch(verifyRequest(), env);
      expect(res.status).toBe(401);
    }

    // The broken batch is not repeated; only the first attempt provisioned.
    expect(ddl().length).toBe(ddlAfterFirst);
    expect(executed.filter((entry) => entry.sql.includes("FROM sqlite_master"))).toHaveLength(1);

    // A cold start (or an explicit test reset) may try again.
    resetPasswordTableEnsured();
    const afterReset = await worker.fetch(verifyRequest(), env);
    expect(afterReset.status).toBe(401);
    expect(ddl().length).toBeGreaterThan(ddlAfterFirst);
  });
});
