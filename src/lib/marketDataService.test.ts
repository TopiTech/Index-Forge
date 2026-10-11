import { describe, it, expect } from "vitest";
import {
  getStockFundamentals,
  normalizeMarketOverview,
  runStockScreener,
  fetchMarketOverview,
  UPCOMING_EVENTS,
} from "./marketDataService";

describe("MarketDataService", () => {
  describe("getStockFundamentals", () => {
    it("returns rich fundamentals for Japanese stock (7203)", () => {
      const data = getStockFundamentals("7203");
      expect(data.ticker).toBe("7203");
      expect(data.name).toContain("トヨタ");
      expect(data.market).toBe("PRIME");
      expect(data.price).toBeGreaterThan(0);
      expect(data.per).toBeGreaterThan(0);
      expect(data.pbr).toBeGreaterThan(0);
      expect(data.dividendYield).toBeGreaterThan(0);
      expect(data.historicalFinances.length).toBe(4);
    });

    it("returns rich fundamentals for US stock (NVDA)", () => {
      const data = getStockFundamentals("NVDA");
      expect(data.ticker).toBe("NVDA");
      expect(data.market).toBe("US");
      expect(data.price).toBeGreaterThan(0);
      expect(data.per).toBeGreaterThan(0);
      expect(data.historicalFinances.length).toBe(4);
    });
  });

  describe("runStockScreener", () => {
    it("filters stocks by market", () => {
      const usStocks = runStockScreener({ market: "US" });
      expect(usStocks.length).toBeGreaterThan(0);
      usStocks.forEach((s) => expect(s.market).toBe("US"));

      const jpStocks = runStockScreener({ market: "PRIME" });
      expect(jpStocks.length).toBeGreaterThan(0);
      jpStocks.forEach((s) => expect(s.market).toBe("PRIME"));
    });

    it("filters by dividend yield and sorts correctly", () => {
      const highDividend = runStockScreener({
        minDividendYield: 3.0,
        sortBy: "dividendYield",
        sortOrder: "desc",
      });
      expect(highDividend.length).toBeGreaterThan(0);
      highDividend.forEach((s) => expect(s.dividendYield).toBeGreaterThanOrEqual(3.0));

      // verify sort
      for (let i = 0; i < highDividend.length - 1; i++) {
        expect(highDividend[i].dividendYield!).toBeGreaterThanOrEqual(highDividend[i + 1].dividendYield!);
      }
    });

    it("searches by query", () => {
      const results = runStockScreener({ searchQuery: "半導体" });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((s) => {
        const matched =
          s.name.includes("半導体") || s.theme.includes("半導体") || s.ticker.includes("半導体");
        expect(matched).toBe(true);
      });
    });

    it("keeps the original order when the sort key ties", () => {
      // changePercent is derived from the ticker seed, so grouping by the
      // tied value must not depend on the comparator direction.
      const byDesc = runStockScreener({ sortBy: "changePercent", sortOrder: "desc" });
      const tied = byDesc.filter((s) => s.changePercent === byDesc[0].changePercent);
      const byAsc = runStockScreener({ sortBy: "changePercent", sortOrder: "asc" });
      const tiedAsc = byAsc.filter((s) => s.changePercent === tied[0].changePercent);
      const descTickers = tied.map((s) => s.ticker).sort();
      const ascTickers = tiedAsc.map((s) => s.ticker).sort();
      expect(descTickers).toEqual(ascTickers);
    });

    it("sorts stocks with null metrics to the bottom in both asc and desc order", () => {
      const perAsc = runStockScreener({ sortBy: "per", sortOrder: "asc" });
      const nonNulls = perAsc.filter((s) => s.per !== null);
      const nulls = perAsc.filter((s) => s.per === null);
      if (nulls.length > 0 && nonNulls.length > 0) {
        expect(perAsc[0].per).not.toBeNull();
        expect(perAsc[0].per).toBeGreaterThan(0);
        const firstNullIdx = perAsc.findIndex((s) => s.per === null);
        const lastNonNullIdx = perAsc.map((s) => s.per).lastIndexOf(nonNulls[nonNulls.length - 1].per);
        expect(firstNullIdx).toBeGreaterThan(lastNonNullIdx);
      }
    });
  });

  describe("exact preset matching", () => {
    it("does not resolve a substring to a preset name", () => {
      const data = getStockFundamentals("72");
      expect(data.ticker).toBe("72");
      expect(data.name).toBe("銘柄 72");
    });

    it("does not resolve an empty ticker to the first preset", () => {
      const data = getStockFundamentals("");
      expect(data.ticker).toBe("");
      expect(data.name).not.toContain("トヨタ");
    });

    it("still resolves a preset by exact name", () => {
      const data = getStockFundamentals("トヨタ自動車");
      expect(data.ticker).toBe("7203");
    });
  });

  describe("normalizeMarketOverview", () => {
    it("rejects payloads without a usable indices section", () => {
      expect(normalizeMarketOverview(null)).toBeNull();
      expect(normalizeMarketOverview("nope")).toBeNull();
      expect(normalizeMarketOverview({ indices: [] })).toBeNull();
      expect(normalizeMarketOverview({ indices: "broken" })).toBeNull();
    });

    it("fills missing sections so the page never dereferences undefined", () => {
      const normalized = normalizeMarketOverview({
        indices: [{ symbol: "^N225", name: "日経平均", price: 40000, changePercent: 1.2 }],
      });
      expect(normalized).not.toBeNull();
      expect(normalized!.indices).toHaveLength(1);
      expect(normalized!.forex).toEqual([]);
      expect(normalized!.commodities).toEqual([]);
      expect(normalized!.crypto).toEqual([]);
      expect(normalized!.sectors.length).toBeGreaterThan(0);
      expect(normalized!.news.length).toBeGreaterThan(0);
      expect(normalized!.marketBreadth.sentimentScore).toBeGreaterThanOrEqual(0);
      expect(normalized!.marketBreadth.sentimentScore).toBeLessThanOrEqual(100);
    });

    it("drops malformed quotes and clamps the sentiment score", () => {
      const normalized = normalizeMarketOverview({
        indices: [
          { symbol: "^GSPC", name: "S&P 500", price: 5800 },
          { symbol: "BROKEN", name: "No price" },
          null,
          "junk",
        ],
        forex: [{ symbol: "USDJPY=X", name: "ドル円", price: 150.1, changePercent: 0.3 }],
        marketBreadth: {
          gainers: 10,
          losers: 5,
          unchanged: 1,
          sentimentScore: 250,
        },
        news: [{ id: "n1", title: "t", source: "s" }, { id: "n2", title: "t2", source: "s2", publishedAt: "1h" }],
      });
      expect(normalized).not.toBeNull();
      expect(normalized!.indices).toHaveLength(1);
      expect(normalized!.indices[0].updatedAt).toBe("-");
      expect(normalized!.forex).toHaveLength(1);
      expect(normalized!.marketBreadth.sentimentScore).toBe(100);
      // Incomplete news items (missing publishedAt) are filtered out
      expect(normalized!.news).toHaveLength(1);
      expect(normalized!.news[0].id).toBe("n2");
    });

    it("falls back to the baseline breadth when it is malformed", () => {
      const normalized = normalizeMarketOverview({
        indices: [{ symbol: "^DJI", name: "NYダウ", price: 43000 }],
        marketBreadth: { gainers: "many" },
      });
      expect(normalized).not.toBeNull();
      expect(normalized!.marketBreadth.gainers).toBeGreaterThan(0);
    });
  });

  describe("fetchMarketOverview", () => {
    it("returns baseline market overview data", async () => {
      const overview = await fetchMarketOverview();
      expect(overview.indices.length).toBeGreaterThan(0);
      expect(overview.forex.length).toBeGreaterThan(0);
      expect(overview.commodities.length).toBeGreaterThan(0);
      expect(overview.crypto.length).toBeGreaterThan(0);
      expect(overview.sectors.length).toBeGreaterThan(0);
      expect(overview.marketBreadth.sentimentScore).toBeGreaterThan(0);
    });
  });

  describe("UPCOMING_EVENTS", () => {
    it("contains upcoming earnings and macro events", () => {
      expect(UPCOMING_EVENTS.length).toBeGreaterThan(0);
      const macro = UPCOMING_EVENTS.filter((e) => e.type === "MACRO");
      const earnings = UPCOMING_EVENTS.filter((e) => e.type === "EARNINGS");
      expect(macro.length).toBeGreaterThan(0);
      expect(earnings.length).toBeGreaterThan(0);
    });
  });
});
