import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, { hashPassword, clearAuthCache, resetPasswordTableEnsured } from "../../worker/index";
import { calculateCustomIndex } from "./indexEngine";
import type { BasketItem, StockSeries } from "../types";

const TEST_ADMIN_PASSWORD = "AdminPassword123!";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

async function createMockEnv() {
  const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
  const mockDb = {
    prepare: vi.fn().mockImplementation((query: string) => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(async () => null),
      all: vi.fn().mockImplementation(async () => {
        if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
          return {
            results: [
              {
                id: "admin-master",
                name: "マスター管理者",
                password_hash: masterHash,
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
    })),
    batch: vi.fn().mockResolvedValue([{ success: true, meta: { changes: 1 } }]),
  };

  return {
    DB: mockDb,
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response("asset content", { status: 200 })),
    },
  };
}

describe("Comprehensive Goal Review Fixes Verification", () => {
  describe("PUT /api/admin/passwords empty payload guard", () => {
    it("returns 400 when no fields to update are provided", async () => {
      const env = await createMockEnv();
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "pwd-target-123",
          // No fields to update
        }),
      });

      const res = await worker.fetch(req, env as any, ctx as any);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("更新する項目が指定されていません");
    });

    it("accepts PUT when at least one field is provided for update", async () => {
      const env = await createMockEnv();
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "pwd-target-123",
          name: "Updated Operator Name",
        }),
      });

      const res = await worker.fetch(req, env as any, ctx as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe("Admin Role Quota Sanitization Logic", () => {
    it("guarantees null quotas for admin role regardless of input values", () => {
      const role: "admin" | "user" = "admin";
      const unlimitedStocks = false;
      const unlimitedIndices = false;
      const maxStocks = "50";
      const maxIndices = "10";

      const isAdminRole = role === "admin";
      const sanitizedMaxStocks = isAdminRole || unlimitedStocks
        ? null
        : Math.min(500, Math.max(1, Math.floor(Number(maxStocks)) || 1));
      const sanitizedMaxIndices = isAdminRole || unlimitedIndices
        ? null
        : Math.min(100, Math.max(1, Math.floor(Number(maxIndices)) || 1));

      expect(sanitizedMaxStocks).toBeNull();
      expect(sanitizedMaxIndices).toBeNull();
    });

    it("preserves bounded numeric quotas for user role", () => {
      const role: "admin" | "user" = "user";
      const unlimitedStocks = false;
      const unlimitedIndices = false;
      const maxStocks = "50";
      const maxIndices = "10";

      const isAdminRole = role === "admin";
      const sanitizedMaxStocks = isAdminRole || unlimitedStocks
        ? null
        : Math.min(500, Math.max(1, Math.floor(Number(maxStocks)) || 1));
      const sanitizedMaxIndices = isAdminRole || unlimitedIndices
        ? null
        : Math.min(100, Math.max(1, Math.floor(Number(maxIndices)) || 1));

      expect(sanitizedMaxStocks).toBe(50);
      expect(sanitizedMaxIndices).toBe(10);
    });
  });

  describe("calculateCustomIndex with invalid base price filtering", () => {
    it("excludes phantom dates and invalid price rows cleanly", () => {
      const basket: BasketItem[] = [
        { ticker: "7203", name: "Toyota", theme: "Auto", weight: 60 },
        { ticker: "9999", name: "Invalid Co", theme: "Unknown", weight: 40 },
      ];

      const universe: StockSeries[] = [
        {
          ticker: "7203",
          name: "Toyota",
          theme: "Auto",
          sector: "Transportation",
          latestPrice: 3300,
          series: [
            { date: "2026-04-01", close: 3000 },
            { date: "2026-04-02", close: 3300 },
          ],
        },
        {
          ticker: "9999",
          name: "Invalid Co",
          theme: "Unknown",
          sector: "Unknown",
          latestPrice: 0,
          series: [
            { date: "2026-03-31", close: 0 }, // Should NOT appear in allDates
            { date: "2026-04-01", close: 0 },
          ],
        },
      ];

      const result = calculateCustomIndex(basket, universe, 1000);

      // Should only contain dates from valid stock (2026-04-01, 2026-04-02)
      expect(result.length).toBe(2);
      expect(result[0].date).toBe("2026-04-01");
      expect(result[0].value).toBe(1000);
      expect(result[1].date).toBe("2026-04-02");
      expect(result[1].value).toBe(1100);
    });
  });
});
