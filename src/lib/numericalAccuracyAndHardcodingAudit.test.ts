// @vitest-environment jsdom
/**
 * Numerical accuracy and "no hardcoded fallback" audit.
 *
 * The audit used to read the source text of the components and assert that a
 * constant was mentioned. That contract passes while the runtime behaviour is
 * broken, so every block below now exercises the production module and checks
 * the observable outcome (the rendered number, the converted value). Where a
 * purely structural rule has no runtime counterpart at all, the source check
 * is kept and labelled as a static contract.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  getSectorAveragePer,
  SECTOR_AVERAGE_PER,
  evaluateTechnicalSignal,
  getStockFundamentals,
} from "./marketDataService";
import { getFearGreedMeta } from "../components/MarketOverviewPage";
import { DEFAULT_USD_JPY_RATE } from "../data/marketConstants";
import { calculatePortfolioSummary } from "./portfolioStorage";
import { calculateRiskMetrics } from "./analytics";
import { StockDetailPage } from "../components/StockDetailPage";
import { RiskMetricsCard } from "../components/RiskMetricsCard";
import type { PortfolioPosition } from "./portfolioStorage";
import type { PricePoint } from "../types";

// The suite renders components, so it runs in jsdom. Vite cannot resolve the
// `node:` built-ins there, but the runtime still exposes them through
// `process.getBuiltinModule`.
const nodeFs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
const nodePath = process.getBuiltinModule("node:path") as typeof import("node:path");
const nodeUrl = process.getBuiltinModule("node:url") as typeof import("node:url");

const here = nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url));
const readComponentSource = (relativePath: string): string =>
  nodeFs.readFileSync(nodePath.resolve(here, relativePath), "utf-8");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
      for (const [_sector, per] of Object.entries(SECTOR_AVERAGE_PER)) {
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
      // Behaviour: a USD holding is converted with the shared fallback rate,
      // so a missing live FX quote cannot silently use another number.
      const position: PortfolioPosition = {
        id: "pos-1",
        ticker: "AAPL",
        name: "アップル",
        shares: 10,
        averageCost: 200,
      };
      const anchorPrice = getStockFundamentals("AAPL").price;

      const summary = calculatePortfolioSummary([position]);
      const expectedJpy = Math.round(anchorPrice * 10 * DEFAULT_USD_JPY_RATE);

      expect(summary.positions[0].fxRate).toBe(DEFAULT_USD_JPY_RATE);
      expect(summary.totalMarketValue).toBe(expectedJpy);
      // The old raw fallback (150.00) must not be used any more.
      expect(summary.totalMarketValue).not.toBe(Math.round(anchorPrice * 10 * 150));

      // An explicitly provided rate still wins over the fallback.
      const withRate = calculatePortfolioSummary([position], undefined, 100);
      expect(withRate.totalMarketValue).toBe(Math.round(anchorPrice * 10 * 100));

      // A JPY holding is never converted.
      const jpyPosition: PortfolioPosition = {
        id: "pos-2",
        ticker: "7203",
        name: "トヨタ自動車",
        shares: 100,
        averageCost: 2500,
      };
      const jpySummary = calculatePortfolioSummary([jpyPosition]);
      expect(jpySummary.positions[0].fxRate).toBe(1);

      expect(DEFAULT_USD_JPY_RATE).toBe(155.0);

      // Static contract: the component must not carry a second, hardcoded rate.
      const content = readComponentSource("../components/PortfolioManagerPage.tsx");
      expect(content).toContain("DEFAULT_USD_JPY_RATE");
      // Raw string literal "150.00" must not be present
      expect(content).not.toContain('"150.00"');
    });

    it("ensures StockDetailPage dynamically references getSectorAveragePer", async () => {
      // Behaviour: the industry average shown next to the PER is the one of
      // the stock's own sector, not a constant baked into the component.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/api/stock/fundamentals")) {
            return new Response(
              JSON.stringify({
                ticker: "8035",
                name: "東京エレクトロン",
                theme: "半導体",
                sector: "電気機器・半導体製造装置",
                market: "PRIME",
                price: 12445,
                change: 255,
                changePercent: 2.09,
                per: 45.9,
                pbr: 2.64,
                dividendYield: 3.75,
                roe: 18.2,
                equityRatio: 72,
                eps: 270.9,
                dps: 466,
                technicalSignal: "STRONG_BUY",
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        }),
      );

      render(
        createElement(StockDetailPage, {
          ticker: "8035",
          onNavigate: vi.fn(),
        }),
      );

      // The sector of the rendered stock decides the multiple.
      expect(await screen.findByText(/業界平均: 32\.5倍/)).toBeTruthy();
      await waitFor(() => {
        expect(document.body.textContent).not.toContain("14.5倍");
      });

      // Static contract: the hardcoded "業界平均: 14.5倍" must not be present
      const content = readComponentSource("../components/StockDetailPage.tsx");
      expect(content).toContain("getSectorAveragePer");
      expect(content).not.toContain("業界平均: 14.5倍");
    });

    it("ensures RiskMetricsCard renders CAGR (年率期待リターン)", () => {
      const customSeries: PricePoint[] = [
        { date: "2026-01-02", close: 1000, value: 1000 },
        { date: "2026-01-05", close: 1010, value: 1010 },
        { date: "2026-01-06", close: 1020, value: 1020 },
      ];
      const benchmarkSeries: PricePoint[] = [
        { date: "2026-01-02", close: 38000, value: 38000 },
        { date: "2026-01-05", close: 38100, value: 38100 },
        { date: "2026-01-06", close: 38200, value: 38200 },
      ];

      const metrics = calculateRiskMetrics(customSeries, benchmarkSeries);
      const formatted = `${metrics.annualReturn > 0 ? "+" : ""}${new Intl.NumberFormat("ja-JP", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(metrics.annualReturn)}%`;

      const { container } = render(
        createElement(RiskMetricsCard, { customSeries, benchmarkSeries }),
      );

      // The card renders the annualised return with its label.
      expect(container.textContent).toContain("年率期待リターン (CAGR)");
      expect(container.textContent).toContain(formatted);
      expect(metrics.annualReturn).toBeGreaterThan(0);

      // Without a usable series the card renders nothing at all.
      const { container: empty } = render(
        createElement(RiskMetricsCard, {
          customSeries: [{ date: "2026-01-02", close: 1000, value: 1000 }],
          benchmarkSeries,
        }),
      );
      expect(empty.textContent).toBe("");

      // Static contract: the label and the metric it renders are pinned.
      const content = readComponentSource("../components/RiskMetricsCard.tsx");
      expect(content).toContain("年率期待リターン (CAGR)");
      expect(content).toContain("metrics.annualReturn");
    });
  });
});
