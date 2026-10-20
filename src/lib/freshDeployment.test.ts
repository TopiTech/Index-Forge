import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  hashPassword,
  resetPasswordTableEnsured,
} from "../../worker/internal";

const TEST_ADMIN_PASSWORD = "test-admin-password";
const TEST_USER_PASSWORD = "test-fresh-user-password";

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
 * Find the first table a statement touches that does not exist yet.
 *
 * The table name is taken from the SQL keyword that introduces it, not from a
 * plain substring: the account query selects the `max_indices` column, and a
 * substring match would mistake that column for the `indices` table and report
 * a bogus "no such table: indices".
 */
function findMissingTable(query: string, missing: Set<string>): string | undefined {
  const patterns = [
    /\b(?:FROM|INTO|UPDATE|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi,
    /\bON\s+([A-Za-z_][A-Za-z0-9_]*)/gi,
    /\bALTER TABLE\s+([A-Za-z_][A-Za-z0-9_]*)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      const name = match[1];
      if (missing.has(name)) return name;
    }
  }
  return undefined;
}

/**
 * D1 double for a freshly created database: all tables start missing, but
 * schema bootstrap statements (CREATE TABLE IF NOT EXISTS ...) succeed and
 * create them, mirroring what ensurePasswordTable() does on first contact.
 * This reproduces the real-world fresh-deployment scenario where the fix's
 * ordering (bootstrap before the fail-closed rate-limit check) is the
 * difference between "first login works" and "every login 401s forever".
 *
 * The database contains one issued user account. `/api/auth/verify` can only
 * authenticate non-admin accounts (SEC-02), so the user account is what makes
 * a fresh deployment log in successfully.
 */
async function createFreshDbEnv() {
  const missing = new Set([
    "access_passwords",
    "admin_login_attempts",
    "admin_sessions",
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
  const accessPasswords: PasswordRecord[] = [
    {
      id: "usr-fresh",
      name: "初回デプロイユーザー",
      password_hash: await hashPassword(TEST_USER_PASSWORD),
      role: "user",
      max_stocks: 10,
      max_indices: null,
      is_active: 1,
      created_at: 1,
      updated_at: 1,
    },
  ];

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
      const create = () => {
        missing.delete(table);
        return Promise.resolve({ success: true, meta: { changes: 0 } });
      };
      return {
        bind: () => ({
          all: () => Promise.resolve({ results: [] }),
          run: () => create(),
        }),
        all: () => Promise.resolve({ results: [] }),
        run: () => create(),
      };
    }

    const missingTable = findMissingTable(query, missing);
    if (missingTable) return makeFailingStatement(missingTable);

    if (query.includes("FROM access_passwords")) {
      const rows = query.includes("WHERE id = 'admin-master'")
        ? accessPasswords.filter((row) => row.id === "admin-master")
        : accessPasswords.filter((row) => row.is_active === 1 && row.id !== "admin-master");
      return {
        bind: () => ({
          all: () => Promise.resolve({ results: rows }),
          run: () => Promise.resolve({ success: true, meta: { changes: 1 } }),
        }),
        all: () => Promise.resolve({ results: rows }),
        run: () => Promise.resolve({ success: true, meta: { changes: 1 } }),
      };
    }

    return makeOkStatement();
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
    const { env, prepare, bootstrapCalls } = await createFreshDbEnv();

    const req = new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_USER_PASSWORD }),
    });
    const res = await worker.fetch(req, env as never);
    const data = (await res.json()) as { ok?: boolean; error?: string; role?: string };

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.role).toBe("user");
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

  it("never authenticates the deployment admin password on a fresh database", async () => {
    // SEC-02: the public verify endpoint can only return a non-admin account.
    // The deployment administrator password must be rejected with the generic
    // message, even on a database that has just been bootstrapped.
    const { env } = await createFreshDbEnv();

    const res = await worker.fetch(
      new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
      }),
      env as never,
    );
    const data = (await res.json()) as { ok?: boolean; error?: string; role?: string };

    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(data.role).toBeUndefined();
    expect(data.error).toBe("パスワードが正しくありません");
  });

  it("GET /api/snapshot for the default benchmark does not 500 when snapshot_cache is missing", async () => {
    // Yahoo Finance cannot be reached from the test environment; the handler
    // must fail soft (stale-cache fallback or 502), never an unhandled 500.
    const { env } = await createFreshDbEnv();
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
