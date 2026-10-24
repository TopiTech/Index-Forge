import { describe, it, expect } from "vitest";
import {
  parseNumericValue,
  deserializePortfolioFromCsv,
  deserializeBasketFromCsv,
} from "./indexSerialization";
import worker from "../../worker/index";
import {
  hashPassword,
  cacheHits,
  cacheMisses,
  resetCacheMetrics,
  getMemoryCacheEntry,
  setMemoryCache,
  clearMemoryCache,
  setAllowMemoryCacheInTest,
} from "../../worker/internal";
import * as fs from "fs";
import * as path from "path";

function createMockTelemetryDb(masterHash: string) {
  return {
    prepare: (query: string) => {
      return {
        bind: (..._args: unknown[]) => ({
          all: async () => {
            if (query.includes("access_passwords") && query.includes("GROUP BY")) {
              return {
                results: [
                  { role: "admin", is_active: 1, count: 1 },
                  { role: "user", is_active: 1, count: 4 },
                  { role: "user", is_active: 0, count: 1 },
                ],
              };
            }
            if (query.includes("access_passwords WHERE id = 'admin-master'")) {
              return {
                results: [
                  {
                    id: "admin-master",
                    name: "マスター管理者",
                    password_hash: masterHash,
                    role: "admin",
                    max_stocks: null,
                    is_active: 1,
                  },
                ],
              };
            }
            return { results: [] };
          },
          first: async <T>() => {
            if (query.includes("COUNT(*) as count FROM indices")) {
              return { count: 3 } as T;
            }
            if (query.includes("COUNT(*) as count FROM basket_items")) {
              return { count: 15 } as T;
            }
            if (query.includes("COUNT(*) as count FROM rate_limits")) {
              return { count: 2 } as T;
            }
            return null;
          },
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }),
        all: async () => {
          if (query.includes("access_passwords") && query.includes("GROUP BY")) {
            return {
              results: [
                { role: "admin", is_active: 1, count: 1 },
                { role: "user", is_active: 1, count: 4 },
                { role: "user", is_active: 0, count: 1 },
              ],
            };
          }
          if (query.includes("access_passwords WHERE id = 'admin-master'")) {
            return {
              results: [
                {
                  id: "admin-master",
                  name: "マスター管理者",
                  password_hash: masterHash,
                  role: "admin",
                  max_stocks: null,
                  is_active: 1,
                },
              ],
            };
          }
          return { results: [] };
        },
        first: async <T>() => {
          if (query.includes("COUNT(*) as count FROM indices")) {
            return { count: 3 } as T;
          }
          if (query.includes("COUNT(*) as count FROM basket_items")) {
            return { count: 15 } as T;
          }
          if (query.includes("COUNT(*) as count FROM rate_limits")) {
            return { count: 2 } as T;
          }
          return null;
        },
        run: async () => ({ success: true, meta: { changes: 1 } }),
      };
    },
  };
}

