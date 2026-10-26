import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  clearMemoryCache,
  getMemoryCache,
  resetCacheMetrics,
  setAllowMemoryCacheInTest,
  setMemoryCache,
  REQUIRED_SCHEMA_STEPS,
  type Env,
} from "../../worker/internal-impl";
import {
  saveIndexOwnerToken,
  getIndexOwnerToken,
} from "./ownership";
import {
  computePendingMigrations,
  REQUIRED_MIGRATION_STEPS,
} from "../../scripts/apply-migrations.mjs";
import { changeAdminSecretCode } from "./auth";
import { DatabaseSync } from "node:sqlite";

function makeStorage(initial: Record<string, string> = {}) {
  const backing = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (backing.has(key) ? (backing.get(key) as string) : null),
    setItem: (key: string, value: string) => void backing.set(key, value),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => void backing.clear(),
  };
}

describe("Batch 2 Comprehensive Fixes Verification Suite", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
    clearAuthCache();
    clearMemoryCache();
    setAllowMemoryCacheInTest(true);
    resetCacheMetrics();
  });

  afterEach(() => {
    clearMemoryCache();
    setAllowMemoryCacheInTest(false);
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // ISSUE-02 (P1): 所有者トークン発行日時の秒・ミリ秒不整合と引数欠落
  // --------------------------------------------------------------------------
  describe("ISSUE-02: Owner token timestamp normalization and persistence", () => {
    it("safely normalizes second timestamps (< 1e11) to millisecond timestamps in saveIndexOwnerToken", () => {
      const nowSeconds = Math.floor(Date.now() / 1000); // 10 digits
      saveIndexOwnerToken("test-idx-seconds", "token-sec", nowSeconds);

      const raw = localStorage.getItem("custom_index_owners");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed["test-idx-seconds"]).toBeDefined();
      expect(parsed["test-idx-seconds"].token).toBe("token-sec");
      expect(parsed["test-idx-seconds"].issuedAt).toBe(nowSeconds * 1000);
      expect(getIndexOwnerToken("test-idx-seconds")).toBe("token-sec");
    });

    it("leaves millisecond timestamps (>= 1e11) as-is in saveIndexOwnerToken", () => {
      const nowMs = Date.now(); // 13 digits
      saveIndexOwnerToken("test-idx-ms", "token-ms", nowMs);

      const raw = localStorage.getItem("custom_index_owners");
      const parsed = JSON.parse(raw!);
      expect(parsed["test-idx-ms"].issuedAt).toBe(nowMs);
      expect(getIndexOwnerToken("test-idx-ms")).toBe("token-ms");
    });

    it("migrates existing raw stored entries with second timestamps to milliseconds during read", () => {
      const pastSeconds = Math.floor(Date.now() / 1000) - 60; // 1 minute ago in seconds
      localStorage.setItem(
        "custom_index_owners",
        JSON.stringify({
          "legacy-idx": {
            token: "legacy-token",
            issuedAt: pastSeconds,
          },
        }),
      );

      // getIndexOwnerToken triggers normalization
      const token = getIndexOwnerToken("legacy-idx");
      expect(token).toBe("legacy-token");

      const rewritten = JSON.parse(localStorage.getItem("custom_index_owners")!);
      expect(rewritten["legacy-idx"].issuedAt).toBe(pastSeconds * 1000);
    });
  });

  // --------------------------------------------------------------------------
  // ISSUE-03 (P1): 管理者パスワード・暗号変更後のセッション失効・UI操作不能
  // --------------------------------------------------------------------------
  describe("ISSUE-03: Admin session renewal after password and secret code rotation", () => {
    const TEST_ADMIN_KEY = "test-master-key-xyz";

    function createMockEnv(adminPassword = TEST_ADMIN_KEY) {
      const sessions = new Map<string, unknown>();
      const passwords = new Map<string, { id: string; password_hash: string; secret_code_hash?: string; role: string }>();

      const mockDb = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          let bound: unknown[] = [];
          return {
            bind: (...params: unknown[]) => {
              bound = params;
              return {
                all: async () => {
                  if (sql.includes("FROM sqlite_master")) {
                    return {
                      results: [
                        { type: "table", name: "access_passwords" },
                        { type: "table", name: "admin_sessions" },
                        { type: "table", name: "admin_login_attempts" },
                      ],
                    };
                  }
                  if (sql.includes("PRAGMA table_info")) {
                    return {
                      results: [
                        { name: "id" },
                        { name: "password_hash" },
                        { name: "secret_code_hash" },
                        { name: "role" },
                        { name: "is_active" },
                      ],
                    };
                  }
                  if (sql.includes("FROM access_passwords WHERE id = 'admin-master'")) {
                    const row = passwords.get("admin-master");
                    return { results: row ? [row] : [] };
                  }
                  return { results: [] };
                },
                run: async () => {
                  if (sql.includes("INSERT") && sql.includes("access_passwords")) {
                    passwords.set("admin-master", {
                      id: "admin-master",
                      password_hash: String(bound[0] ?? ""),
                      role: "admin",
                    });
                  }
                  if (sql.includes("DELETE FROM admin_sessions")) {
                    sessions.clear();
                  }
                  if (sql.includes("INSERT OR REPLACE INTO admin_sessions")) {
                    sessions.set(String(bound[0]), {
                      token_hash: bound[0],
                      account_id: bound[1],
                      created_at: bound[2],
                      expires_at: bound[3],
                    });
                  }
                  return { success: true, meta: { changes: 1 } };
                },
              };
            },
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          };
        }),
      };

      return {
        DB: mockDb,
        ADMIN_PASSWORD: adminPassword,
        ADMIN_SECRET_CODE: "dev-secret-code-change-me",
        sessions,
      };
    }

    it("PUT /api/admin/admin-password revokes old sessions and returns new adminToken", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/admin/admin-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
        body: JSON.stringify({
          newPassword: "BrandNewMasterPassword123!",
        }),
      });

      const res = await worker.fetch(req, env as unknown as Env);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; adminToken?: string; adminTokenExpiresAt?: number; message?: string };
      expect(data.ok).toBe(true);
      expect(typeof data.adminToken).toBe("string");
      expect(data.adminToken!.length).toBeGreaterThan(20);
      expect(typeof data.adminTokenExpiresAt).toBe("number");
      expect(data.adminTokenExpiresAt!).toBeGreaterThan(Date.now());
      // A new session was recorded in admin_sessions
      expect(env.sessions.size).toBe(1);
    });

    it("PUT /api/admin/admin-secret-code revokes old sessions and returns new adminToken", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/admin/admin-secret-code", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
        body: JSON.stringify({
          currentSecretCode: "dev-secret-code-change-me",
          newSecretCode: "新しいたくましい暗号2026",
        }),
      });

      const res = await worker.fetch(req, env as unknown as Env);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; adminToken?: string; adminTokenExpiresAt?: number; message?: string };
      expect(data.ok).toBe(true);
      expect(typeof data.adminToken).toBe("string");
      expect(data.adminToken!.length).toBeGreaterThan(20);
      expect(typeof data.adminTokenExpiresAt).toBe("number");
      expect(env.sessions.size).toBe(1);
    });

    it("changeAdminSecretCode client helper extracts and returns adminToken", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          adminToken: "renewed-admin-token-token-1234",
          adminTokenExpiresAt: Date.now() + 28800000,
        }),
      });

      try {
        const res = await changeAdminSecretCode("old-secret", "new-secret-999");
        expect(res.ok).toBe(true);
        expect(res.adminToken).toBe("renewed-admin-token-token-1234");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // --------------------------------------------------------------------------
  // ISSUE-06 (P2): admin_login_attempts パージ用インデックスの追加
  // --------------------------------------------------------------------------
  describe("ISSUE-06: admin_login_attempts purge index registration", () => {
    it("creates a working purge index when the registered schema step SQL runs", () => {
      // The canonical DDL (table) and the artifact under test (index) both
      // come from the registration array: no implementation text is read.
      const tableStep = REQUIRED_SCHEMA_STEPS.find(
        (s) => s.existing?.kind === "table" && s.existing?.name === "admin_login_attempts",
      );
      const indexStep = REQUIRED_SCHEMA_STEPS.find(
        (s) => s.existing?.kind === "index" && s.existing?.name === "idx_admin_login_attempts_purge",
      );
      expect(tableStep?.sql).toBeTruthy();
      expect(indexStep?.sql).toBeTruthy();

      const db = new DatabaseSync(":memory:");
      try {
        db.exec(tableStep!.sql);
        db.exec(indexStep!.sql);

        const row = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_admin_login_attempts_purge'",
          )
          .get() as { name: string } | undefined;
        expect(row?.name).toBe("idx_admin_login_attempts_purge");

        const info = db
          .prepare("PRAGMA index_info(idx_admin_login_attempts_purge)")
          .all() as { seqno: number; name: string }[];
        expect(info.map((c) => c.name)).toEqual(["last_failed_at", "locked_until"]);

        // The purge predicate is servable by the index ...
        const plan = db
          .prepare(
            "EXPLAIN QUERY PLAN SELECT ip FROM admin_login_attempts WHERE last_failed_at < ?",
          )
          .all() as { detail: string }[];
        expect(plan.map((p) => p.detail).join("\n")).toContain(
          "USING INDEX idx_admin_login_attempts_purge",
        );

        // ... and purging expired rows leaves live ones behind.
        const insert = db.prepare(
          "INSERT INTO admin_login_attempts (ip, failed_count, last_failed_at, locked_until) VALUES (?, 3, ?, 0)",
        );
        insert.run("10.0.0.1", 1000);
        insert.run("10.0.0.2", 9999999999);
        db.prepare("DELETE FROM admin_login_attempts WHERE last_failed_at < ?").run(2000);
        const remaining = db.prepare("SELECT ip FROM admin_login_attempts").all() as {
          ip: string;
        }[];
        expect(remaining.map((r) => r.ip)).toEqual(["10.0.0.2"]);
      } finally {
        db.close();
      }
    });

    it("creates the same working purge index from the registered migration step SQL", () => {
      const tableStep = REQUIRED_SCHEMA_STEPS.find(
        (s) => s.existing?.kind === "table" && s.existing?.name === "admin_login_attempts",
      );
      const migrationStep = REQUIRED_MIGRATION_STEPS.find(
        (s) => s.type === "index" && s.name === "idx_admin_login_attempts_purge",
      );
      expect(tableStep?.sql).toBeTruthy();
      expect(migrationStep?.sql).toBeTruthy();

      const db = new DatabaseSync(":memory:");
      try {
        db.exec(tableStep!.sql);
        db.exec(migrationStep!.sql);

        const row = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_admin_login_attempts_purge'",
          )
          .get() as { name: string } | undefined;
        expect(row?.name).toBe("idx_admin_login_attempts_purge");

        const info = db
          .prepare("PRAGMA index_info(idx_admin_login_attempts_purge)")
          .all() as { seqno: number; name: string }[];
        expect(info.map((c) => c.name)).toEqual(["last_failed_at", "locked_until"]);
      } finally {
        db.close();
      }
    });

    it("REQUIRED_SCHEMA_STEPS registers idx_admin_login_attempts_purge index", () => {
      const step = REQUIRED_SCHEMA_STEPS.find(
        (s) => s.existing?.kind === "index" && s.existing?.name === "idx_admin_login_attempts_purge",
      );
      expect(step).toBeDefined();
      expect(step?.sql).toContain("admin_login_attempts(last_failed_at, locked_until)");
    });

    it("REQUIRED_MIGRATION_STEPS registers idx_admin_login_attempts_purge index", () => {
      const step = REQUIRED_MIGRATION_STEPS.find(
        (s) => s.type === "index" && s.name === "idx_admin_login_attempts_purge",
      );
      expect(step).toBeDefined();
      expect(step?.sql).toContain("admin_login_attempts(last_failed_at, locked_until)");
    });
  });

  // --------------------------------------------------------------------------
  // ISSUE-07 (P2): Worker インメモリキャッシュの LRU 化
  // --------------------------------------------------------------------------
  describe("ISSUE-07: Worker memory cache LRU ordering", () => {
    it("promotes accessed entries on cache hit, ensuring hot entries are preserved during eviction", () => {
      // MAX_CALC_CACHE_SIZE = 100 entries.
      // Fill cache to capacity (0 to 99)
      for (let i = 0; i < 100; i++) {
        setMemoryCache(`calc:key-${i}`, { id: i }, 300);
      }

      // Access key-0 so it becomes MRU (most recently used).
      // Under FIFO, key-0 would be evicted next because it was inserted first.
      // Under LRU, key-0 is promoted to the newest position, so key-1 is now LRU.
      const hit = getMemoryCache<{ id: number }>("calc:key-0");
      expect(hit?.id).toBe(0);

      // Insert 101st entry, which forces eviction of the LRU entry
      setMemoryCache("calc:key-100", { id: 100 }, 300);

      // Hot entry key-0 was preserved!
      expect(getMemoryCache("calc:key-0")).not.toBeNull();
      // key-1 (least recently used) was evicted!
      expect(getMemoryCache("calc:key-1")).toBeNull();
      // Newly inserted key-100 exists
      expect(getMemoryCache("calc:key-100")).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // ISSUE-08 (P2): POST /api/sync-prices の D1 トランザクション集約
  // --------------------------------------------------------------------------
  describe("ISSUE-08: POST /api/sync-prices atomic batch consolidation", () => {
    it("consolidates multi-ticker sync writes into a single atomic env.DB.batch call", async () => {
      const batchStatementsList: unknown[][] = [];
      const mockEnv = {
        DB: {
          prepare: vi.fn().mockImplementation((_query: string) => {
            return {
              bind: (..._params: unknown[]) => ({
                all: async () => ({ results: [] }),
                run: async () => ({ success: true, meta: { changes: 1 } }),
              }),
              all: async () => ({ results: [] }),
              run: async () => ({ success: true, meta: { changes: 1 } }),
            };
          }),
          batch: vi.fn().mockImplementation(async (statements: unknown[]) => {
            batchStatementsList.push(statements);
            return statements.map(() => ({ success: true }));
          }),
        },
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  timestamp: [1735689600, 1735776000],
                  indicators: { quote: [{ close: [2000, 2050] }] },
                },
              ],
            },
          }),
          { status: 200 },
        );
      });

      try {
        const req = new Request("http://localhost/api/sync-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: ["7203", "6758", "8035"] }),
        });

        const res = await worker.fetch(req, mockEnv as unknown as Env);
        expect(res.status).toBe(200);
        const data = (await res.json()) as { ok: boolean; results: { ticker: string; status: string }[] };
        expect(data.ok).toBe(true);
        expect(data.results).toHaveLength(3);
        expect(data.results.every((r) => r.status === "synced")).toBe(true);

        // Exactly 1 consolidated batch call for all 3 tickers instead of 3 separate batch calls!
        expect(mockEnv.DB.batch).toHaveBeenCalledTimes(1);
        // 3 tickers * 3 statements per ticker = 9 statements in the single batch
        expect(batchStatementsList[0]).toHaveLength(9);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // --------------------------------------------------------------------------
  // ISSUE-09 (P2): PUT /api/admin/passwords の is_active（スネークケース）受容
  // --------------------------------------------------------------------------
  describe("ISSUE-09: PUT /api/admin/passwords snake_case is_active parameter acceptance", () => {
    function createMockPasswordEnv() {
      const executedUpdates: { query: string; params: unknown[] }[] = [];
      const mockDb = {
        prepare: vi.fn().mockImplementation((query: string) => {
          let boundParams: unknown[] = [];
          return {
            bind: (...params: unknown[]) => {
              boundParams = params;
              return {
                all: async () => ({ results: [] }),
                run: async () => {
                  if (query.includes("UPDATE access_passwords")) {
                    executedUpdates.push({ query, params: boundParams });
                  }
                  return { success: true, meta: { changes: 1 } };
                },
              };
            },
            all: async () => ({ results: [] }),
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
        }),
      };
      return { DB: mockDb, executedUpdates, ADMIN_PASSWORD: "admin-pwd-pass" };
    }

    it("accepts is_active: 0 / false to deactivate a user account", async () => {
      const env = createMockPasswordEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": "admin-pwd-pass",
        },
        body: JSON.stringify({
          id: "target-user-1",
          is_active: false,
        }),
      });

      const res = await worker.fetch(req, env as unknown as Env);
      expect(res.status).toBe(200);
      expect(env.executedUpdates.length).toBe(1);
      expect(env.executedUpdates[0].query).toContain("is_active = ?");
      expect(env.executedUpdates[0].params[0]).toBe(0);
    });

    it("accepts is_active: 1 / true to activate a user account", async () => {
      const env = createMockPasswordEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": "admin-pwd-pass",
        },
        body: JSON.stringify({
          id: "target-user-1",
          is_active: true,
        }),
      });

      const res = await worker.fetch(req, env as unknown as Env);
      expect(res.status).toBe(200);
      expect(env.executedUpdates.length).toBe(1);
      expect(env.executedUpdates[0].params[0]).toBe(1);
    });

    it("rejects attempt to deactivate admin-master via is_active: false with HTTP 403", async () => {
      const env = createMockPasswordEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": "admin-pwd-pass",
        },
        body: JSON.stringify({
          id: "admin-master",
          is_active: false,
        }),
      });

      const res = await worker.fetch(req, env as unknown as Env);
      expect(res.status).toBe(403);
      const data = (await res.json()) as { error?: string };
      expect(data.error).toContain("マスター管理者アカウントのロール変更および無効化はできません");
    });
  });

  // --------------------------------------------------------------------------
  // ISSUE-10 (P2): scripts/apply-migrations.mjs に不要インデックス削除ステップを追加
  // --------------------------------------------------------------------------
  describe("ISSUE-10: Drop index migration steps for obsolete indexes", () => {
    it("registers drop_index steps for idx_basket_items_index_id and idx_access_passwords_hash", () => {
      const dropBasketIndex = REQUIRED_MIGRATION_STEPS.find(
        (s) => s.type === "drop_index" && s.name === "idx_basket_items_index_id",
      );
      const dropPasswordIndex = REQUIRED_MIGRATION_STEPS.find(
        (s) => s.type === "drop_index" && s.name === "idx_access_passwords_hash",
      );

      expect(dropBasketIndex).toBeDefined();
      expect(dropBasketIndex?.sql).toBe("DROP INDEX IF EXISTS idx_basket_items_index_id");
      expect(dropPasswordIndex).toBeDefined();
      expect(dropPasswordIndex?.sql).toBe("DROP INDEX IF EXISTS idx_access_passwords_hash");
    });

    it("computePendingMigrations flags drop_index steps only when obsolete indexes exist in database probe", () => {
      const probeWithObsolete = {
        tables: new Set<string>(),
        indexes: new Set(["idx_basket_items_index_id", "idx_access_passwords_hash"]),
        columns: new Map<string, Set<string>>(),
      };

      const pending = computePendingMigrations(probeWithObsolete);
      const dropSteps = pending.filter((s) => s.type === "drop_index");
      expect(dropSteps).toHaveLength(2);

      const probeClean = {
        tables: new Set<string>(),
        indexes: new Set<string>(),
        columns: new Map<string, Set<string>>(),
      };
      const pendingClean = computePendingMigrations(probeClean);
      expect(pendingClean.filter((s) => s.type === "drop_index")).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // ISSUE-19 (P3): POST /api/indices の構成銘柄ウェイト合計バリデーション
  // --------------------------------------------------------------------------
  describe("ISSUE-19: POST /api/indices total basket weight validation", () => {
    function createMockIndicesEnv() {
      return {
        DB: {
          prepare: vi.fn().mockImplementation((query: string) => ({
            bind: (..._params: unknown[]) => ({
              all: async () => {
                if (query.includes("FROM access_passwords")) {
                  return { results: [] };
                }
                return { results: [] };
              },
              run: async () => ({ success: true, meta: { changes: 1 } }),
            }),
            all: async () => ({ results: [] }),
            run: async () => ({ success: true, meta: { changes: 1 } }),
          })),
          batch: vi.fn().mockResolvedValue([{ success: true }]),
        },
        ADMIN_PASSWORD: "admin-indices-pwd",
      };
    }

    it("rejects request when total basket weight is 0 or negative with HTTP 400", async () => {
      const env = createMockIndicesEnv();
      // Note: individual item weight is validated to be > 0 in loop, but if items had 0 or total sum was 0:
      const req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": "admin-indices-pwd",
        },
        body: JSON.stringify({
          name: "Test Zero Total Weight",
          basket: [{ ticker: "7203", name: "Toyota", weight: 0 }],
        }),
      });

      const res = await worker.fetch(req, env as unknown as Env);
      expect(res.status).toBe(400);
    });

    it("rejects request when total basket weight exceeds 10000% with HTTP 400", async () => {
      const env = createMockIndicesEnv();
      // 101 items with weight 100 = 10100 > 10000
      const heavyBasket = Array.from({ length: 101 }, (_, idx) => ({
        ticker: `TICK${idx}`,
        name: `Stock ${idx}`,
        weight: 100,
      }));

      const req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": "admin-indices-pwd",
        },
        body: JSON.stringify({
          name: "Test Overweight Basket",
          basket: heavyBasket,
        }),
      });

      const res = await worker.fetch(req, env as unknown as Env);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error?: string };
      expect(data.error).toContain("合計ウェイトは0より大きく10000以下にしてください");
    });

    it("accepts request with valid basket total weights (e.g., 100%)", async () => {
      const env = createMockIndicesEnv();
      const req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": "admin-indices-pwd",
        },
        body: JSON.stringify({
          name: "Valid Basket Index",
          basket: [
            { ticker: "7203", name: "Toyota", weight: 60 },
            { ticker: "6758", name: "Sony", weight: 40 },
          ],
        }),
      });

      const res = await worker.fetch(req, env as unknown as Env);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean };
      expect(data.ok).toBe(true);
    });
  });
});
