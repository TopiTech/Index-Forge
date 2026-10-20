import { beforeEach, describe, it, expect, vi } from "vitest";
import worker from "../../worker/index";
import {
  authenticatePassword,
  clearAuthCache,
  ensurePasswordTable,
  resetPasswordTableEnsured,
  type Env,
} from "../../worker/internal";
import { asWorkerEnv } from "../test-helpers/env";

const TEST_ADMIN_PASSWORD = "test-admin-password";

/**
 * The message every rate-limited response carries.
 *
 * DATA-14 unified the error catalogue and localised the 429 message; the
 * English "Rate limit exceeded" text no longer exists in the Worker.
 */
const RATE_LIMIT_MESSAGE = "リクエストが多すぎます。しばらく時間をおいてから再試行してください。";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

interface PasswordRecord {
  id: string;
  name: string;
  password_hash: string;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices?: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

/**
 * Minimal in-memory D1 mock supporting the password-management and index
 * endpoints exercised by these regression tests.
 */
function createReviewEnv() {
  const passwords = new Map<string, PasswordRecord>();
  const rateLimitCalls: string[] = [];

  const prepare = vi.fn().mockImplementation((query: string) => {
    return {
      bind: (...params: unknown[]) => ({
        all: async () => {
          if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
            const master = passwords.get("admin-master");
            return { results: master ? [master] : [] };
          }
          if (query.includes("FROM access_passwords") && query.includes("id != 'admin-master'") && query.includes("password_hash")) {
            const matches = Array.from(passwords.values()).filter(
              (p) => p.is_active === 1 && p.id !== "admin-master",
            );
            // Preserve deterministic created_at ordering (mirrors the SQL ORDER BY)
            matches.sort((a, b) => a.created_at - b.created_at);
            return { results: matches };
          }
          if (query.includes("FROM access_passwords WHERE id != 'admin-master'")) {
            const matches = Array.from(passwords.values()).filter((p) => p.id !== "admin-master");
            return { results: matches };
          }
          if (query.includes("FROM indices WHERE id = ?")) {
            return { results: [{ id: params[0], owner_token_hash: null }] };
          }
          if (query.includes("FROM basket_items")) {
            if (query.includes("count(*)")) {
              return { results: [{ cnt: 2 }] };
            }
            return { results: [{ ticker: "9984" }, { ticker: "8035" }] };
          }
          if (query.includes("FROM rate_limits")) {
            rateLimitCalls.push(query);
            return { results: [] };
          }
          return { results: [] };
        },
        run: async () => {
          if (query.includes("INSERT INTO access_passwords") || query.includes("INSERT OR REPLACE INTO access_passwords")) {
            if (query.includes("'admin-master'")) {
              passwords.set("admin-master", {
                id: "admin-master",
                name: "マスター管理者",
                password_hash: params[0] as string,
                role: "admin",
                max_stocks: null,
                is_active: 1,
                created_at: params[1] as number,
                updated_at: params[1] as number,
              });
            } else {
              const id = params[0] as string;
              const name = params[1] as string;
              const hash = params[2] as string;
              const role = params[3] as "admin" | "user";
              const maxStocks = params[4] as number | null;
              let maxIndices: number | null = null;
              let now1: number;
              let now2: number;
              if (params.length >= 8) {
                maxIndices = params[5] as number | null;
                now1 = params[6] as number;
                now2 = params[7] as number;
              } else {
                now1 = params[5] as number;
                now2 = params[6] as number;
              }
              passwords.set(id, {
                id,
                name,
                password_hash: hash,
                role,
                max_stocks: maxStocks,
                max_indices: maxIndices,
                is_active: 1,
                created_at: now1,
                updated_at: now2,
              });
            }
            return { success: true };
          }
          if (query.includes("UPDATE access_passwords")) {
            const targetId = params[params.length - 1] as string;
            const existing = passwords.get(targetId);
            if (existing) {
              if (query.includes("password_hash = ?")) {
                existing.password_hash = params[0] as string;
                existing.updated_at = params[1] as number;
              }
            }
            return { success: true };
          }
          return { success: true };
        },
      }),
      all: async () => {
        if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
          const master = passwords.get("admin-master");
          return { results: master ? [master] : [] };
        }
        if (query.includes("FROM access_passwords") && query.includes("id != 'admin-master'") && query.includes("password_hash")) {
          const matches = Array.from(passwords.values()).filter(
            (p) => p.is_active === 1 && p.id !== "admin-master",
          );
          matches.sort((a, b) => a.created_at - b.created_at);
          return { results: matches };
        }
        return { results: [] };
      },
      run: async () => ({ success: true }),
    };
  });

  return {
    env: asWorkerEnv({
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response("Asset", { status: 200 })),
      },
      DB: {
        prepare,
        batch: vi.fn().mockImplementation(async (stmts: any[]) => {
          for (const s of stmts) {
            if (typeof s?.run === "function") await s.run();
          }
          return [];
        }),
      },
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    }),
    passwords,
  };
}