describe("Comprehensive Code Review Audit Fulfillment", () => {
  describe("1. Numeric Parsing & Japanese Character Normalization (parseNumericValue)", () => {
    it("handles full-width Japanese decimal points (．) correctly without dropping fractional part", () => {
      expect(parseNumericValue("１２．５")).toBe(12.5);
      expect(parseNumericValue("０．７５")).toBe(0.75);
      expect(parseNumericValue("１００．０５")).toBe(100.05);
    });

    it("handles full-width Japanese commas (，) correctly without returning truncated single digit", () => {
      expect(parseNumericValue("１，５００")).toBe(1500);
      expect(parseNumericValue("２５，０００")).toBe(25000);
      expect(parseNumericValue("１，５００．７５")).toBe(1500.75);
    });

    it("handles full-width negative signs and dashes (－, ー, ―)", () => {
      expect(parseNumericValue("－２５０．５")).toBe(-250.5);
      expect(parseNumericValue("ー１００")).toBe(-100);
      expect(parseNumericValue("―５０．２")).toBe(-50.2);
    });

    it("handles currency symbols with full-width numbers and commas", () => {
      expect(parseNumericValue("￥１，２００")).toBe(1200);
      expect(parseNumericValue("¥３，５００．５０")).toBe(3500.5);
      expect(parseNumericValue("＄１８５．２０")).toBe(185.2);
    });

    it("deserializes Japanese broker CSV with full-width decimal points and commas", () => {
      const brokerCsv = [
        "コード,銘柄名,保有株数,取得単価,取得日,メモ",
        '7203,トヨタ自動車,"１，５００","¥２，８５０．５０",2026-01-15,SBI証券',
        '6758,ソニーグループ,５００,"￥１２，３００．７５",2026-03-10,楽天証券',
      ].join("\r\n");

      const result = deserializePortfolioFromCsv(brokerCsv);
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBe(2);

      const toyota = result.data!.find((p) => p.ticker === "7203")!;
      expect(toyota.shares).toBe(1500);
      expect(toyota.averageCost).toBe(2850.5);

      const sony = result.data!.find((p) => p.ticker === "6758")!;
      expect(sony.shares).toBe(500);
      expect(sony.averageCost).toBe(12300.75);
    });

    it("deserializes basket CSV with full-width weights", () => {
      const basketCsv = [
        "コード,銘柄名,テーマ,ウェイト",
        '7203,トヨタ自動車,自動車,"３３．３"',
        '6758,ソニーグループ,エンタメ,"３３．３"',
        '8035,東京エレクトロン,半導体,"３３．４"',
      ].join("\n");

      const result = deserializeBasketFromCsv(basketCsv);
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBe(3);
      expect(result.data![0].weight).toBe(33.3);
      expect(result.data![1].weight).toBe(33.3);
      expect(result.data![2].weight).toBe(33.4);
    });
  });

  describe("2. System Telemetry & Cache Metrics (/api/admin/system-stats)", () => {
    it("returns avgConstituentsPerIndex and cache hit/miss breakdown", async () => {
      const masterHash = await hashPassword("admin-test-pass-999");
      const env = {
        DB: createMockTelemetryDb(masterHash),
        ADMIN_PASSWORD: "admin-test-pass-999",
      };

      const req = new Request("http://localhost/api/admin/system-stats", {
        method: "GET",
        headers: {
          "x-auth-password": "admin-test-pass-999",
        },
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.stats).toBeDefined();
      expect(data.stats.indicesCount).toBe(3);
      expect(data.stats.totalConstituents).toBe(15);
      // 15 constituents / 3 indices = 5.0
      expect(data.stats.avgConstituentsPerIndex).toBe(5);
      expect(data.stats.cacheStats).toBeDefined();
      expect(typeof data.stats.cacheStats.hits).toBe("number");
      expect(typeof data.stats.cacheStats.misses).toBe("number");
      expect(typeof data.stats.cacheStats.hitRatio).toBe("string");
    });

    it("tracks cache hit and miss counters accurately in getMemoryCacheEntry", () => {
      resetCacheMetrics();
      setAllowMemoryCacheInTest(true);
      clearMemoryCache();

      // Non-existent key -> cache miss
      const lookup1 = getMemoryCacheEntry("test-key-missing");
      expect(lookup1).toBeNull();
      expect(cacheMisses).toBe(1);
      expect(cacheHits).toBe(0);

      // Set key and retrieve -> cache hit
      setMemoryCache("test-key-hit", { foo: "bar" }, 60);
      const lookup2 = getMemoryCacheEntry("test-key-hit");
      expect(lookup2).not.toBeNull();
      expect(cacheHits).toBe(1);
      expect(cacheMisses).toBe(1);

      setAllowMemoryCacheInTest(false);
      clearMemoryCache();
    });
  });

  describe("3. UI Accessibility Contracts for Authentication Tabs & Turnstile", () => {
    it("ensures AuthModal mode switch implements the toggle-group contract", () => {
      const authModalPath = path.resolve(process.cwd(), "src/components/AuthModal.tsx");
      const content = fs.readFileSync(authModalPath, "utf-8");

      // UI-13: both modes share ONE form, so there is no tabpanel for a tab
      // to control. The switch is a named group of toggle buttons instead.
      expect(content).toContain('role="group"');
      expect(content).toContain('aria-label="認証モード切替"');
      expect(content).toContain('id="auth-modal-mode-admin"');
      expect(content).toContain('id="auth-modal-mode-user"');

      // The selection state is exposed through aria-pressed.
      expect(content).toContain('aria-pressed={authMode === "admin"}');
      expect(content).toContain('aria-pressed={authMode === "user"}');

      // Both buttons stay in the tab order; the arrow keys are a convenience.
      expect(content).toContain("onKeyDown={handleModeKeyDown}");
      expect(content).not.toContain('tabIndex={authMode === "admin" ? 0 : -1}');
      expect(content).not.toContain('tabIndex={authMode === "user" ? 0 : -1}');

      // The tab semantics are gone: a tab must not claim to control the form.
      expect(content).not.toContain('role="tablist"');
      expect(content).not.toContain('role="tab"');
      expect(content).not.toContain('aria-controls="auth-modal-form"');

      // The shared form the two modes submit.
      expect(content).toContain('id="auth-modal-form"');

      // The accessible names of the two mode buttons.
      expect(content).toContain("管理者ログイン");
      expect(content).toContain("一般ユーザー");
    });

    it("ensures PortfolioManagerPage tabs implement WAI-ARIA tab navigation contracts", () => {
      const portfolioPath = path.resolve(process.cwd(), "src/components/PortfolioManagerPage.tsx");
      const content = fs.readFileSync(portfolioPath, "utf-8");

      expect(content).toContain('id="portfolio-auth-tab-admin"');
      expect(content).toContain('id="portfolio-auth-tab-user"');
      expect(content).toContain('aria-controls="portfolio-inline-auth-form"');
      expect(content).toContain('tabIndex={authMode === "admin" ? 0 : -1}');
      expect(content).toContain('tabIndex={authMode === "user" ? 0 : -1}');
      expect(content).toContain("onKeyDown={handleTabKeyDown}");
    });

    it("ensures schema.migration.sql contains CREATE TABLE IF NOT EXISTS admin_login_attempts", () => {
      const migrationPath = path.resolve(process.cwd(), "schema.migration.sql");
      const content = fs.readFileSync(migrationPath, "utf-8");

      expect(content).toContain("CREATE TABLE IF NOT EXISTS admin_login_attempts");
      expect(content).toContain("ip TEXT PRIMARY KEY");
    });
  });
});
