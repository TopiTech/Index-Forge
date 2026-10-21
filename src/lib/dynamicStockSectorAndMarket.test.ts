import { describe, it, expect, vi } from "vitest";
import { getStockFundamentals } from "./marketDataService";
import { formatMarketLabel, formatDynamicSector, formatDynamicIndustry } from "./marketFormatter";
import { getUniverseStockByTicker } from "../data/stockUniverse";

describe("Dynamic Stock Sector and Market Resolution (Hardcoding Elimination)", () => {
  describe("1. formatMarketLabel tests", () => {
    it("formats known markets correctly", () => {
      expect(formatMarketLabel("PRIME")).toBe("東証プライム");
      expect(formatMarketLabel("STANDARD")).toBe("東証スタンダード");
      expect(formatMarketLabel("GROWTH")).toBe("東証グロース");
      expect(formatMarketLabel("ETF")).toBe("東証ETF");
      expect(formatMarketLabel("REIT")).toBe("東証REIT");
      expect(formatMarketLabel("US")).toBe("米国市場");
      expect(formatMarketLabel("INDEX")).toBe("主要指数");
      expect(formatMarketLabel("FX")).toBe("外国為替");
      expect(formatMarketLabel("COMMODITY")).toBe("コモディティ");
      expect(formatMarketLabel("CRYPTO")).toBe("暗号資産");
    });

    it("falls back gracefully for unknown markets or nullish", () => {
      expect(formatMarketLabel(null)).toBe("東証");
      expect(formatMarketLabel(undefined)).toBe("東証");
      expect(formatMarketLabel("CUSTOM")).toBe("CUSTOM");
    });
  });

  describe("2. formatDynamicSector and formatDynamicIndustry tests", () => {
    it("formats dynamic US sectors with bilingual Japanese and English notation", () => {
      expect(formatDynamicSector("Technology")).toBe("テクノロジー (Technology)");
      expect(formatDynamicSector("Healthcare")).toBe("ヘルスケア・医療 (Healthcare)");
      expect(formatDynamicSector("Financial Services")).toBe("金融サービス (Financial Services)");
      expect(formatDynamicSector("Consumer Cyclical")).toBe("一般消費財 (Consumer Cyclical)");
      expect(formatDynamicSector("Industrials")).toBe("資本財・産業 (Industrials)");
      expect(formatDynamicSector("Energy")).toBe("エネルギー (Energy)");
      expect(formatDynamicSector("Real Estate")).toBe("不動産 (Real Estate)");
      expect(formatDynamicSector("Utilities")).toBe("公益・インフラ (Utilities)");
    });

    it("preserves raw string for unknown or custom sectors without crashing", () => {
      expect(formatDynamicSector("Aerospace & New Space")).toBe("Aerospace & New Space");
      expect(formatDynamicSector("")).toBe("その他");
      expect(formatDynamicSector(null)).toBe("その他");
    });

    it("formats dynamic industries correctly", () => {
      expect(formatDynamicIndustry("Semiconductors")).toBe("半導体 (Semiconductors)");
      expect(formatDynamicIndustry("Auto Manufacturers")).toBe("自動車メーカー (Auto Manufacturers)");
      expect(formatDynamicIndustry("Custom Specialized Industry")).toBe("Custom Specialized Industry");
      expect(formatDynamicIndustry(null)).toBe("");
    });
  });

  describe("3. getStockFundamentals Sector and Market Accuracy from Universe", () => {
    it("correctly identifies standard market stock (e.g. 5250 GMO Prime Strategy) instead of PRIME or 電気機器・精密", () => {
      const gmo = getStockFundamentals("5250");
      expect(gmo.ticker).toBe("5250");
      // Must NOT be PRIME
      expect(gmo.market).toBe("STANDARD");
      // Must be 情報・通信業, NOT 電気機器・精密
      expect(gmo.sector).toBe("情報・通信業");
    });

    it("correctly identifies prime stocks sector from universe if not an anchor", () => {
      // 1301 (極洋): 水産・農林業
      const kyokuyo = getStockFundamentals("1301");
      expect(kyokuyo.ticker).toBe("1301");
      expect(kyokuyo.market).toBe("PRIME");
      expect(kyokuyo.sector).toBe("水産・農林業");
    });

    it("resolves US stocks without defaulting to 電気機器・精密", () => {
      const nvdaUniverse = getUniverseStockByTicker("NVDA");
      expect(nvdaUniverse).toBeDefined();
      expect(nvdaUniverse?.market).toBe("US");

      const nvda = getStockFundamentals("NVDA");
      expect(nvda.market).toBe("US");
      expect(nvda.sector).not.toBe("電気機器・精密");
    });
  });

  describe("4. Worker fetchLiveStockFundamentals Dynamic assetProfile Resolution", () => {
    it("dynamically extracts sector and industry from Yahoo assetProfile without hardcoding", async () => {
      const { fetchLiveStockFundamentals } = await import("../../worker/internal");

      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("quoteSummary")) {
          return new Response(
            JSON.stringify({
              quoteSummary: {
                result: [
                  {
                    assetProfile: {
                      sector: "Healthcare",
                      industry: "Drug Manufacturers - General",
                    },
                    price: {
                      regularMarketPrice: { raw: 165.5 },
                      regularMarketChange: { raw: 1.2 },
                      regularMarketChangePercent: { raw: 0.73 },
                      marketCap: { raw: 420000000000 },
                    },
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return origFetch(input, init);
      });

      try {
        const stockData = await fetchLiveStockFundamentals("PFE");
        expect(stockData.sector).toBe("Healthcare");
        expect(stockData.industry).toBe("Drug Manufacturers - General");
        expect(stockData.market).toBe("US");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
