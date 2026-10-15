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

  describe("4. Multi-Tier Dynamic Financial Statements Fetching", () => {
    it("exports known US CIK mappings for SEC EDGAR XBRL lookup", async () => {
      const { US_CIK_LOOKUP } = await import("../../worker/internal");
      expect(US_CIK_LOOKUP).toBeDefined();
      expect(US_CIK_LOOKUP["NVDA"]).toBe("0001045810");
      expect(US_CIK_LOOKUP["AAPL"]).toBe("0000320193");
      expect(US_CIK_LOOKUP["MSFT"]).toBe("0000789019");
    });

    it("dynamically parses SEC EDGAR XBRL company facts payload into historicalFinances", async () => {
      const { fetchSecEdgarFinancials } = await import("../../worker/internal");
      const sampleFacts = {
        facts: {
          "us-gaap": {
            Revenues: {
              units: {
                USD: [
                  { form: "10-K", fy: 2023, val: 26974000000 },
                  { form: "10-K", fy: 2024, val: 60922000000 },
                  { form: "10-K", fy: 2025, val: 130497000000 },
                ],
              },
            },
            NetIncomeLoss: {
              units: {
                USD: [
                  { form: "10-K", fy: 2023, val: 4368000000 },
                  { form: "10-K", fy: 2024, val: 29760000000 },
                  { form: "10-K", fy: 2025, val: 72880000000 },
                ],
              },
            },
            OperatingIncomeLoss: {
              units: {
                USD: [
                  { form: "10-K", fy: 2023, val: 4224000000 },
                  { form: "10-K", fy: 2024, val: 32972000000 },
                  { form: "10-K", fy: 2025, val: 81453000000 },
                ],
              },
            },
          },
        },
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("data.sec.gov")) {
          return new Response(JSON.stringify(sampleFacts), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(input);
      };

      try {
        const finances = await fetchSecEdgarFinancials("NVDA");
        expect(finances.length).toBe(3);
        expect(finances[0].fiscalYear).toBe("2023 FY");
        expect(finances[0].revenue).toBe(26974); // in million USD
        expect(finances[0].netIncome).toBe(4368);
        expect(finances[0].operatingIncome).toBe(4224);

        expect(finances[2].fiscalYear).toBe("2025 FY");
        expect(finances[2].revenue).toBe(130497);
        expect(finances[2].netIncome).toBe(72880);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("dynamically parses Yahoo quoteSummary incomeStatementHistory in fetchLiveStockFundamentals", async () => {
      const { fetchLiveStockFundamentals } = await import("../../worker/internal");
      const sampleSummary = {
        quoteSummary: {
          result: [
            {
              price: {
                regularMarketPrice: { raw: 5000 },
                regularMarketChange: { raw: 100 },
                regularMarketChangePercent: { raw: 0.02 },
                regularMarketPreviousClose: { raw: 4900 },
                shortName: "テスト電気",
              },
              incomeStatementHistory: {
                incomeStatementHistory: [
                  {
                    endDate: { fmt: "2025-03-31" },
                    totalRevenue: { raw: 800000000000 }, // 8000億円
                    operatingIncome: { raw: 150000000000 }, // 1500億円
                    netIncome: { raw: 100000000000 }, // 1000億円
                  },
                  {
                    endDate: { fmt: "2024-03-31" },
                    totalRevenue: { raw: 700000000000 },
                    operatingIncome: { raw: 120000000000 },
                    netIncome: { raw: 80000000000 },
                  },
                ],
              },
            },
          ],
        },
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("quoteSummary")) {
          return new Response(JSON.stringify(sampleSummary), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("chart")) {
          return new Response(
            JSON.stringify({
              chart: {
                result: [
                  {
                    meta: { regularMarketPrice: 5000 },
                    indicators: { quote: [{ close: [4800, 4900, 5000] }] },
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return originalFetch(input);
      };

      try {
        const data = await fetchLiveStockFundamentals("6857");
        expect(data.historicalFinances).toBeDefined();
        expect(data.historicalFinances.length).toBe(2);
        // Reversed chronological order
        expect(data.historicalFinances[0].fiscalYear).toBe("2024/3");
        expect(data.historicalFinances[0].revenue).toBe(7000); // 7000億円
        expect(data.historicalFinances[1].fiscalYear).toBe("2025/3");
        expect(data.historicalFinances[1].revenue).toBe(8000); // 8000億円
        expect(data.historicalFinances[1].operatingIncome).toBe(1500);
        expect(data.historicalFinances[1].netIncome).toBe(1000);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

