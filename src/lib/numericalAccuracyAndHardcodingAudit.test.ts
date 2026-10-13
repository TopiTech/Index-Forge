import { describe, it, expect } from "vitest";
import {
  getSectorAveragePer,
  SECTOR_AVERAGE_PER,
  evaluateTechnicalSignal,
} from "./marketDataService";
import { getFearGreedMeta } from "../components/MarketOverviewPage";
import { DEFAULT_USD_JPY_RATE } from "../data/marketConstants";
import * as fs from "fs";
import * as path from "path";

describe("Numerical Accuracy and Hardcoding Remediation Audit", () => {
  describe("Sector Average PER Benchmarks", () => {
    it("returns accurate sector PER benchmarks", () => {
      // Semiconductors should be elevated (~32.5)
      expect(getSectorAveragePer("半導体製造装置")).toBe(32.5);
      expect(getSectorAveragePer("半導体")).toBe(32.5);

      // Financials / Banks should be around ~10.2
      expect(getSectorAveragePer("銀行業")).toBe(10.2);
      expect(getSectorAveragePer("メガバンク")).toBe(10.2);

      // Auto / Mobility around 9.5
      expect(getSectorAveragePer("自動車")).toBe(9.5);
      expect(getSectorAveragePer("モビリティ")).toBe(9.5);

      // IT / Software
      expect(getSectorAveragePer("IT")).toBe(28.0);

      // Unknown or undefined defaults safely to 15.0
      expect(getSectorAveragePer("")).toBe(15.0);
      expect(getSectorAveragePer(undefined)).toBe(15.0);
    });

    it("ensures SECTOR_AVERAGE_PER contains reasonable multiples between 5x and 60x", () => {
      for (const [sector, per] of Object.entries(SECTOR_AVERAGE_PER)) {
        expect(per).toBeGreaterThanOrEqual(5.0);
        expect(per).toBeLessThanOrEqual(60.0);
      }
    });
  });

  describe("Technical Signal Evaluation Engine", () => {
    it("detects golden cross with positive momentum as STRONG_BUY", () => {
      // price > shortSMA > fullSMA and changePct > 0.5
      const sparkline = [100, 102, 104, 106, 110];
      const result = evaluateTechnicalSignal(1.5, sparkline, 115);
      expect(result.signal).toBe("STRONG_BUY");
      expect(result.reason).toContain("ゴールデンクロス");
    });

    it("detects dead cross with negative momentum as STRONG_SELL", () => {
      const sparkline = [120, 115, 110, 105, 100];
      const result = evaluateTechnicalSignal(-1.5, sparkline, 95);
      expect(result.signal).toBe("STRONG_SELL");
      expect(result.reason).toContain("デッドクロス");
    });

    it("falls back to price momentum when sparkline is missing", () => {
      expect(evaluateTechnicalSignal(2.5).signal).toBe("STRONG_BUY");
      expect(evaluateTechnicalSignal(0.8).signal).toBe("BUY");
      expect(evaluateTechnicalSignal(0.0).signal).toBe("NEUTRAL");
      expect(evaluateTechnicalSignal(-1.2).signal).toBe("SELL");
      expect(evaluateTechnicalSignal(-2.5).signal).toBe("STRONG_SELL");
    });
  });

  describe("Fear & Greed Sentiment Classification", () => {
    it("classifies scores into 5 distinct sentiment stages with distinct styling", () => {
      const extremeGreed = getFearGreedMeta(85);
      expect(extremeGreed.label).toContain("EXTREME GREED");
      expect(extremeGreed.badgeClass).toBe("badge-success");

      const greed = getFearGreedMeta(65);
      expect(greed.label).toContain("GREED");

      const neutral = getFearGreedMeta(50);
      expect(neutral.label).toContain("NEUTRAL");

      const fear = getFearGreedMeta(35);
      expect(fear.label).toContain("FEAR");

      const extremeFear = getFearGreedMeta(15);
      expect(extremeFear.label).toContain("EXTREME FEAR");
      expect(extremeFear.badgeClass).toBe("badge-danger");
    });
  });

  describe("Auditing Non-Fallback Hardcoded Constants in Components", () => {
    it("ensures PortfolioManagerPage uses DEFAULT_USD_JPY_RATE instead of raw 150.00 fallback", () => {
      const filePath = path.resolve(__dirname, "../components/PortfolioManagerPage.tsx");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("DEFAULT_USD_JPY_RATE");
      // Raw string literal "150.00" must not be present
      expect(content).not.toContain('"150.00"');
      expect(DEFAULT_USD_JPY_RATE).toBe(155.0);
    });

    it("ensures StockDetailPage dynamically references getSectorAveragePer", () => {
      const filePath = path.resolve(__dirname, "../components/StockDetailPage.tsx");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("getSectorAveragePer");
      // Hardcoded "業界平均: 14.5倍" must not be present
      expect(content).not.toContain("業界平均: 14.5倍");
    });

    it("ensures RiskMetricsCard renders CAGR (年率期待リターン)", () => {
      const filePath = path.resolve(__dirname, "../components/RiskMetricsCard.tsx");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("年率期待リターン (CAGR)");
      expect(content).toContain("metrics.annualReturn");
    });
  });
});