async function createUser(
  env: Env,
  name: string,
  password: string,
  maxStocks: number | null,
): Promise<Response> {
  return worker.fetch(
    new Request("http://localhost/api/admin/passwords", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({
        name,
        password,
        maxStocks,
        maxIndices: null,
        role: "user",
      }),
    }),
    env,
  );
}

describe("Code review fixes: auth cache & same-password accounts", () => {
  it("does not serve a stale cached result when two accounts share the same password", async () => {
    const { env, passwords } = createReviewEnv();

    // Two accounts with the SAME password but different limits
    const res1 = await createUser(env, "User A", "shared-password-123", 5);
    expect(res1.status).toBe(201);
    const res2 = await createUser(env, "User B", "shared-password-123", 10);
    expect(res2.status).toBe(201);
    expect(passwords.size).toBe(2);

    // Authenticate repeatedly with the shared password. The result must be
    // deterministic (oldest account wins per ORDER BY created_at) and must
    // NOT be served from a password-keyed cache that could belong to a
    // different account.
    const headers = { "Content-Type": "application/json" };
    const verify = () =>
      worker.fetch(
        new Request("http://localhost/api/auth/verify", {
          method: "POST",
          headers,
          body: JSON.stringify({ password: "shared-password-123" }),
        }),
        env,
      );

    const first = await (await verify()).json();
    const second = await (await verify()).json();
    const third = await (await verify()).json();

    expect(first.ok).toBe(true);
    expect(first.id).toBe(second.id);
    expect(first.id).toBe(third.id);
    // The shared password resolves to the first-created account deterministically
    expect(first.id).toMatch(/^pwd-/);
    expect(first.maxStocks).toBe(5);
  });

  it("keeps caching the admin-master result (single unambiguous account)", async () => {
    const { env } = createReviewEnv();
    const prepare = env.DB.prepare as ReturnType<typeof vi.fn>;
    const makeReq = () =>
      new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
      });

    // `/api/auth/verify` can no longer authenticate the administrator (SEC-02),
    // so the cache behaviour is asserted on the function that owns it.
    const first = await authenticatePassword(makeReq(), env, TEST_ADMIN_PASSWORD);
    expect(first.authenticated).toBe(true);
    expect(first.role).toBe("admin");
    expect(first.id).toBe("admin-master");

    const callsAfterFirst = prepare.mock.calls.length;
    const lookupsAfterFirst = countCredentialLookups(prepare);
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(lookupsAfterFirst).toBeGreaterThan(0);

    // Second identical request hits the cache: the credential lookup (the
    // account scan) is skipped entirely.
    const second = await authenticatePassword(makeReq(), env, TEST_ADMIN_PASSWORD);
    expect(second.authenticated).toBe(true);
    expect(second.role).toBe("admin");
    expect(second.id).toBe("admin-master");
    expect(countCredentialLookups(prepare)).toBe(lookupsAfterFirst);

    // SEC-13 moved the rate limiter in front of the auth cache, so a cached
    // authentication costs exactly one extra D1 statement - the limiter
    // reservation - and nothing else. The account scan is still skipped.
    const newStatements = prepare.mock.calls
      .slice(callsAfterFirst)
      .map((call) => String(call[0]));
    expect(newStatements.filter((q) => q.includes("INSERT INTO rate_limits")).length).toBe(1);
    expect(newStatements.filter((q) => q.includes("FROM access_passwords")).length).toBe(0);
  });
});

/**
 * Count the statements that look a credential up in D1.
 *
 * Both the `admin-master` lookup and the account scan qualify: neither of
 * them may be repeated for a cached authentication.
 */
function countCredentialLookups(prepare: ReturnType<typeof vi.fn>): number {
  return prepare.mock.calls.filter((call) => {
    const query = String(call[0]);
    return query.includes("FROM access_passwords") && query.includes("password_hash");
  }).length;
}

