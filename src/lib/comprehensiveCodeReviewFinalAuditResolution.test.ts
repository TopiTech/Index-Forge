import { describe, expect, it, vi, beforeEach } from "vitest";
import worker from "../../worker/index";
import {
  fetchYahooFinance,
  hashPassword,
  METHOD_NOT_ALLOWED_GET_MESSAGE,
  METHOD_NOT_ALLOWED_POST_MESSAGE,
  METHOD_NOT_ALLOWED_PUT_MESSAGE,
  METHOD_NOT_ALLOWED_INDICES_MESSAGE,
  METHOD_NOT_ALLOWED_INDICES_STOCK_MESSAGE,
  METHOD_NOT_ALLOWED_PASSWORDS_MESSAGE,
  METHOD_NOT_ALLOWED_SECRET_CODE_MESSAGE,
  ENDPOINT_NOT_FOUND_MESSAGE,
  clearMemoryRateLimits,
} from "../../worker/internal-impl";
import { buildIndexPriceMatrix } from "./indexEngine";
import { loadPortfolioPositions, STORAGE_KEY_PORTFOLIO } from "./portfolioStorage";
import type { BasketItem, StockSeries } from "../types";

function createTestEnv(batchResult?: Array<{ meta?: { changes?: number } }>) {
  const prepare = vi.fn().mockImplementation((_query: string) => {
    const statement = {
      bind: vi.fn().mockImplementation(() => statement),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({
        success: true,
        meta: { changes: 1 },
      }),
    };
    return statement;
  });

  return {
    DB: {
      prepare,
      batch: vi.fn().mockResolvedValue(
        batchResult ?? [
          { success: true, meta: { changes: 1 } },
          { success: true, meta: { changes: 1 } },
        ],
      ),
    },
    ADMIN_PASSWORD: "AdminMasterPassword123!",
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response("asset")) },
  };
}

