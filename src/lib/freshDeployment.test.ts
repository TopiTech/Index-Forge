import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import { clearAuthCache, resetPasswordTableEnsured } from "../../worker/internal";

const TEST_ADMIN_PASSWORD = "test-admin-password";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

/**
 * D1 double for a freshly created database: all tables start missing, but
 * schema bootstrap statements (CREATE TABLE IF NOT EXISTS ...) succeed and
 * create them, mirroring what ensurePasswordTable() does on first contact.
 * This reproduces the real-world fresh-deployment scenario where the fix's
 * ordering (bootstrap before the fail-closed rate-limit check) is the
 * difference between "first login works" and "every login 401s forever".
 */
function createFreshDbEnv() {
  const missing = new Set([
    "access_passwords",
    "benchmark_cache",
    "rate_limits",
    "snapshot_cache",
    "stock_series",
    "stock_prices",
    "sync_logs",
    "indices",
    "basket_items",
  ]);
  const bootstrapCalls: string[] = [];

  const makeFailingStatement = (table: string) => ({
    bind: () => ({
      all: () => Promise.reject(new Error(`no such table: ${table}`)),
      run: () => Promise.reject(new Error(`no such table: ${table}`)),
    }),
    all: () => Promise.reject(new Error(`no such table: ${table}`)),
    run: () => Promise.reject(new Error(`no such table: ${table}`)),
  });

  const makeOkStatement = () => ({
    bind: () => ({
      all: () => Promise.resolve({ results: [] }),
      run: () => Promise.resolve({ success: true, meta: { changes: 1 } }),
    }),
    all: () => Promise.resolve({ results: [] }),
    run: () => Promise.resolve({ success: true, meta: { changes: 1 } }),
  });

  const prepare = vi.fn().mockImplementation((query: string) => {
    const bootstrapMatch = query.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
    if (bootstrapMatch) {
      bootstrapCalls.push(bootstrapMatch[1]);
      // Bootstrap creates the table as a side effect before the statement runs.
      const table = bootstrapMatch[1];
      return {
        bind: () => ({
          all: () => Promise.resolve({ results: [] }),
          run: () => {
            missing.delete(table);
            return Promise.resolve({ success: true, meta: { changes: 0 } });
          },
        }),
        all: () => Promise.resolve({ results: [] }),
        run: () => {
          missing.delete(table);
          return Promise.resolve({ success: true, meta: { changes: 0 } });
        },
      };
    }
    const missingTable = Array.from(missing).find((table) => query.includes(table));
    return missingTable ? makeFailingStatement(missingTable) : makeOkStatement();
  });

  return {
    env: {
      ASSETS: { fetch: vi.fn() },
      DB: { prepare, batch: vi.fn().mockResolvedValue([]) },
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    },
    prepare,
    bootstrapCalls,
  };
}

describe("fresh/unmigrated D1 deployment resilience", () => {
  it("login succeeds on a fresh database because schema bootstrap precedes the fail-closed rate-limit check", async () => {
    const { env, prepare, bootstrapCalls } = createFreshDbEnv();

    const req = new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
    });
    const res = await worker.fetch(req, env as never);
    const data = (await res.json()) as { ok?: boolean; error?: string };

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.error).toBeUndefined();

    // Regression proof: the bootstrap (ensurePasswordTable) must have created
    // the rate_limits table BEFORE the fail-closed rate-limit INSERT ran.
    // With the old ordering, the INSERT hit a missing table, failed closed,
    // and the request returned 401 with the misleading rate-limit error
    // without ever attempting the bootstrap.
    expect(bootstrapCalls).toContain("rate_limits");
    const prepareCalls = prepare.mock.calls.map((call) => String(call[0]));
    const bootstrapIndex = prepareCalls.findIndex((q) => q.includes("CREATE TABLE IF NOT EXISTS rate_limits"));
    const rateLimitInsertIndex = prepareCalls.findIndex((q) => q.includes("INSERT INTO rate_limits"));
    expect(bootstrapIndex).toBeGreaterThanOrEqual(0);
    expect(rateLimitInsertIndex).toBeGreaterThan(bootstrapIndex);
  });

  it("GET /api/snapshot for the default benchmark does not 500 when snapshot_cache is missing", async () => {
    // Yahoo Finance cannot be reached from the test environment; the handler
    // must fail soft (stale-cache fallback or 502), never an unhandled 500.
    const { env } = createFreshDbEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ chart: { result: [] } }), { status: 200 })),
    );

    try {
      const req = new Request("http://localhost/api/snapshot?symbol=%5EN225", { method: "GET" });
      const res = await worker.fetch(req, env as never);

      expect(res.status).not.toBe(500);
      expect([200, 502]).toContain(res.status);
      if (res.status === 502) {
        const data = (await res.json()) as { error?: string };
        expect(String(data.error)).toContain("Yahoo Finance");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