describe("Code review fixes: basket size cap", () => {
  it("rejects POST /api/indices baskets larger than 500 items", async () => {
    const { env } = createReviewEnv();
    const items = Array.from({ length: 501 }, (_, i) => ({
      ticker: `T${i}`,
      name: `Stock ${i}`,
      weight: 1,
      theme: "Test",
    }));
    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "too-large", basket: items }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("500");
  });

  it("still allows the largest built-in index (175 items)", async () => {
    const { env } = createReviewEnv();
    const items = Array.from({ length: 175 }, (_, i) => ({
      ticker: `T${i}`,
      name: `Stock ${i}`,
      weight: 1,
      theme: "Test",
    }));
    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-password": TEST_ADMIN_PASSWORD },
        body: JSON.stringify({ id: "large-index", basket: items }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("rejects adding a 501st stock through the individual-stock endpoint", async () => {
    const { env } = createReviewEnv();
    const originalPrepare = env.DB.prepare;
    env.DB.prepare = vi.fn().mockImplementation((query: string) => {
      if (query.includes("SELECT ticker FROM basket_items WHERE index_id = ?")) {
        return {
          bind: () => ({
            all: async () => ({
              results: Array.from({ length: 500 }, (_, index) => ({ ticker: `T${index}` })),
            }),
          }),
        };
      }
      return originalPrepare(query);
    });

    const res = await worker.fetch(
      new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          indexId: "ai-semi",
          stock: { ticker: "NEW500", name: "New Stock", weight: 1, theme: "Test" },
        }),
      }),
      env,
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("500");
  });

  it("rejects POST /api/calculate baskets larger than 500 items", async () => {
    const { env } = createReviewEnv();
    const items = Array.from({ length: 501 }, (_, i) => ({
      ticker: `T${i}`,
      name: `Stock ${i}`,
      weight: 1,
      theme: "Test",
    }));
    const res = await worker.fetch(
      new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basket: items, baseValue: 1000 }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("500");
  });
});

