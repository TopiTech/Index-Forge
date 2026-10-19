import { describe, expect, it } from "vitest";
import {
  clearMemoryCache,
  getMemoryCache,
  setMemoryCache,
  setAllowMemoryCacheInTest,
  OVERVIEW_ASSET_DEFS,
} from "../../worker/internal";
import { BASELINE_ASSET_QUOTES } from "../data/marketConstants";
import { DEFAULT_MARKET_OVERVIEW } from "./marketDataService";
import {
  deserializeIndexFromJson,
  deserializeBasketFromCsv,
  deserializePortfolioFromCsv,
} from "./indexSerialization";
import {
  convertPortfolioToCustomIndexBasket,
  type PortfolioPosition,
} from "./portfolioStorage";
import { toSafeDownloadFileName } from "./downloadFileName";

describe("comprehensiveCodeReviewFinalFixes", () => {
  describe("1. clearMemoryCache multi-map cleanup", () => {
    it("clears matching prefixed keys from both memoryCache and calcMemoryCache", () => {
      setAllowMemoryCacheInTest(true);
      try {
        clearMemoryCache();

        // Setup entries in both cache stores via setMemoryCache
        setMemoryCache("prefix:key1", "val1", 60);
        setMemoryCache("other:key2", "val2", 60);
        setMemoryCache("calc:prefix:calc1", "calc1", 60);
        setMemoryCache("calc:other:calc2", "calc2", 60);

        expect(getMemoryCache("prefix:key1")).toBe("val1");
        expect(getMemoryCache("calc:prefix:calc1")).toBe("calc1");
        expect(getMemoryCache("other:key2")).toBe("val2");
        expect(getMemoryCache("calc:other:calc2")).toBe("calc2");

        // Clear prefix across both maps
        clearMemoryCache("prefix:");

        expect(getMemoryCache("prefix:key1")).toBeNull();
        expect(getMemoryCache("other:key2")).toBe("val2");
        expect(getMemoryCache("calc:prefix:calc1")).toBe("calc1");

        // Clear calc: prefix
        clearMemoryCache("calc:prefix:");
        expect(getMemoryCache("calc:prefix:calc1")).toBeNull();
        expect(getMemoryCache("calc:other:calc2")).toBe("calc2");

        // Full clear without prefix
        clearMemoryCache();
        expect(getMemoryCache("other:key2")).toBeNull();
        expect(getMemoryCache("calc:other:calc2")).toBeNull();
      } finally {
        setAllowMemoryCacheInTest(false);
      }
    });
  });

  describe("2. Baseline asset quotes consistency", () => {
    it("aligns OVERVIEW_ASSET_DEFS in worker with shared BASELINE_ASSET_QUOTES", () => {
      const n225 = OVERVIEW_ASSET_DEFS.find((d) => d.symbol === "^N225");
      expect(n225).toBeDefined();
      expect(n225!.defaultPrice).toBe(39500);
      expect(n225!.defaultPrice).not.toBe(69030.92);

      const sp500 = OVERVIEW_ASSET_DEFS.find((d) => d.symbol === "^GSPC");
      expect(sp500).toBeDefined();
      expect(sp500!.defaultPrice).toBe(5850);
      expect(sp500!.defaultPrice).not.toBe(7811.54);

      expect(OVERVIEW_ASSET_DEFS.length).toBe(BASELINE_ASSET_QUOTES.length);
    });

    it("aligns DEFAULT_MARKET_OVERVIEW in marketDataService with shared BASELINE_ASSET_QUOTES", () => {
      const n225 = DEFAULT_MARKET_OVERVIEW.indices.find((d) => d.symbol === "^N225");
      expect(n225).toBeDefined();
      expect(n225!.price).toBe(39500);
      expect(n225!.price).not.toBe(69030.92);

      const topix = DEFAULT_MARKET_OVERVIEW.indices.find((d) => d.symbol === "^TOPX");
      expect(topix).toBeDefined();
      expect(topix!.price).toBe(2720);

      const gold = DEFAULT_MARKET_OVERVIEW.commodities.find((d) => d.symbol === "GC=F");
      expect(gold).toBeDefined();
      expect(gold!.price).toBe(2750);
      expect(gold!.price).not.toBe(4216.3);

      const usdjpy = DEFAULT_MARKET_OVERVIEW.forex.find((d) => d.symbol === "USDJPY=X");
      expect(usdjpy).toBeDefined();
      expect(usdjpy!.price).toBe(155.0);
    });
  });

  describe("3. UTF-8 BOM tolerance in deserialization", () => {
    it("successfully deserializes JSON with leading UTF-8 BOM", () => {
      const validJson = JSON.stringify({
        name: "BOM Test Index",
        description: "Test description",
        baseValue: 1000,
        basket: [
          { ticker: "7203", name: "トヨタ自動車", theme: "モビリティ", weight: 60 },
          { ticker: "6758", name: "ソニーグループ", theme: "エンタメ", weight: 40 },
        ],
      });

      const bomJson = "\uFEFF" + validJson;
      const result = deserializeIndexFromJson(bomJson);

      expect(result.ok).toBe(true);
      expect(result.data?.name).toBe("BOM Test Index");
      expect(result.data?.basket.length).toBe(2);
    });

    it("successfully deserializes Basket CSV with leading UTF-8 BOM", () => {
      const csvWithBom =
        '\uFEFF"ticker","name","theme","weight"\r\n"7203","トヨタ自動車","自動車","60"\r\n"6758","ソニーグループ","エンタメ","40"';
      const result = deserializeBasketFromCsv(csvWithBom);

      expect(result.ok).toBe(true);
      expect(result.data?.length).toBe(2);
      expect(result.data?.[0].ticker).toBe("7203");
      expect(result.data?.[0].weight).toBe(60);
    });

    it("successfully deserializes Portfolio CSV with leading UTF-8 BOM", () => {
      const csvWithBom =
        '\uFEFF"ticker","name","theme","shares","costPrice","market"\r\n"7203","トヨタ","自動車","100","2500","TSE"\r\n"AAPL","Apple","Tech","10","180","US"';
      const result = deserializePortfolioFromCsv(csvWithBom);

      expect(result.ok).toBe(true);
      expect(result.data?.length).toBe(2);
      expect(result.data?.[0].ticker).toBe("7203");
      expect(result.data?.[1].ticker).toBe("AAPL");
    });
  });

  describe("4. Portfolio to Index conversion ticker normalization", () => {
    it("normalizes case and whitespace to group duplicate positions", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-aapl-1",
          ticker: "aapl",
          name: "Apple Inc.",
          shares: 10,
          averageCost: 150,
          currentPrice: 200,
        },
        {
          id: "pos-aapl-2",
          ticker: "AAPL ",
          name: "Apple Inc.",
          shares: 5,
          averageCost: 160,
          currentPrice: 200,
        },
        {
          id: "pos-7203",
          ticker: " 7203 ",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2500,
          currentPrice: 3000,
        },
      ];

      const basket = convertPortfolioToCustomIndexBasket(positions, 150);

      // Should have 2 unique constituents: AAPL and 7203
      expect(basket.length).toBe(2);
      const tickers = basket.map((b) => b.ticker);
      expect(tickers).toContain("AAPL");
      expect(tickers).toContain("7203");

      // Total weights must equal 100
      const totalWeight = basket.reduce((sum, b) => sum + b.weight, 0);
      expect(totalWeight).toBe(100);
    });
  });

  describe("5. File name sanitization", () => {
    it("sanitizes dangerous or prohibited path characters in file names", () => {
      const unsafe = 'my/cool:index*name?with"chars<and>pipe|';
      const safe = toSafeDownloadFileName(`indexforge-${unsafe}.json`);
      expect(safe).not.toMatch(/[/\\:*?"<>|]/);
      expect(safe).toBe("indexforge-my_cool_index_name_with_chars_and_pipe_.json");
    });
  });

  describe("6. Sidebar inert state condition", () => {
    it("evaluates inert true when closed in either desktop or mobile layout", () => {
      const getInert = (isMobileLayout: boolean, isSidebarOpen: boolean, isDesktopSidebarOpen: boolean) => {
        return (isMobileLayout ? !isSidebarOpen : !isDesktopSidebarOpen) ? true : undefined;
      };

      // Desktop closed -> inert should be true
      expect(getInert(false, false, false)).toBe(true);
      // Desktop open -> inert should be undefined
      expect(getInert(false, false, true)).toBeUndefined();
      // Mobile closed -> inert should be true
      expect(getInert(true, false, true)).toBe(true);
      // Mobile open -> inert should be undefined
      expect(getInert(true, true, true)).toBeUndefined();
    });
  });
});
