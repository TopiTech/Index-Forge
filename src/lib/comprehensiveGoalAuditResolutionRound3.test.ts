import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearMemoryCache,
  clearMemoryRateLimits,
  resetPasswordTableEnsured,
  clearAuthCache,
  hashPassword,
} from "../../worker/internal";
import {
  savePortfolioPositions,
  saveWatchlist,
  addPortfolioPosition,
  addWatchlistTicker,
} from "./portfolioStorage";
import fs from "fs";
import path from "path";

const TEST_ADMIN_PASSWORD = "test-admin-password";

describe("Comprehensive Goal Audit & Remediation Suite (Round 3)", () => {
  beforeEach(() => {
    clearMemoryCache();
    clearMemoryRateLimits();
    resetPasswordTableEnsured();
    clearAuthCache();
    vi.restoreAllMocks();
  });

  describe("1. Security: Admin Password Collision & Privilege Escalation Prevention (SEC-01)", () => {
    it("POST /api/admin/passwords blocks creating an admin account with a password colliding with any user", async () => {
      const existingUserHash = await hashPassword("user-pass-123");
      const passwordsMap = new Map<string, any>();
      passwordsMap.set("user-1", {
        id: "user-1",
        name: "First User",
        role: "user",
        password_hash: existingUserHash,
        is_active: 1,
        created_at: 1000,
        updated_at: 1000,
      });

      const env: any = {
        ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
        ASSETS: { fetch: vi.fn() },
        DB: {
          prepare: vi.fn().mockImplementation((query: string) => {
            return {
              bind: vi.fn().mockImplementation((..._params: any[]) => ({
                first: vi.fn().mockResolvedValue(null),
                all: vi.fn().mockImplementation(async () => {
                  if (query.includes("access_passwords")) {
                    return { results: Array.from(passwordsMap.values()) };
                  }
                  return { results: [] };
                }),
                run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
              })),
              all: vi.fn().mockImplementation(async () => {
                if (query.includes("access_passwords")) {
                  return { results: Array.from(passwordsMap.values()) };
                }
                return { results: [] };
              }),
              run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
            };
          }),
        },
      };

      const req = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "New Admin",
          password: "user-pass-123",
          role: "admin",
        }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("既存のユーザーアカウントで使用されているパスワードは管理者に設定できません");
    });

    it("POST /api/admin/passwords blocks creating a user account colliding with the admin password", async () => {
      const passwordsMap = new Map<string, any>();

      const env: any = {
        ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
        ASSETS: { fetch: vi.fn() },
        DB: {
          prepare: vi.fn().mockImplementation((query: string) => {
            return {
              bind: vi.fn().mockImplementation((..._params: any[]) => ({
                first: vi.fn().mockResolvedValue(null),
                all: vi.fn().mockImplementation(async () => {
                  if (query.includes("access_passwords")) {
                    return { results: Array.from(passwordsMap.values()) };
                  }
                  return { results: [] };
                }),
                run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
              })),
              all: vi.fn().mockImplementation(async () => {
                if (query.includes("access_passwords")) {
                  return { results: Array.from(passwordsMap.values()) };
                }
                return { results: [] };
              }),
              run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
            };
          }),
        },
      };

      const req = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "Imposter User",
          password: TEST_ADMIN_PASSWORD,
          role: "user",
        }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("管理者アカウントと同一のパスワードは設定できません");
    });
  });

  describe("2. Static Assets: Null-Body Status Handling (COR-01)", () => {
    it("handles 304 Not Modified responses from env.ASSETS without throwing TypeError or returning 502", async () => {
      const mock304Response = new Response(null, {
        status: 304,
        statusText: "Not Modified",
        headers: {
          etag: '"test-etag-123"',
        },
      });

      const env: any = {
        ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
        ASSETS: {
          fetch: vi.fn().mockResolvedValue(mock304Response),
        },
        DB: {
          prepare: vi.fn(),
        },
      };

      const req = new Request("http://localhost/assets/index.js", {
        method: "GET",
        headers: {
          "If-None-Match": '"test-etag-123"',
        },
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(304);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    });
  });

  describe("3. D1 Database: single-query read for GET /api/indices (PRF-02)", () => {
    it("returns every constituent from one query with no LIMIT/OFFSET paging", async () => {
      // Exactly 2,000 rows — a multiple of the old 1,000-row "page" size, the
      // boundary at which the removed pagination fired an extra full query.
      // That paging rested on a false premise (D1 does not cap SELECT results
      // at 1,000 rows: checked against the official D1 limits documentation
      // and a 2,500-row probe through the wrangler binding), and OFFSET
      // paging could drop or duplicate rows under concurrent writes. One
      // query must now return the whole result set.
      const rows = Array.from({ length: 2000 }, (_, i) => ({
        id: "idx-big",
        name: "Big Index",
        description: "Test Desc",
        base_value: 1000,
        sort_order: 1,
        ticker: `TICKER${i}`,
        stock_name: `Stock ${i}`,
        weight: 1,
        theme: "Tech",
      }));

      const queriesExecuted: string[] = [];
      const env: any = {
        ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
        ASSETS: { fetch: vi.fn() },
        DB: {
          prepare: vi.fn().mockImplementation((query: string) => {
            queriesExecuted.push(query);
            return {
              bind: vi.fn().mockImplementation(() => ({
                all: vi.fn().mockImplementation(async () => ({ results: rows })),
              })),
              all: vi.fn().mockImplementation(async () => ({ results: rows })),
            };
          }),
        },
      };

      const req = new Request("http://localhost/api/indices", {
        method: "GET",
        headers: { "Cache-Control": "no-cache" },
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);

      // The constituents read runs exactly once and never pages.
      const constituentQueries = queriesExecuted.filter((q) => q.includes("FROM indices"));
      expect(constituentQueries).toHaveLength(1);
      expect(queriesExecuted.some((q) => q.includes("OFFSET"))).toBe(false);

      // Every row surfaced: nothing truncated at the old 1,000-row boundary.
      const totalConstituents = data.reduce((sum: number, idx: any) => sum + idx.basket.length, 0);
      expect(totalConstituents).toBe(2000);
    });
  });

  describe("4. Portfolio Storage: Quota Error & Persistence Result Handling (STORAGE-01)", () => {
    it("savePortfolioPositions returns false on localStorage quota failure", () => {
      const mockStorage = {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn().mockImplementation(() => {
          throw new Error("QuotaExceededError: storage is full");
        }),
        removeItem: vi.fn(),
        clear: vi.fn(),
      };
      vi.stubGlobal("localStorage", mockStorage);

      const result = savePortfolioPositions([
        {
          id: "pos-1",
          ticker: "7203",
          name: "Toyota",
          shares: 100,
          averageCost: 2500,
          acquiredAt: "2026-01-01",
        },
      ]);
      expect(result).toBe(false);

      const addResult = addPortfolioPosition({
        ticker: "9984",
        name: "SoftBank",
        shares: 50,
        averageCost: 8000,
        acquiredAt: "2026-01-01",
      });
      expect(addResult).toBe(false);

      vi.unstubAllGlobals();
    });

    it("saveWatchlist returns false on storage quota failure", () => {
      const mockStorage = {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn().mockImplementation(() => {
          throw new Error("QuotaExceededError");
        }),
        removeItem: vi.fn(),
        clear: vi.fn(),
      };
      vi.stubGlobal("localStorage", mockStorage);

      const result = saveWatchlist(["7203", "9984"]);
      expect(result).toBe(false);

      const addResult = addWatchlistTicker("6758");
      expect(addResult).toBe(false);

      vi.unstubAllGlobals();
    });
  });

  describe("5. UI & Accessibility Enhancements (A11Y-01)", () => {
    const screenerSrc = fs.readFileSync(
      path.resolve(__dirname, "../components/ScreenerPage.tsx"),
      "utf-8"
    );
    const stockDetailSrc = fs.readFileSync(
      path.resolve(__dirname, "../components/StockDetailPage.tsx"),
      "utf-8"
    );
    const chartSrc = fs.readFileSync(
      path.resolve(__dirname, "../components/StockTechnicalChart.tsx"),
      "utf-8"
    );
    const builderSrc = fs.readFileSync(
      path.resolve(__dirname, "../components/IndexBuilderContent.tsx"),
      "utf-8"
    );

    it("ScreenerPage table header and row buttons have checkbox roles and aria-checked states", () => {
      expect(screenerSrc).toContain('role="checkbox"');
      expect(screenerSrc).toContain('aria-checked={isAllSelected ? "true" : isPartiallySelected ? "mixed" : "false"}');
      expect(screenerSrc).toContain('aria-checked={isSelected ? "true" : "false"}');
    });

    it("StockDetailPage includes screen-reader accessible live status feedback", () => {
      expect(stockDetailSrc).toContain('role="status"');
      expect(stockDetailSrc).toContain('aria-live="polite"');
    });

    it("StockTechnicalChart includes region role and accessible label for TradingView embed", () => {
      expect(chartSrc).toContain('role="region"');
      expect(chartSrc).toContain("TradingViewチャート");
    });

    it("IndexBuilderContent wraps strategy presets with role=group and label", () => {
      expect(builderSrc).toContain('role="group"');
      expect(builderSrc).toContain('aria-label="戦略プリセット一覧"');
    });
  });
});
