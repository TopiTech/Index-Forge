import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getStockFundamentals,
  KNOWN_STOCK_ANCHORS,
  runStockScreener,
  type StockQuoteFundamentals,
} from "./marketDataService";
import worker from "../../worker/index";

describe("PER Accuracy and Disclosure Handling (Approach 1: TTM-based Estimation)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Static Anchor and Baseline Integrity", () => {
    it("ensures SoftBank Group (9984) anchor has null PER and null EPS due to undisclosed guidance", () => {
      const sbgAnchor = KNOWN_STOCK_ANCHORS["9984"];
      expect(sbgAnchor).toBeDefined();
      expect(sbgAnchor.per).toBeNull();
      expect(sbgAnchor.eps).toBeNull();

      const sbgFundamentals = getStockFundamentals("9984");
      expect(sbgFundamentals.per).toBeNull();
      expect(sbgFundamentals.eps).toBeNull();
    });

    it("ensures Astellas Pharma (4503) anchor has null PER due to volatile impairment losses", () => {
      const astellasAnchor = KNOWN_STOCK_ANCHORS["4503"];
      expect(astellasAnchor).toBeDefined();
      expect(astellasAnchor.per).toBeNull();

      const astellas = getStockFundamentals("4503");
      expect(astellas.per).toBeNull();
      expect(astellas.name).toContain("アステラス");
    });

    it("provides authentic anchors for newly covered popular stocks (7832, 9697, 4901)", () => {
      const bandai = getStockFundamentals("7832");
      expect(bandai.per).toBe(21.5);
      expect(bandai.name).toContain("バンダイナムコ");

      const capcom = getStockFundamentals("9697");
      expect(capcom.per).toBe(25.8);
      expect(capcom.name).toContain("カプコン");

      const fujifilm = getStockFundamentals("4901");
      expect(fujifilm.per).toBe(16.8);
      expect(fujifilm.name).toContain("富士フイルム");
    });

    it("eliminates fake synthetic PERs for unanchored unknown tickers, returning null instead", () => {
      const unknown = getStockFundamentals("UNKNOWN9999");
      expect(unknown.per).toBeNull();
      expect(unknown.eps).toBeNull();
      expect(unknown.isDemoData).toBe(true);
    });

    it("maintains accurate positive PER for established black-ink guidance stocks (e.g. 7203)", () => {
      const toyota = getStockFundamentals("7203");
      expect(toyota.per).toBe(8.3);
      expect(toyota.isEstimatedPer).toBe(false);
    });
  });

  describe("2. Worker fetchLiveStockFundamentals Live PER Resolution", () => {
    it("resolves official forward PE when company provides forward guidance", async () => {
      const mockSummary = {
        quoteSummary: {
          result: [
            {
              price: {
                regularMarketPrice: { raw: 3000 },
                regularMarketChange: { raw: 10 },
                regularMarketChangePercent: { raw: 0.0033 },
                regularMarketPreviousClose: { raw: 2990 },
                regularMarketVolume: { raw: 1000000 },
                marketCap: { raw: 3000000000000 },
              },
              defaultKeyStatistics: {
                forwardPE: { raw: 15.2 },
                trailingPE: { raw: 16.0 },
                trailingEps: { raw: 187.5 },
              },
              summaryDetail: {
                forwardPE: { raw: 15.2 },
              },
            },
          ],
        },
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("quoteSummary")) {
          return new Response(JSON.stringify(mockSummary), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ chart: { result: [] } }), { status: 200 });
      });

      const req = new Request("http://localhost/api/stock/fundamentals?ticker=7203", {
        headers: { "cf-connecting-ip": "127.0.0.1" },
      });
      const res = await worker.fetch(req, {} as any);
      expect(res.status).toBe(200);
      const data = (await res.json()) as StockQuoteFundamentals;

      expect(data.per).toBe(15.2);
      expect(data.isEstimatedPer).toBe(false);
      expect(data.perNote).toBeUndefined();
    });

    it("calculates estimated PER (Approach 1: TTM-based) when forward guidance is undisclosed but trailing EPS is positive", async () => {
      const mockSummary = {
        quoteSummary: {
          result: [
            {
              price: {
                regularMarketPrice: { raw: 3200 },
                regularMarketChange: { raw: 20 },
                regularMarketChangePercent: { raw: 0.006 },
                regularMarketPreviousClose: { raw: 3180 },
                regularMarketVolume: { raw: 500000 },
                marketCap: { raw: 1000000000000 },
              },
              defaultKeyStatistics: {
                forwardPE: null,
                trailingPE: { raw: 16.0 },
                trailingEps: { raw: 200.0 },
              },
              summaryDetail: {
                forwardPE: null,
                trailingPE: { raw: 16.0 },
              },
            },
          ],
        },
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("quoteSummary")) {
          return new Response(JSON.stringify(mockSummary), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ chart: { result: [] } }), { status: 200 });
      });

      const req = new Request("http://localhost/api/stock/fundamentals?ticker=7203&refresh=1", {
        headers: { "cf-connecting-ip": "127.0.0.1" },
      });
      const res = await worker.fetch(req, {} as any);
      expect(res.status).toBe(200);
      const data = (await res.json()) as StockQuoteFundamentals;

      expect(data.per).toBe(16.0);
      expect(data.isEstimatedPer).toBe(true);
      expect(data.perNote).toContain("会社予想非開示");
    });

    it("calculates estimated PER when forwardPE and trailingPE are missing but trailingEps > 0 (price / eps)", async () => {
      const mockSummary = {
        quoteSummary: {
          result: [
            {
              price: {
                regularMarketPrice: { raw: 3000 },
                regularMarketChange: { raw: 10 },
                regularMarketChangePercent: { raw: 0.0033 },
                regularMarketPreviousClose: { raw: 2990 },
                regularMarketVolume: { raw: 500000 },
                marketCap: { raw: 1000000000000 },
              },
              defaultKeyStatistics: {
                forwardPE: null,
                trailingPE: null,
                trailingEps: { raw: 150.0 },
              },
              summaryDetail: {},
            },
          ],
        },
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("quoteSummary")) {
          return new Response(JSON.stringify(mockSummary), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ chart: { result: [] } }), { status: 200 });
      });

      const req = new Request("http://localhost/api/stock/fundamentals?ticker=7203&refresh=1", {
        headers: { "cf-connecting-ip": "127.0.0.1" },
      });
      const res = await worker.fetch(req, {} as any);
      expect(res.status).toBe(200);
      const data = (await res.json()) as StockQuoteFundamentals;

      expect(data.per).toBe(20.0);
      expect(data.isEstimatedPer).toBe(true);
      expect(data.perNote).toContain("会社予想非開示のため直近実績(TTM)より推計");
    });

    it("guarantees per is null when ticker is in the red (trailingEps <= 0) and forwardPE is missing, avoiding fallback to fake numbers", async () => {
      const mockSummary = {
        quoteSummary: {
          result: [
            {
              price: {
                regularMarketPrice: { raw: 1500 },
                regularMarketChange: { raw: -20 },
                regularMarketChangePercent: { raw: -0.013 },
                regularMarketPreviousClose: { raw: 1520 },
                regularMarketVolume: { raw: 800000 },
                marketCap: { raw: 500000000000 },
              },
              defaultKeyStatistics: {
                forwardPE: null,
                trailingPE: null,
                trailingEps: { raw: -85.0 }, // 赤字
              },
              summaryDetail: {},
            },
          ],
        },
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("quoteSummary")) {
          return new Response(JSON.stringify(mockSummary), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ chart: { result: [] } }), { status: 200 });
      });

      const req = new Request("http://localhost/api/stock/fundamentals?ticker=7203&refresh=1", {
        headers: { "cf-connecting-ip": "127.0.0.1" },
      });
      const res = await worker.fetch(req, {} as any);
      expect(res.status).toBe(200);
      const data = (await res.json()) as StockQuoteFundamentals;

      expect(data.per).toBeNull();
      expect(data.isEstimatedPer).toBe(false);
    });
  });

  describe("3. Screener Filtering and Sorting with null / estimated PER", () => {
    it("sorts null PER stocks to the end when sorting by per in ascending or descending order", () => {
      const asc = runStockScreener({ sortBy: "per", sortOrder: "asc" });
      const nonNulls = asc.filter((s) => s.per !== null);
      const nulls = asc.filter((s) => s.per === null);

      expect(nonNulls.length).toBeGreaterThan(0);
      expect(nulls.length).toBeGreaterThan(0);

      expect(asc[0].per).not.toBeNull();
      expect(asc[0].per!).toBeGreaterThan(0);

      expect(asc[asc.length - 1].per).toBeNull();

      const sbg = asc.find((s) => s.ticker === "9984");
      expect(sbg?.per).toBeNull();
    });

    it("excludes null PER stocks when maxPer filter is applied", () => {
      const results = runStockScreener({ maxPer: 25 });
      for (const item of results) {
        expect(item.per).not.toBeNull();
        expect(item.per!).toBeLessThanOrEqual(25);
      }
      expect(results.some((s) => s.ticker === "9984")).toBe(false);
    });
  });

  describe("4. UI Presentation & Disclosure Semantics", () => {
    it("verifies StockDetailPage.tsx contains badge for estimated PER and clear disclosure for null PER", async () => {
      const { readFileSync } = await import("fs");
      const { resolve } = await import("path");
      const detailTsx = readFileSync(resolve(__dirname, "../components/StockDetailPage.tsx"), "utf-8");

      expect(detailTsx).toContain("推測 (実績TTM)");
      expect(detailTsx).toContain("非公開・算出対象外");
      expect(detailTsx).toContain("stock.isEstimatedPer");
      expect(detailTsx).toContain("stock.perNote");
    });

    it("verifies StockAnalysisPage.tsx contains approx notation for estimated PER", async () => {
      const { readFileSync } = await import("fs");
      const { resolve } = await import("path");
      const screenerTsx = readFileSync(resolve(__dirname, "../components/StockAnalysisPage.tsx"), "utf-8");

      expect(screenerTsx).toContain("stock.isEstimatedPer");
      expect(screenerTsx).toContain("約");
      expect(screenerTsx).toContain("stock.perNote");
    });
  });
});
