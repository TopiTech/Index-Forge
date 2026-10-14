import { describe, it, expect } from "vitest";
import {
  searchStockUniverse,
  getUniverseStockByTicker,
} from "../data/stockUniverse";
import { searchPopularStocks } from "../data/popularStocks";
import {
  detectStockCurrency,
  getStockCurrency,
  getCurrencyMeta,
} from "./currency";
import { resolveTradingViewSymbol, getTradingViewWebUrl } from "./tradingView";
import { normalizeTicker } from "./indexEngine";
import { toYahooSymbol } from "./yahooSymbol";

describe("Comprehensive Code Review Resolution & Goal Fulfillment Tests", () => {
  describe("1. Stock Universe & Bidirectional Japanese Search", () => {
    it("finds companies with official Hiragana names when searching via Hiragana", () => {
      // 8227 (しまむら)
      const shimamura = searchStockUniverse("しまむら");
      expect(shimamura.length).toBeGreaterThan(0);
      expect(shimamura.some((s) => s.ticker === "8227")).toBe(true);

      // 3197 (すかいらーくホールディングス)
      const skylark = searchStockUniverse("すかいらーく");
      expect(skylark.length).toBeGreaterThan(0);
      expect(skylark.some((s) => s.ticker === "3197")).toBe(true);

      // 3778 (さくらインターネット)
      const sakura = searchStockUniverse("さくら");
      expect(sakura.length).toBeGreaterThan(0);
      expect(sakura.some((s) => s.ticker === "3778")).toBe(true);

      // 8411 (みずほフィナンシャルグループ)
      const mizuho = searchStockUniverse("みずほ");
      expect(mizuho.length).toBeGreaterThan(0);
      expect(mizuho.some((s) => s.ticker === "8411")).toBe(true);

      // 7182 (ゆうちょ銀行)
      const yucho = searchStockUniverse("ゆうちょ");
      expect(yucho.length).toBeGreaterThan(0);
      expect(yucho.some((s) => s.ticker === "7182")).toBe(true);
    });

    it("finds companies with official Hiragana names when searching via Katakana (bidirectional)", () => {
      // 8227 (しまむら) searched via Katakana "シマムラ"
      const shimamura = searchStockUniverse("シマムラ");
      expect(shimamura.length).toBeGreaterThan(0);
      expect(shimamura.some((s) => s.ticker === "8227")).toBe(true);

      // 3197 (すかいらーく) searched via Katakana "スカイラーク"
      const skylark = searchStockUniverse("スカイラーク");
      expect(skylark.length).toBeGreaterThan(0);
      expect(skylark.some((s) => s.ticker === "3197")).toBe(true);

      // 3778 (さくら) searched via Katakana "サクラ"
      const sakura = searchStockUniverse("サクラ");
      expect(sakura.length).toBeGreaterThan(0);
      expect(sakura.some((s) => s.ticker === "3778")).toBe(true);
    });

    it("finds stocks across all segments via full-width alphanumeric codes", () => {
      // TSE Prime stock without custom aliases: 1301 (極洋)
      const kyokuyo = searchStockUniverse("１３０１");
      expect(kyokuyo.length).toBeGreaterThan(0);
      expect(kyokuyo[0].ticker).toBe("1301");

      // 7203 (トヨタ)
      const toyota = searchStockUniverse("７２０３");
      expect(toyota.length).toBeGreaterThan(0);
      expect(toyota[0].ticker).toBe("7203");

      // 8035 (東京エレクトロン)
      const tel = searchStockUniverse("８０３５");
      expect(tel.length).toBeGreaterThan(0);
      expect(tel[0].ticker).toBe("8035");

      // US equities full-width
      const aapl = searchStockUniverse("ＡＡＰＬ");
      expect(aapl.length).toBeGreaterThan(0);
      expect(aapl[0].ticker).toBe("AAPL");

      const nvda = searchStockUniverse("ＮＶＤＡ");
      expect(nvda.length).toBeGreaterThan(0);
      expect(nvda[0].ticker).toBe("NVDA");
    });
  });

  describe("2. searchPopularStocks Multilingual Normalization", () => {
    it("matches curated popular stocks via Hiragana and full-width input", () => {
      const toyotaHira = searchPopularStocks("とよた");
      expect(toyotaHira.length).toBeGreaterThan(0);
      expect(toyotaHira[0].ticker).toBe("7203");
      expect(toyotaHira[0].name).toBe("トヨタ自動車");

      const toyotaFull = searchPopularStocks("７２０３");
      expect(toyotaFull.length).toBeGreaterThan(0);
      expect(toyotaFull[0].ticker).toBe("7203");

      const sonyHira = searchPopularStocks("そにー");
      expect(sonyHira.length).toBeGreaterThan(0);
      expect(sonyHira[0].ticker).toBe("6758");

      const nintendoHira = searchPopularStocks("にんてんどう");
      expect(nintendoHira.length).toBeGreaterThan(0);
      expect(nintendoHira[0].ticker).toBe("7974");
    });

    it("supplements universe stocks for non-preset stocks smoothly", () => {
      const results = searchPopularStocks("しまむら");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "8227")).toBe(true);
    });
  });

  describe("3. getUniverseStockByTicker Robust Lookups", () => {
    it("normalizes full-width tickers and handles .T exchange suffixes", () => {
      const byFullWidth = getUniverseStockByTicker("７２０３");
      expect(byFullWidth).toBeDefined();
      expect(byFullWidth?.ticker).toBe("7203");

      const bySuffix = getUniverseStockByTicker("7203.T");
      expect(bySuffix).toBeDefined();
      expect(bySuffix?.ticker).toBe("7203");

      const byLowerWithWhitespace = getUniverseStockByTicker("  nvda  ");
      expect(byLowerWithWhitespace).toBeDefined();
      expect(byLowerWithWhitespace?.ticker).toBe("NVDA");
    });
  });

  describe("4. Multi-Currency Detection & Yen Cross Pairs", () => {
    it("accurately detects all Yen cross currency pairs as JPY", () => {
      expect(detectStockCurrency("USDJPY=X")).toBe("JPY");
      expect(detectStockCurrency("EURJPY=X")).toBe("JPY");
      expect(detectStockCurrency("GBPJPY=X")).toBe("JPY");
      expect(detectStockCurrency("AUDJPY=X")).toBe("JPY");
      expect(detectStockCurrency("FX_IDC:USDJPY")).toBe("JPY");
      expect(detectStockCurrency("FX:EURJPY")).toBe("JPY");
      expect(detectStockCurrency("FX:GBPJPY")).toBe("JPY");

      expect(getStockCurrency("EURJPY=X")).toBe("¥");
      expect(getStockCurrency("GBPJPY=X")).toBe("¥");
      expect(getCurrencyMeta("EURJPY=X").isJPY).toBe(true);
      expect(getCurrencyMeta("EURJPY=X").symbol).toBe("¥");
    });

    it("keeps non-Yen pairs as USD", () => {
      expect(detectStockCurrency("EURUSD=X")).toBe("USD");
      expect(getStockCurrency("EURUSD=X")).toBe("$");
      expect(getCurrencyMeta("EURUSD=X").isUSD).toBe(true);
    });
  });

  describe("5. TradingView 404 Prevention for Commodities & Yields", () => {
    it("resolves Gold futures (GC=F) to valid TVC:GOLD and TVC-GOLD web slug", () => {
      const res = resolveTradingViewSymbol("GC=F");
      expect(res.symbol).toBe("TVC:GOLD");
      expect(res.isSupported).toBe(true);

      const url = getTradingViewWebUrl("GC=F");
      expect(url).toBe("https://jp.tradingview.com/symbols/TVC-GOLD/");
      expect(url).not.toContain("GC%3DF");
    });

    it("resolves Crude Oil futures (CL=F) to valid TVC:USOIL and TVC-USOIL web slug", () => {
      const res = resolveTradingViewSymbol("CL=F");
      expect(res.symbol).toBe("TVC:USOIL");
      expect(res.isSupported).toBe(true);

      const url = getTradingViewWebUrl("CL=F");
      expect(url).toBe("https://jp.tradingview.com/symbols/TVC-USOIL/");
      expect(url).not.toContain("CL%3DF");
    });

    it("resolves US 10Y Yield (^TNX) to valid TVC:US10Y and TVC-US10Y web slug", () => {
      const res = resolveTradingViewSymbol("^TNX");
      expect(res.symbol).toBe("TVC:US10Y");
      expect(res.isSupported).toBe(true);

      const url = getTradingViewWebUrl("^TNX");
      expect(url).toBe("https://jp.tradingview.com/symbols/TVC-US10Y/");
      expect(url).not.toContain("%5ETNX");
    });
  });

  describe("6. indexEngine & yahooSymbol Full-Width Character Normalization", () => {
    it("normalizes full-width alphanumeric codes in normalizeTicker", () => {
      expect(normalizeTicker("７２０３")).toBe("7203");
      expect(normalizeTicker("ａａｐｌ")).toBe("AAPL");
      expect(normalizeTicker("  ９９８４  ")).toBe("9984");
    });

    it("normalizes full-width alphanumeric codes in toYahooSymbol", () => {
      expect(toYahooSymbol("７２０３")).toBe("7203.T");
      expect(toYahooSymbol("９９８４.Ｔ")).toBe("9984.T");
      expect(toYahooSymbol("ａａｐｌ")).toBe("AAPL");
    });
  });
});
