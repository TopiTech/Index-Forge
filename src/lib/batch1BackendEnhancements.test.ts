import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  authenticatePassword,
  clearAuthCache,
  hashPassword,
  hashToken,
  isAllowedOrigin,
  negativeAuthCache,
  purgeExpiredSecurityRows,
  setNegativeAuthCache,
  type Env,
} from "../../worker/internal";
import {
  formatMacroCalendarValue,
  type MacroCalendarApiItem,
} from "../../worker/macroCalendarProvider";

describe("Batch 1 Backend Enhancements Verification", () => {
  beforeEach(() => {
    clearAuthCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearAuthCache();
    vi.restoreAllMocks();
  });

  describe("BE-01: パスワード検証ネガティブキャッシュ (DoS防止)", () => {
    it("stores invalid password in negative cache and rejects repeated attempts without DB lookups", async () => {
      let accessPasswordQueries = 0;
      const mockEnv: Env = {
        ASSETS: { fetch: vi.fn() },
        DB: {
          prepare: vi.fn().mockImplementation((sql: string) => {
            if (sql.includes("FROM access_passwords")) {
              accessPasswordQueries++;
            }
            return {
              bind: vi.fn().mockReturnThis(),
              all: vi.fn().mockResolvedValue({ results: [] }),
              run: vi.fn().mockResolvedValue({ success: true }),
              first: vi.fn().mockResolvedValue(null),
            };
          }),
          batch: vi.fn().mockResolvedValue([]),
        } as unknown as Env["DB"],
      };

      const wrongPassword = "wrong-password-12345";
      const pwdHash = await hashToken(wrongPassword);

      // First attempt: should query D1 and return incorrect password
      const firstResult = await authenticatePassword(
        new Request("http://localhost/api/auth/verify"),
        mockEnv,
        wrongPassword,
      );
      expect(firstResult.authenticated).toBe(false);
      expect(firstResult.error).toBe("パスワードが正しくありません");
      expect(accessPasswordQueries).toBeGreaterThan(0);
      const queriesAfterFirst = accessPasswordQueries;

      // Verify it is now cached in negativeAuthCache
      const cachedEntry = negativeAuthCache.get(pwdHash);
      expect(cachedEntry).toBeDefined();
      expect(cachedEntry?.expiresAt).toBeGreaterThan(Date.now());

      // Second attempt: should immediately return failure without querying access_passwords again
      const secondResult = await authenticatePassword(
        new Request("http://localhost/api/auth/verify"),
        mockEnv,
        wrongPassword,
      );
      expect(secondResult.authenticated).toBe(false);
      expect(secondResult.error).toBe("パスワードが正しくありません");
      // access_passwords query count must not increase because it hit negative cache
      expect(accessPasswordQueries).toBe(queriesAfterFirst);
    });

    it("clears negative cache when clearAuthCache() is called", async () => {
      const pwdHash = await hashToken("test-invalid-password");
      setNegativeAuthCache(pwdHash, {
        expiresAt: Date.now() + 30000,
        scope: "all",
      });
      expect(negativeAuthCache.has(pwdHash)).toBe(true);

      clearAuthCache();
      expect(negativeAuthCache.has(pwdHash)).toBe(false);
    });

    it("deletes negative cache entry when password authentication succeeds", async () => {
      const validPassword = "valid-secret-password-123";
      const validHash = await hashPassword(validPassword);
      const pwdHash = await hashToken(validPassword);

      // Seed negative cache erroneously
      setNegativeAuthCache(pwdHash, {
        expiresAt: Date.now() + 30000,
        scope: "non-admin",
      });

      const mockEnv: Env = {
        ASSETS: { fetch: vi.fn() },
        DB: {
          prepare: vi.fn().mockImplementation((sql: string) => ({
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockImplementation(async () => {
              if (sql.includes("FROM access_passwords WHERE is_active = 1")) {
                return {
                  results: [
                    {
                      id: "user-1",
                      name: "Valid User",
                      role: "user",
                      max_stocks: 10,
                      max_indices: 5,
                      is_active: 1,
                      password_hash: validHash,
                    },
                  ],
                };
              }
              return { results: [] };
            }),
            run: vi.fn().mockResolvedValue({ success: true }),
            first: vi.fn().mockResolvedValue(null),
          })),
          batch: vi.fn().mockResolvedValue([]),
        } as unknown as Env["DB"],
      };

      // Authenticate with allowAdmin=true
      const result = await authenticatePassword(
        new Request("http://localhost/api/admin/passwords"),
        mockEnv,
        validPassword,
        "auth-api",
        undefined,
        true,
      );
      expect(result.authenticated).toBe(true);
      expect(negativeAuthCache.has(pwdHash)).toBe(false);
    });
  });

  describe("BE-02: CORS オリジン判定統合", () => {
    it("allows standard local hostnames (localhost, 127.0.0.1, [::1])", () => {
      expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
      expect(isAllowedOrigin("http://127.0.0.1:8787")).toBe(true);
      expect(isAllowedOrigin("http://[::1]:8787")).toBe(true);
    });

    it("allows .localhost subdomains via isLocalHostname", () => {
      expect(isAllowedOrigin("http://app.localhost:5173")).toBe(true);
      expect(isAllowedOrigin("https://sub.staging.localhost:8080")).toBe(true);
    });

    it("rejects unauthorized external origins by default", () => {
      expect(isAllowedOrigin("https://evil.com")).toBe(false);
      expect(isAllowedOrigin("https://attacker-localhost.com")).toBe(false);
      expect(isAllowedOrigin("invalid-url")).toBe(false);
    });

    it("allows origins configured in env.ALLOWED_ORIGINS", () => {
      const env: Env = {
        ASSETS: { fetch: vi.fn() },
        DB: {} as unknown as Env["DB"],
        ALLOWED_ORIGINS: "https://custom-domain.example.com, https://dashboard.example.org",
      };

      expect(isAllowedOrigin("https://custom-domain.example.com", env)).toBe(true);
      expect(isAllowedOrigin("https://dashboard.example.org", env)).toBe(true);
      expect(isAllowedOrigin("https://unauthorized.example.com", env)).toBe(false);
    });

    it("handles trailing slashes in env.ALLOWED_ORIGINS gracefully", () => {
      const env: Env = {
        ASSETS: { fetch: vi.fn() },
        DB: {} as unknown as Env["DB"],
        ALLOWED_ORIGINS: "https://my-app.com/",
      };

      expect(isAllowedOrigin("https://my-app.com", env)).toBe(true);
    });
  });

  describe("BE-03: purgeExpiredSecurityRows の D1 バッチ化", () => {
    it("executes batch deletion atomically when env.DB.batch is supported", async () => {
      let batchExecuted = false;
      let batchCount = 0;

      const mockEnv: Env = {
        ASSETS: { fetch: vi.fn() },
        DB: {
          prepare: vi.fn().mockImplementation((sql: string) => ({
            bind: vi.fn().mockReturnValue({ sql, bound: true }),
          })),
          batch: vi.fn().mockImplementation(async (statements: unknown[]) => {
            batchExecuted = true;
            batchCount = statements.length;
            return [];
          }),
        } as unknown as Env["DB"],
      };

      const now = Math.floor(Date.now() / 1000);
      await purgeExpiredSecurityRows(mockEnv, now);

      expect(batchExecuted).toBe(true);
      expect(batchCount).toBe(4);
    });

    it("falls back to individual execution when env.DB.batch fails", async () => {
      const executedTables: string[] = [];

      const mockEnv: Env = {
        ASSETS: { fetch: vi.fn() },
        DB: {
          prepare: vi.fn().mockImplementation((sql: string) => ({
            bind: vi.fn().mockReturnValue({
              run: async () => {
                if (sql.includes("rate_limits")) executedTables.push("rate_limits");
                if (sql.includes("admin_sessions")) executedTables.push("admin_sessions");
                if (sql.includes("admin_login_attempts")) executedTables.push("admin_login_attempts");
                if (sql.includes("sync_quota")) executedTables.push("sync_quota");
                return { success: true };
              },
            }),
          })),
          batch: vi.fn().mockRejectedValue(new Error("D1 batch failed")),
        } as unknown as Env["DB"],
      };

      const now = Math.floor(Date.now() / 1000);
      await purgeExpiredSecurityRows(mockEnv, now);

      expect(executedTables).toContain("rate_limits");
      expect(executedTables).toContain("admin_sessions");
      expect(executedTables).toContain("admin_login_attempts");
      expect(executedTables).toContain("sync_quota");
    });
  });

  describe("BE-04: マクロ経済カレンダー単位判定の適正化", () => {
    const baseItem: MacroCalendarApiItem = {
      time: "2026-10-02T12:30:00Z",
      countryCode: "US",
      name: "Indicator",
      unit: "none",
      multiplier: "none",
      digits: 1,
      actual: null,
      forecast: null,
      previous: null,
      revisedPrevious: null,
      revision: null,
    };

    it("preserves unit: 'none' with multiplier: 'thousands' as 千人", () => {
      const item: MacroCalendarApiItem = {
        ...baseItem,
        unit: "none",
        multiplier: "thousands",
      };
      expect(formatMacroCalendarValue(162.5, item)).toBe("162.5千人");
    });

    it("formats specific non-job unit with multiplier: 'thousands' as 千{unit}", () => {
      const barrelItem: MacroCalendarApiItem = {
        ...baseItem,
        unit: "barrel",
        multiplier: "thousands",
      };
      expect(formatMacroCalendarValue(162.5, barrelItem)).toBe("162.5千barrel");

      const caseItem: MacroCalendarApiItem = {
        ...baseItem,
        unit: "件",
        multiplier: "thousands",
      };
      expect(formatMacroCalendarValue(50, caseItem)).toBe("50千件");
    });

    it("formats job unit with multiplier: 'thousands' as 万人 (divided by 10)", () => {
      const jobItem: MacroCalendarApiItem = {
        ...baseItem,
        unit: "job",
        multiplier: "thousands",
        digits: 0,
      };
      expect(formatMacroCalendarValue(162, jobItem)).toBe("16.2万人");
    });
  });

  describe("BE-05: PUT /api/admin/passwords パラメータバインド安全化", () => {
    it("safely synchronizes SQL clauses and bound parameters on legacy column fallback", async () => {
      const adminPassword = "master-admin-password";
      const adminHash = await hashPassword(adminPassword);

      const executedQueries: { sql: string; params: unknown[] }[] = [];

      const createStatement = (sql: string) => ({
        bind: vi.fn().mockImplementation((...params: unknown[]) => ({
          run: vi.fn().mockImplementation(async () => {
            if (sql.includes("UPDATE access_passwords SET")) {
              executedQueries.push({ sql, params });
              if (sql.includes("max_indices")) {
                throw new Error("no such column: max_indices");
              }
            }
            return { success: true, meta: { changes: 1 } };
          }),
        })),
        all: vi.fn().mockImplementation(async () => {
          if (sql.includes("FROM access_passwords WHERE id = 'admin-master'")) {
            return {
              results: [
                {
                  id: "admin-master",
                  name: "Master Admin",
                  password_hash: adminHash,
                  role: "admin",
                  is_active: 1,
                },
              ],
            };
          }
          return { results: [] };
        }),
        first: vi.fn().mockResolvedValue(null),
      });

      const env: Env = {
        ASSETS: { fetch: vi.fn() },
        DB: {
          prepare: vi.fn().mockImplementation((sql: string) => createStatement(sql)),
          batch: vi.fn().mockResolvedValue([]),
        } as unknown as Env["DB"],
      };

      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${adminPassword}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "target-user",
          name: "Updated Name",
          maxStocks: 50,
          maxIndices: null, // Legacy unset
          role: "user",
          isActive: true,
        }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      // Verify two queries were executed: initial with max_indices, fallback without max_indices
      expect(executedQueries).toHaveLength(2);

      const [initialQuery, fallbackQuery] = executedQueries;

      // Initial query had max_indices = NULL
      expect(initialQuery.sql).toContain("max_indices = NULL");

      // Fallback query did NOT have max_indices
      expect(fallbackQuery.sql).not.toContain("max_indices");
      expect(fallbackQuery.sql).toContain("name = ?");
      expect(fallbackQuery.sql).toContain("max_stocks = ?");
      expect(fallbackQuery.sql).toContain("role = ?");
      expect(fallbackQuery.sql).toContain("is_active = ?");
      expect(fallbackQuery.sql).toContain("updated_at = ?");

      // Count the placeholders '?' in the SQL vs the bound params length
      const initialPlaceholders = (initialQuery.sql.match(/\?/g) || []).length;
      expect(initialQuery.params.length).toBe(initialPlaceholders);

      const fallbackPlaceholders = (fallbackQuery.sql.match(/\?/g) || []).length;
      expect(fallbackQuery.params.length).toBe(fallbackPlaceholders);

      // Verify bound parameter order matches the SQL columns
      expect(fallbackQuery.params[0]).toBe("Updated Name");
      expect(fallbackQuery.params[1]).toBe(50);
      expect(fallbackQuery.params[2]).toBe("user");
      expect(fallbackQuery.params[3]).toBe(1);
      expect(fallbackQuery.params[5]).toBe("target-user"); // WHERE id = ?
    });
  });
});