describe("Code review fixes: /api/indices/stock validation", () => {
  it("rejects weights greater than 100", async () => {
    const { env } = createReviewEnv();
    const res = await worker.fetch(
      new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          indexId: "ai-semi",
          stock: { ticker: "7203", name: "トヨタ自動車", weight: 150, theme: "自動車" },
        }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("weight");
  });

  it("defaults a missing weight to 10 for backward compatibility", async () => {
    const { env } = createReviewEnv();
    const res = await worker.fetch(
      new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          indexId: "ai-semi",
          stock: { ticker: "7203", name: "トヨタ自動車", theme: "自動車" },
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("rejects DELETE with an invalid ticker parameter", async () => {
    const { env } = createReviewEnv();
    const res = await worker.fetch(
      new Request(
        "http://localhost/api/indices/stock?indexId=ai-semi&ticker=BAD%20TICKER%21%21",
        {
          method: "DELETE",
          headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("accepts DELETE with a valid ticker parameter", async () => {
    const { env } = createReviewEnv();
    const res = await worker.fetch(
      new Request("http://localhost/api/indices/stock?indexId=custom-1&ticker=7203", {
        method: "DELETE",
        headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe("Code review fixes: index list cache headers", () => {
  it("serves GET /api/indices with no-cache so mutations cannot be masked by the CDN", async () => {
    const { env } = createReviewEnv();
    const res = await worker.fetch(new Request("http://localhost/api/indices"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toBeTruthy();
  });
});

describe("Code review fixes: Security headers, rate limiting, and password schema", () => {
  it("includes X-Content-Type-Options: nosniff on API responses", async () => {
    const { env } = createReviewEnv();
    const res = await worker.fetch(new Request("http://localhost/api/health"), env);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("includes defensive security headers on static asset responses", async () => {
    const { env } = createReviewEnv();
    const res = await worker.fetch(new Request("http://localhost/index.html"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    const csp = res.headers.get("content-security-policy") || "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("https://s3.tradingview.com");
    expect(csp).toContain("https://*.tradingview.com");
    expect(csp).toContain("frame-src 'self' https://www.tradingview-widget.com");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("enforces rate limiting on POST /api/indices/stock", async () => {
    const { env } = createReviewEnv();
    const origPrepare = env.DB.prepare;
    env.DB.prepare = vi.fn().mockImplementation((query: string) => {
      if (query.includes("rate_limits")) {
        return {
          bind: () => ({
            run: async () => ({ meta: { changes: 0 } }),
          }),
        };
      }
      return origPrepare(query);
    });

    const res = await worker.fetch(
      new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indexId: "custom-1", stock: { ticker: "7203" } }),
      }),
      env,
    );
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toContain(RATE_LIMIT_MESSAGE);
  });

  it("enforces rate limiting on DELETE /api/indices/stock", async () => {
    const { env } = createReviewEnv();
    const origPrepare = env.DB.prepare;
    env.DB.prepare = vi.fn().mockImplementation((query: string) => {
      if (query.includes("rate_limits")) {
        return {
          bind: () => ({
            run: async () => ({ meta: { changes: 0 } }),
          }),
        };
      }
      return origPrepare(query);
    });

    const res = await worker.fetch(
      new Request("http://localhost/api/indices/stock?indexId=custom-1&ticker=7203", {
        method: "DELETE",
      }),
      env,
    );
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toContain(RATE_LIMIT_MESSAGE);
  });

  it("ensures max_indices exists for both fresh and already-created password tables", async () => {
    // DATA-11: ensurePasswordTable() probes sqlite_master / PRAGMA table_info
    // and runs only the DDL that is actually missing, so the ALTER for
    // `max_indices` is issued only when the column is really absent.
    const fresh = createSchemaProbeEnv([], []);
    await ensurePasswordTable(fresh.env);
    const freshCreateTable = fresh.executedDdl.find((sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS access_passwords"),
    );
    // A fresh database owns the column through the CREATE TABLE definition.
    expect(freshCreateTable).toBeDefined();
    expect(freshCreateTable).toContain("max_indices INTEGER DEFAULT NULL");
    expect(fresh.executedDdl).not.toContain(
      "ALTER TABLE access_passwords ADD COLUMN max_indices INTEGER DEFAULT NULL",
    );

    // An already-created table without the column still gets the ALTER.
    resetPasswordTableEnsured();
    const missingColumn = createSchemaProbeEnv(["access_passwords"], [
      "id",
      "name",
      "password_hash",
      "role",
      "max_stocks",
      "is_active",
      "created_at",
      "updated_at",
    ]);
    await ensurePasswordTable(missingColumn.env);
    expect(missingColumn.executedDdl).toContain(
      "ALTER TABLE access_passwords ADD COLUMN max_indices INTEGER DEFAULT NULL",
    );
    expect(
      missingColumn.executedDdl.find((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS access_passwords"),
      ),
    ).toBeUndefined();

    // An already-created table that already has the column is left alone:
    // re-running the ALTER on every cold start was the defect DATA-11 fixed.
    resetPasswordTableEnsured();
    const existingColumn = createSchemaProbeEnv(["access_passwords"], [
      "id",
      "name",
      "password_hash",
      "role",
      "max_stocks",
      "max_indices",
      "secret_code_hash",
      "is_active",
      "created_at",
      "updated_at",
    ]);
    await ensurePasswordTable(existingColumn.env);
    expect(existingColumn.executedDdl).not.toContain(
      "ALTER TABLE access_passwords ADD COLUMN max_indices INTEGER DEFAULT NULL",
    );
    expect(
      existingColumn.executedDdl.find((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS access_passwords"),
      ),
    ).toBeUndefined();
  });
});

/**
 * D1 double for the schema-provisioning path.
 *
 * It answers the `sqlite_master` / `PRAGMA table_info` probes with the given
 * objects and records every DDL statement that is actually executed.
 */
function createSchemaProbeEnv(existingTables: string[], existingColumns: string[]) {
  const executedDdl: string[] = [];
  const prepare = vi.fn().mockImplementation((query: string) => {
    const okStatement = {
      bind: () => ({
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }),
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
    };

    if (query.includes("sqlite_master")) {
      return {
        ...okStatement,
        all: async () => ({
          results: existingTables.map((name) => ({ type: "table", name })),
        }),
      };
    }

    const pragmaTable = query.match(/PRAGMA table_info\((\w+)\)/)?.[1];
    if (pragmaTable) {
      const names = pragmaTable === "access_passwords" ? existingColumns : [];
      return {
        ...okStatement,
        all: async () => ({ results: names.map((name) => ({ name })) }),
      };
    }

    if (/^\s*(CREATE TABLE|CREATE INDEX|ALTER TABLE)/i.test(query)) {
      executedDdl.push(query);
    }
    return okStatement;
  });

  return {
    env: asWorkerEnv({
      DB: { prepare, batch: vi.fn().mockResolvedValue([]) },
    }) as Env,
    executedDdl,
  };
}
