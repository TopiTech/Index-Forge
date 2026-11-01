// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { PerformanceChart, type ChartPoint } from "../components/PerformanceChart";
import { RiskMetricsCard } from "../components/RiskMetricsCard";
import { SimulationPreview } from "../components/SimulationPreview";
import { changeTone, formatSignedPercent, formatSignedAmount, formatDrawdownPercent } from "../components/changeTone";
import type { PricePoint } from "../types";
import type { SimulationResult } from "../hooks/useSimulation";

describe("Comprehensive Code Review Quality & Edge-Case Behavior Tests", () => {
  describe("1. changeTone & formatSignedPercent Zero-Safe Precision Contract", () => {
    it("handles zero, negative zero, and micro-values that round to zero as neutral", () => {
      expect(changeTone(0, 2)).toBe("neutral");
      expect(changeTone(-0, 2)).toBe("neutral");
      expect(changeTone(0.004, 2)).toBe("neutral");
      expect(changeTone(-0.004, 2)).toBe("neutral");
      expect(changeTone(0.005, 2)).toBe("positive");
      expect(changeTone(-0.005, 2)).toBe("negative");
      expect(changeTone(NaN, 2)).toBe("neutral");
      expect(changeTone(Infinity, 2)).toBe("neutral");
      expect(changeTone(-Infinity, 2)).toBe("neutral");
      expect(changeTone(null, 2)).toBe("neutral");
      expect(changeTone(undefined, 2)).toBe("neutral");
    });

    it("formats signed percentages without rogue '+0.00%' or '-0.00%' artefacts", () => {
      expect(formatSignedPercent(0, 2)).toBe("0.00%");
      expect(formatSignedPercent(-0, 2)).toBe("0.00%");
      expect(formatSignedPercent(0.002, 2)).toBe("0.00%");
      expect(formatSignedPercent(-0.002, 2)).toBe("0.00%");
      expect(formatSignedPercent(1.23, 2)).toBe("+1.23%");
      expect(formatSignedPercent(-1.23, 2)).toBe("-1.23%");
    });

    it("formats signed amount and drawdown safely", () => {
      expect(formatSignedAmount(0, (n) => `¥${n}`)).toBe("¥0");
      expect(formatSignedAmount(-0.001, (n) => `¥${n}`)).toBe("¥0");
      expect(formatSignedAmount(500, (n) => `¥${n}`)).toBe("+¥500");
      expect(formatDrawdownPercent(0, 1)).toBe("0.0%");
      expect(formatDrawdownPercent(0.04, 1)).toBe("0.0%");
      expect(formatDrawdownPercent(5.5, 1)).toBe("-5.5%");
    });
  });

  describe("2. PerformanceChart Zero-Baseline & Statistics Guard", () => {
    it("safely normalizes series when the first point is zero or baseline is invalid without -100% crash", () => {
      const edgeData: ChartPoint[] = [
        { date: "2026-01-01", value: 0, nikkei: 0 },
        { date: "2026-01-02", value: 1050, nikkei: 38000 },
        { date: "2026-01-03", value: 1100, nikkei: 38500 },
      ];

      const { container } = render(
        createElement(PerformanceChart, {
          data: edgeData,
          baseValue: 0, // Edge-case: non-positive baseValue
          loading: false,
          syncing: false,
          syncProgress: 100,
          timeframe: "1M",
          onTimeframeChange: () => {},
        }),
      );

      expect(container).toBeTruthy();
      // Stats summary must display period return based on valid positive points
      expect(container.textContent).toContain("期間リターン");
      expect(container.textContent).toContain("+4.76%"); // ((1100 - 1050) / 1050) * 100 = 4.76%
    });

    it("formats zero period return and alpha with neutral sign in summary cards", () => {
      const flatData: ChartPoint[] = [
        { date: "2026-01-01", value: 1000, nikkei: 38000 },
        { date: "2026-01-02", value: 1000, nikkei: 38000 },
      ];

      const { container } = render(
        createElement(PerformanceChart, {
          data: flatData,
          baseValue: 1000,
          loading: false,
          syncing: false,
          syncProgress: 100,
          timeframe: "1M",
          onTimeframeChange: () => {},
        }),
      );

      // Period return is 0%, must render '0.00%' not '+0.00%'
      expect(container.textContent).toContain("0.00%");
      expect(container.textContent).not.toContain("+0.00%");
    });
  });

  describe("3. RiskMetricsCard Neutral Tone on Zero Annual Return", () => {
    it("renders neutral indicator and '横ばい推移' when CAGR is 0.00%", () => {
      const flatCustom: PricePoint[] = [
        { date: "2026-01-01", close: 1000, value: 1000 },
        { date: "2026-01-02", close: 1000, value: 1000 },
      ];
      const flatBench: PricePoint[] = [
        { date: "2026-01-01", close: 38000, value: 38000 },
        { date: "2026-01-02", close: 38000, value: 38000 },
      ];

      const { container } = render(
        createElement(RiskMetricsCard, {
          customSeries: flatCustom,
          benchmarkSeries: flatBench,
        }),
      );

      expect(container.textContent).toContain("年率期待リターン (CAGR)");
      expect(container.textContent).toContain("0.00%");
      expect(container.textContent).not.toContain("+0.00%");
      expect(container.textContent).toContain("横ばい推移");
    });
  });

  describe("4. SimulationPreview Constituent Performance Zero-Safe Tone", () => {
    it("renders zero periodReturnPct and contributionPct with 0.00% without rogue + sign", () => {
      const mockSimulation: SimulationResult = {
        customSeries: [
          { date: "2026-01-01", value: 1000, close: 1000 },
          { date: "2026-01-02", value: 1000, close: 1000 },
        ],
        filteredCustomSeries: [
          { date: "2026-01-01", value: 1000, close: 1000 },
          { date: "2026-01-02", value: 1000, close: 1000 },
        ],
        filteredBenchmarkSeries: [
          { date: "2026-01-01", value: 38000, close: 38000 },
          { date: "2026-01-02", value: 38000, close: 38000 },
        ],
        stockUniverse: [],
        metrics: {
          annualReturn: 0,
          annualVolatility: 10,
          sharpeRatio: 0,
          maxDrawdown: 0,
          winRate: 50,
          bestDay: 0,
          worstDay: 0,
          beta: 1.0,
        },
        periodCustomReturnPct: 0,
        periodBenchmarkReturnPct: 0,
        alphaPct: 0,
        constituentsPerformance: [
          {
            ticker: "7203",
            name: "トヨタ自動車",
            theme: "自動車",
            weight: 50,
            startPrice: 2800,
            latestPrice: 2800,
            periodReturnPct: 0,
            contributionPct: 0,
          },
          {
            ticker: "9984",
            name: "ソフトバンクG",
            theme: "AI",
            weight: 50,
            startPrice: 9000,
            latestPrice: 9000,
            periodReturnPct: -0.0001, // rounds to 0.00%
            contributionPct: 0.0001, // rounds to 0.00%
          },
        ],
        loading: false,
        benchmarkLoading: false,
        error: null,
        syncWarnings: [],
        usingDemoData: false,
        usingDemoBenchmark: false,
        timeframe: "1M",
        setTimeframe: () => {},
        selectedBenchmark: "^N225",
        setSelectedBenchmark: () => {},
        runSimulation: async () => {},
      };

      const { container } = render(
        createElement(SimulationPreview, {
          simulation: mockSimulation,
          baseValue: 1000,
          indexName: "テスト指数",
        }),
      );

      // Both items must show '0.00%' and not '+0.00%'
      const cells = container.querySelectorAll("table tbody tr td");
      expect(cells.length).toBeGreaterThan(0);
      expect(container.textContent).toContain("0.00%");
      expect(container.textContent).not.toContain("+0.00%");
    });
  });
});
