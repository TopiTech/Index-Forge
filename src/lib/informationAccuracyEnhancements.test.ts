import { describe, it, expect } from "vitest";
import {
  KNOWN_STOCK_ANCHORS,
  getStockFundamentals,
  evaluateTechnicalSignal,
  formatMarketCapDisplay,
} from "./marketDataService";
import { searchStockUniverse } from "../data/stockUniverse";
import { POPULAR_STOCKS } from "../data/popularStocks";

describe("Information Accuracy & Hardcoding Elimination Enhancements", () => {
  describe("1. Real Anchor Data & Disclosed Financials", () => {
    it("provides authentic anchor profiles for key Japanese and US equities", () => {
      // Toyota 7203
      const toyota = KNOWN_STOCK_ANCHORS["7203"];
      expect(toyota).toBeDefined();
      expect(toyota.marketCap).toBeGreaterThan(300000); // > 30兆円
      expect(toyota.sector).toContain("輸送用機器");
      expect(toyota.market).toBe("PRIME");
      expect(toyota.historicalFinances).toBeDefined();
      expect(toyota.historicalFinances!.length).toBeGreaterThanOrEqual(3);
      // Disclosed revenue is ~45兆円, not synthetic Math.round(marketCap * 0.72)
      const latestToyota = toyota.historicalFinances![toyota.historicalFinances!.length - 1];
      expect(latestToyota.revenue).toBeGreaterThan(400000);

      // Advantest 6857 (Semiconductor test equipment)
      const advantest = KNOWN_STOCK_ANCHORS["6857"];
      expect(advantest).toBeDefined();
      expect(advantest.sector).toContain("電気機器");
      expect(advantest.historicalFinances).toBeDefined();
      // Advantest revenue is ~4000-5400億円 (not 5兆円 based on market cap)
      const latestAdvantest = advantest.historicalFinances![advantest.historicalFinances!.length - 1];
      expect(latestAdvantest.revenue).toBeLessThan(10000); // 5400億円
      expect(latestAdvantest.revenue).toBeGreaterThan(3000);

      // NVIDIA NVDA (US Mega Cap)
      const nvda = KNOWN_STOCK_ANCHORS["NVDA"];
      expect(nvda).toBeDefined();
      expect(nvda.market).toBe("US");
      expect(nvda.marketCap).toBeGreaterThan(2000000); // > 2兆ドル
      expect(nvda.historicalFinances).toBeDefined();
      const latestNvda = nvda.historicalFinances![nvda.historicalFinances!.length - 1];
      expect(latestNvda.revenue).toBeGreaterThan(50000); // > $50B
    });

    it("ensures getStockFundamentals adopts disclosed financials without fallback to marketCap * 0.72", () => {
      const advFund = getStockFundamentals("6857");
      expect(advFund.name).toContain("アドバンテスト");
      expect(advFund.isDemoData).toBeUndefined();
      expect(advFund.historicalFinances.length).toBeGreaterThan(0);
      // Realistic disclosed revenue
      expect(advFund.historicalFinances[0].revenue).toBeLessThan(10000);

      const toyotaFund = getStockFundamentals("7203");
      expect(toyotaFund.historicalFinances[0].revenue).toBeGreaterThan(300000);
    });
  });

  describe("2. Dynamic Metric Evaluations (No Fake Hardcoded Subtitles)", () => {
    it("dynamically evaluates technical signal reason and direction based on SMA and momentum", () => {
      // Golden cross scenario
      const bullishSparkline = [100, 102, 105, 108, 112, 116];
      const strongBuy = evaluateTechnicalSignal(1.8, bullishSparkline, 118);
      expect(strongBuy.signal).toBe("STRONG_BUY");
      expect(strongBuy.reason).toContain("ゴールデンクロス");

      // Dead cross scenario
      const bearishSparkline = [120, 118, 115, 110, 106, 102];
      const strongSell = evaluateTechnicalSignal(-1.8, bearishSparkline, 100);
      expect(strongSell.signal).toBe("STRONG_SELL");
      expect(strongSell.reason).toContain("デッドクロス");

      // Flat momentum
      const flat = evaluateTechnicalSignal(0.0);
      expect(flat.signal).toBe("NEUTRAL");
      expect(flat.reason).toBe("レンジもみ合い推移");
    });

    it("properly formats market capitalization for both JPY 億円/兆円 and USD 百万/億/兆ドル", () => {
      // Japanese Prime Mega Cap: 400,000 億円 = 40.0 兆円
      expect(formatMarketCapDisplay(400000, "PRIME")).toBe("40.0 兆円");
      // Japanese Standard Mid Cap: 500 億円 = 500 億円
      expect(formatMarketCapDisplay(500, "STANDARD")).toBe("500 億円");
      // US Mega Cap: 3,000,000 百万ドル = 3.00 兆ドル
      expect(formatMarketCapDisplay(3000000, "US")).toBe("3.00 兆ドル");
      // US Mid Cap: 25,000 百万ドル = 250 億ドル
      expect(formatMarketCapDisplay(25000, "US")).toBe("250 億ドル");
    });
  });

  describe("3. Stock Analysis Hub & Search Accuracy", () => {
    it("finds stocks from full 4,500+ TSE universe through searchStockUniverse", () => {
      // Ticker search
      const toyotaByCode = searchStockUniverse("7203");
      expect(toyotaByCode.length).toBeGreaterThan(0);
      expect(toyotaByCode[0].ticker).toBe("7203");

      // Hiragana search
      const shimamura = searchStockUniverse("しまむら");
      expect(shimamura.length).toBeGreaterThan(0);
      expect(shimamura[0].name).toContain("しまむら");

      // Katakana search
      const sakura = searchStockUniverse("サクラ");
      expect(sakura.length).toBeGreaterThan(0);

      // US Ticker
      const nvda = searchStockUniverse("NVDA");
      expect(nvda.length).toBeGreaterThan(0);
      expect(nvda[0].ticker).toBe("NVDA");
    });

    it("verifies popular stock list contains accurately calibrated data", () => {
      expect(POPULAR_STOCKS.length).toBeGreaterThanOrEqual(30);
      const tickers = POPULAR_STOCKS.map((s) => s.ticker);
      expect(tickers).toContain("7203");
      expect(tickers).toContain("6857");
      expect(tickers).toContain("8035");
      expect(tickers).toContain("NVDA");
    });
  });
});
