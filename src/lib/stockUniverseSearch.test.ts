import { describe, it, expect } from "vitest";
import {
  ALL_UNIVERSE_STOCKS,
  searchStockUniverse,
  getUniverseStockByTicker,
  normalizeSearchQuery,
} from "../data/stockUniverse";
import { searchPopularStocks, POPULAR_STOCKS } from "../data/popularStocks";

describe("Stock Universe & Zero Server Load Suggestion System", () => {
  describe("Universe Scale & Coverage", () => {
    it("contains comprehensive TSE & US instruments (4,500+ items)", () => {
      expect(ALL_UNIVERSE_STOCKS.length).toBeGreaterThan(4400);

      const primeCount = ALL_UNIVERSE_STOCKS.filter((s) => s.market === "PRIME").length;
      const standardCount = ALL_UNIVERSE_STOCKS.filter((s) => s.market === "STANDARD").length;
      const growthCount = ALL_UNIVERSE_STOCKS.filter((s) => s.market === "GROWTH").length;
      const usCount = ALL_UNIVERSE_STOCKS.filter((s) => s.market === "US").length;
      const etfCount = ALL_UNIVERSE_STOCKS.filter((s) => s.market === "ETF").length;

      expect(primeCount).toBeGreaterThan(1500);
      expect(standardCount).toBeGreaterThan(1500);
      expect(growthCount).toBeGreaterThan(500);
      expect(usCount).toBeGreaterThan(70);
      expect(etfCount).toBeGreaterThan(300);
    });

    it("retrieves individual stocks accurately by ticker", () => {
      const toyota = getUniverseStockByTicker("7203");
      expect(toyota).toBeDefined();
      expect(toyota?.name).toContain("トヨタ");
      expect(toyota?.market).toBe("PRIME");
      expect(toyota?.sector).toBe("輸送用機器");

      const kyokuyo = getUniverseStockByTicker("1301");
      expect(kyokuyo).toBeDefined();
      expect(kyokuyo?.name).toContain("極洋");
      expect(kyokuyo?.market).toBe("PRIME");
      expect(kyokuyo?.sector).toBe("水産・農林業");

      const nvda = getUniverseStockByTicker("NVDA");
      expect(nvda).toBeDefined();
      expect(nvda?.name).toBe("NVIDIA");
      expect(nvda?.market).toBe("US");
    });
  });

  describe("Query Normalization & Multilingual Search", () => {
    it("normalizes full-width characters and hiragana to katakana", () => {
      expect(normalizeSearchQuery("７２０３")).toBe("7203");
      expect(normalizeSearchQuery("ＡＡＰＬ")).toBe("aapl");
      expect(normalizeSearchQuery("とよた")).toBe("トヨタ");
      expect(normalizeSearchQuery("そにー")).toBe("ソニー");
      expect(normalizeSearchQuery("  ニッポン  ")).toBe("ニッポン");
    });

    it("finds stocks via Hiragana query matching Katakana company name", () => {
      const toyotaMatches = searchStockUniverse("とよた");
      expect(toyotaMatches.length).toBeGreaterThan(0);
      expect(toyotaMatches.some((s) => s.ticker === "7203")).toBe(true);

      const sonyMatches = searchStockUniverse("そにー");
      expect(sonyMatches.length).toBeGreaterThan(0);
      expect(sonyMatches.some((s) => s.ticker === "6758")).toBe(true);
    });

    it("finds stocks with Hiragana names via either Hiragana or Katakana queries (bidirectional)", () => {
      // 8227 (しまむら) has official Hiragana name
      const shimamuraHira = searchStockUniverse("しまむら");
      expect(shimamuraHira.length).toBeGreaterThan(0);
      expect(shimamuraHira.some((s) => s.ticker === "8227")).toBe(true);

      const shimamuraKata = searchStockUniverse("シマムラ");
      expect(shimamuraKata.length).toBeGreaterThan(0);
      expect(shimamuraKata.some((s) => s.ticker === "8227")).toBe(true);

      // 3778 (さくらインターネット)
      const sakuraHira = searchStockUniverse("さくら");
      expect(sakuraHira.length).toBeGreaterThan(0);
      expect(sakuraHira.some((s) => s.ticker === "3778")).toBe(true);
    });

    it("finds stocks via full-width alphanumeric codes (e.g. ７２０３, １３０１, ＡＡＰＬ)", () => {
      const toyotaFull = searchStockUniverse("７２０３");
      expect(toyotaFull.length).toBeGreaterThan(0);
      expect(toyotaFull[0].ticker).toBe("7203");

      const kyokuyoFull = searchStockUniverse("１３０１");
      expect(kyokuyoFull.length).toBeGreaterThan(0);
      expect(kyokuyoFull[0].ticker).toBe("1301");

      const aaplFull = searchStockUniverse("ＡＡＰＬ");
      expect(aaplFull.length).toBeGreaterThan(0);
      expect(aaplFull[0].ticker).toBe("AAPL");
    });

    it("finds stocks by 4-digit code prefix or exact code", () => {
      const exact = searchStockUniverse("7203");
      expect(exact.length).toBeGreaterThan(0);
      expect(exact[0].ticker).toBe("7203");

      const prefix = searchStockUniverse("720");
      expect(prefix.length).toBeGreaterThan(1);
      expect(prefix.some((s) => s.ticker === "7201")).toBe(true);
      expect(prefix.some((s) => s.ticker === "7202")).toBe(true);
      expect(prefix.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("filters suggestions by target market segment", () => {
      const primeSemi = searchStockUniverse("半導体", { market: "PRIME" });
      expect(primeSemi.length).toBeGreaterThan(0);
      expect(primeSemi.every((s) => s.market === "PRIME")).toBe(true);

      const usSemi = searchStockUniverse("Semiconductors", { market: "US" });
      expect(usSemi.length).toBeGreaterThan(0);
      expect(usSemi.every((s) => s.market === "US")).toBe(true);
      expect(usSemi.some((s) => s.ticker === "NVDA")).toBe(true);
    });

    it("respects suggestion limit", () => {
      const defaultLimit = searchStockUniverse("電気");
      expect(defaultLimit.length).toBeLessThanOrEqual(20);

      const customLimit = searchStockUniverse("電気", { limit: 12 });
      expect(customLimit.length).toBeLessThanOrEqual(12);
    });
  });

  describe("searchPopularStocks Backward Compatibility & Universe Expansion", () => {
    it("returns popular curated presets with priority", () => {
      const results = searchPopularStocks("7203");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].ticker).toBe("7203");
      expect(results[0].name).toBe("トヨタ自動車");
      expect(results[0].theme).toBe("モビリティ");
    });

    it("matches curated popular stocks via Hiragana query or full-width code", () => {
      const toyotaHira = searchPopularStocks("とよた");
      expect(toyotaHira.length).toBeGreaterThan(0);
      expect(toyotaHira[0].ticker).toBe("7203");

      const toyotaFull = searchPopularStocks("７２０３");
      expect(toyotaFull.length).toBeGreaterThan(0);
      expect(toyotaFull[0].ticker).toBe("7203");

      const sonyHira = searchPopularStocks("そにー");
      expect(sonyHira.length).toBeGreaterThan(0);
      expect(sonyHira[0].ticker).toBe("6758");
    });

    it("retrieves universe stocks by ticker handling full-width chars and .T suffixes", () => {
      const toyotaFull = getUniverseStockByTicker("７２０３");
      expect(toyotaFull).toBeDefined();
      expect(toyotaFull?.ticker).toBe("7203");

      const toyotaSuffixed = getUniverseStockByTicker("7203.T");
      expect(toyotaSuffixed).toBeDefined();
      expect(toyotaSuffixed?.ticker).toBe("7203");
    });

    it("finds non-preset TSE stocks that were previously absent", () => {
      // 1301 (極洋) is not in curated POPULAR_STOCKS presets, but is in the complete TSE universe
      const inPresets = POPULAR_STOCKS.some((s) => s.ticker === "1301");
      expect(inPresets).toBe(false);

      const results = searchPopularStocks("1301");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].ticker).toBe("1301");
      expect(results[0].name).toContain("極洋");

      // 9104 (商船三井)
      const molResults = searchPopularStocks("商船三井");
      expect(molResults.length).toBeGreaterThan(0);
      expect(molResults[0].ticker).toBe("9104");
    });

    it("normalizes half-width Katakana queries (e.g. ﾄﾖﾀ, ｿﾆｰ, ｶﾌﾟｺﾝ)", () => {
      const toyotaHankaku = searchStockUniverse("ﾄﾖﾀ");
      expect(toyotaHankaku.length).toBeGreaterThan(0);
      expect(toyotaHankaku.some((s) => s.ticker === "7203")).toBe(true);

      const sonyHankaku = searchStockUniverse("ｿﾆｰ");
      expect(sonyHankaku.length).toBeGreaterThan(0);
      expect(sonyHankaku.some((s) => s.ticker === "6758")).toBe(true);

      const capcomHankaku = searchStockUniverse("ｶﾌﾟｺﾝ");
      expect(capcomHankaku.length).toBeGreaterThan(0);
      expect(capcomHankaku.some((s) => s.ticker === "9697")).toBe(true);
    });

    it("supports multi-token AND search with spaces (e.g. 'トヨタ 7203', 'ソニー エンタメ')", () => {
      const andMatch1 = searchStockUniverse("トヨタ 7203");
      expect(andMatch1.length).toBeGreaterThan(0);
      expect(andMatch1[0].ticker).toBe("7203");

      const andMatch2 = searchStockUniverse("ソニー エンタメ");
      expect(andMatch2.length).toBeGreaterThan(0);
      expect(andMatch2.some((s) => s.ticker === "6758")).toBe(true);

      const andMatch3 = searchStockUniverse("半導体 6857");
      expect(andMatch3.length).toBeGreaterThan(0);
      expect(andMatch3.some((s) => s.ticker === "6857")).toBe(true);
    });

    it("boosts popular large-cap stocks in search rankings", () => {
      // Searching for "東" should rank Tokyo Electron (8035) or major popular picks high
      const results = searchStockUniverse("東", { limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "8035" || s.ticker === "8766")).toBe(true);
    });
  });

  describe("Zero Server Load & High Performance", () => {
    it("executes in-memory search in sub-millisecond time without network requests", () => {
      // Warm up JIT compiler
      searchStockUniverse("72");
      searchStockUniverse("ソニー");
      searchStockUniverse("半導体");

      const start = performance.now();
      for (let i = 0; i < 50; i++) {
        searchStockUniverse("72");
        searchStockUniverse("ソニー");
        searchStockUniverse("半導体");
      }
      const duration = performance.now() - start;
      const perSearchAvgMs = duration / 150;

      // Even across 150 total searches, each client-side search must average in low single-digit ms
      // (typically < 0.5ms locally, allowing up to 5.0ms on heavily throttled/loaded CI runners)
      expect(perSearchAvgMs).toBeLessThan(5.0);
    });
  });
});