describe("Comprehensive Code Review Final Audit Resolution", () => {
  beforeEach(() => {
    clearMemoryRateLimits();
    vi.restoreAllMocks();
  });

  describe("RFC 9110 HTTP 405 Method Not Allowed Compliance across API Endpoints", () => {
    it("returns 405 with Allow: POST for GET /api/auth/admin-login", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/auth/admin-login", { method: "GET" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_POST_MESSAGE);
    });

    it("returns 405 with Allow: POST for GET /api/auth/verify", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/auth/verify", { method: "GET" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_POST_MESSAGE);
    });

    it("returns 405 with Allow: GET, POST, PUT, DELETE for PATCH /api/admin/passwords", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/admin/passwords", { method: "PATCH" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, POST, PUT, DELETE");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_PASSWORDS_MESSAGE);
    });

    it("returns 405 with Allow: PUT for GET /api/admin/admin-password", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/admin/admin-password", { method: "GET" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("PUT");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_PUT_MESSAGE);
    });

    it("returns 405 with Allow: PUT, POST for DELETE /api/admin/admin-secret-code", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/admin/admin-secret-code", { method: "DELETE" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("PUT, POST");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_SECRET_CODE_MESSAGE);
    });

    it("returns 405 with Allow: GET for POST /api/admin/system-stats", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/admin/system-stats", { method: "POST" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_GET_MESSAGE);
    });

    it("returns 405 with Allow: POST, DELETE for GET /api/indices/stock", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/indices/stock", { method: "GET" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST, DELETE");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_INDICES_STOCK_MESSAGE);
    });

    it("returns 405 with Allow: GET for POST /api/snapshot", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/snapshot", { method: "POST" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_GET_MESSAGE);
    });

    it("returns 405 with Allow: GET for POST /api/ticker-prices", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/ticker-prices", { method: "POST" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_GET_MESSAGE);
    });

    it("returns 405 with Allow: GET for POST /api/market/overview", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/market/overview", { method: "POST" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_GET_MESSAGE);
    });

    it("returns 405 with Allow: GET for POST /api/stock/fundamentals", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/stock/fundamentals", { method: "POST" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_GET_MESSAGE);
    });

    it("returns 405 with Allow: GET for POST /api/stocks/screener", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/stocks/screener", { method: "POST" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_GET_MESSAGE);
    });

    it("returns 405 with Allow: GET for POST /api/market/calendar", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/market/calendar", { method: "POST" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_GET_MESSAGE);
    });

    it("returns 405 with Allow: GET, POST, DELETE for PUT /api/indices", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/indices", { method: "PUT" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, POST, DELETE");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_INDICES_MESSAGE);
    });

    it("returns 405 with Allow: POST for GET /api/sync-prices", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/sync-prices", { method: "GET" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_POST_MESSAGE);
    });

    it("returns 405 with Allow: POST for GET /api/calculate", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/calculate", { method: "GET" }), env as never);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      const body = await res.json() as { error: string };
      expect(body.error).toBe(METHOD_NOT_ALLOWED_POST_MESSAGE);
    });

    it("returns 404 for unknown /api/* endpoints", async () => {
      const env = createTestEnv();
      const res = await worker.fetch(new Request("http://localhost/api/unknown-service-probe", { method: "GET" }), env as never);
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toBe(ENDPOINT_NOT_FOUND_MESSAGE);
    });
  });

  describe("DELETE /api/admin/passwords with zero changes", () => {
    it("returns 404 when batch returns zero changes", async () => {
      const adminPassword = "AdminMasterPassword123!";
      const adminHash = await hashPassword(adminPassword);
      const env = createTestEnv([
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
      ]);
      env.ADMIN_PASSWORD = adminPassword;
      env.DB.prepare = vi.fn().mockImplementation((query: string) => {
        const stmt = {
          bind: vi.fn().mockImplementation(() => stmt),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockImplementation(async () => {
            if (query.includes("WHERE id = 'admin-master'")) {
              return {
                results: [{
                  id: "admin-master",
                  name: "マスター管理者",
                  password_hash: adminHash,
                  role: "admin",
                  is_active: 1,
                }],
              };
            }
            return { results: [] };
          }),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        };
        return stmt;
      });

      const res = await worker.fetch(
        new Request("http://localhost/api/admin/passwords?id=non-existent-user", {
          method: "DELETE",
          headers: { "x-auth-password": adminPassword },
        }),
        env as never,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("fetchYahooFinance precision preservation", () => {
    it("preserves up to 4 decimal places for prices below 1, while rounding prices >= 1 to 2 decimals", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  timestamp: [1700000000, 1700086400],
                  indicators: {
                    quote: [
                      {
                        close: [0.007842, 154.3491],
                        volume: [1000, 2000],
                      },
                    ],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

      const series = await fetchYahooFinance("TEST.SYM", "1y");
      expect(series).toHaveLength(2);
      expect(series[0].close).toBe(0.0078); // 4 decimals for < 1
      expect(series[1].close).toBe(154.35); // 2 decimals for >= 1
      fetchSpy.mockRestore();
    });
  });

  describe("buildIndexPriceMatrix duplicate ticker consolidation", () => {
    it("consolidates duplicate tickers in basket and combines their weights", () => {
      const basket: BasketItem[] = [
        { ticker: "7203", name: "トヨタ", weight: 30, theme: "auto" },
        { ticker: "７２０３", name: "トヨタ重複", weight: 20, theme: "auto" },
        { ticker: "6758", name: "ソニー", weight: 50, theme: "tech" },
      ];

      const stockUniverse: StockSeries[] = [
        {
          ticker: "7203",
          name: "トヨタ自動車",
          theme: "auto",
          sector: "輸送用機器",
          latestPrice: 2100,
          series: [
            { date: "2026-01-01", close: 2000, value: 2000 },
            { date: "2026-01-02", close: 2100, value: 2100 },
          ],
        },
        {
          ticker: "6758",
          name: "ソニーグループ",
          theme: "tech",
          sector: "電気機器",
          latestPrice: 3150,
          series: [
            { date: "2026-01-01", close: 3000, value: 3000 },
            { date: "2026-01-02", close: 3150, value: 3150 },
          ],
        },
      ];

      const matrix = buildIndexPriceMatrix(basket, stockUniverse);
      expect(matrix.rows).toHaveLength(2); // Only 2 unique stocks: 7203 and 6758
      const toyotaRow = matrix.rows.find((r) => r.ticker === "7203");
      const sonyRow = matrix.rows.find((r) => r.ticker === "6758");
      expect(toyotaRow).toBeDefined();
      expect(sonyRow).toBeDefined();
      expect(toyotaRow!.weight).toBe(50); // 30 + 20
      expect(sonyRow!.weight).toBe(50);
      expect(matrix.tickerIndex.get("7203")).toBeDefined();
      expect(matrix.tickerIndex.get("6758")).toBeDefined();
    });
  });

  describe("portfolioStorage sanitizePosition whitespace trimming", () => {
    it("trims acquiredAt and notes, dropping whitespace-only strings to undefined", () => {
      const mockStorage = new Map<string, string>();
      const storageObj = {
        getItem: (k: string) => mockStorage.get(k) ?? null,
        setItem: (k: string, v: string) => mockStorage.set(k, v),
        removeItem: (k: string) => mockStorage.delete(k),
        clear: () => mockStorage.clear(),
        key: () => null,
        length: mockStorage.size,
      };
      vi.stubGlobal("localStorage", storageObj);

      const positionsWithWhitespace = [
        {
          id: "pos-1",
          ticker: "7203",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2500,
          acquiredAt: "   2026-01-15   ",
          notes: "    ",
        },
      ];

      mockStorage.set(STORAGE_KEY_PORTFOLIO, JSON.stringify(positionsWithWhitespace));
      const loaded = loadPortfolioPositions();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].acquiredAt).toBe("2026-01-15");
      expect(loaded[0].notes).toBeUndefined();

      vi.unstubAllGlobals();
    });
  });
});
