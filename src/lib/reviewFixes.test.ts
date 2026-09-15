import { beforeEach, describe, it, expect, vi } from "vitest";
import worker, {
  clearAuthCache,
  ensurePasswordTable,
  resetPasswordTableEnsured,
} from "../../worker/index";

const TEST_ADMIN_PASSWORD = "test-admin-password";

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
    env: {
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
    },
    passwords,
  };
}

async function createUser(
  env: any,
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

    const first = await worker.fetch(makeReq(), env);
    expect(first.status).toBe(200);
    const callsAfterFirst = prepare.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second identical request hits the cache: no additional D1 calls
    const second = await worker.fetch(makeReq(), env);
    expect(second.status).toBe(200);
    expect(prepare.mock.calls.length).toBe(callsAfterFirst);
  });
});

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
    expect(data.error).toContain("Rate limit");
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
    expect(data.error).toContain("Rate limit");
  });

  it("ensures max_indices exists for both fresh and already-created password tables", async () => {
    resetPasswordTableEnsured();
    const executedDdl: string[] = [];
    const { env } = createReviewEnv();
    const origPrepare = env.DB.prepare;
    env.DB.prepare = vi.fn().mockImplementation((query: string) => {
      if (query.includes("CREATE TABLE IF NOT EXISTS access_passwords")) {
        executedDdl.push(query);
      }
      if (query.includes("ALTER TABLE access_passwords ADD COLUMN max_indices")) {
        executedDdl.push(query);
      }
      return origPrepare(query);
    });

    await ensurePasswordTable(env as any);
    expect(executedDdl.length).toBeGreaterThan(0);
    expect(executedDdl[0]).toContain("max_indices INTEGER DEFAULT NULL");
    expect(executedDdl).toContain("ALTER TABLE access_passwords ADD COLUMN max_indices INTEGER DEFAULT NULL");
  });
});
