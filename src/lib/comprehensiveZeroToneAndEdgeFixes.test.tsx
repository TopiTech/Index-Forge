// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { StatsGrid } from "../components/StatsGrid";
import { RiskMetricsCard } from "../components/RiskMetricsCard";
import { changeTone, formatSignedAmount, formatSignedPercent } from "../components/changeTone";
import type { PricePoint, Snapshot } from "../types";
import type { CustomIndex } from "../data/indices";

describe("comprehensiveZeroToneAndEdgeFixes: Zero-safe formatting and classification", () => {
  describe("1. StatsGrid Alpha and Return Formatting", () => {
    const mockIndex: CustomIndex = {
      id: "test-index",
      name: "テスト指数",
      description: "テスト用",
      basket: [{ ticker: "7203", name: "トヨタ", weight: 100, theme: "自動車" }],
      baseValue: 1000,
    };

    const makeSnapshot = (change: number, changePct: number): Snapshot => ({
      symbol: "^N225",
      label: "日経225",
      current: 38000,
      change,
      changePct,
      updatedAt: "2026-01-01 15:00",
      description: "日経平均株価",
    });

    it("renders NEUTRAL alpha for zero or micro-difference without rogue + sign", () => {
      const { container } = render(
        createElement(StatsGrid, {
          benchmarkData: {
            snapshot: makeSnapshot(0, 0),
          },
          benchmarkLoading: false,
          selectedIndex: mockIndex,
          latestCustomValue: 1000,
          loading: false,
          benchmarkLabel: "日経225",
          timeframe: "1M",
          periodCustomReturnPct: 0.002, // rounds to 0.00%
          periodBenchmarkReturnPct: 0,
          periodAlphaPct: 0.002,
        }),
      );

      expect(container.textContent).toContain("NEUTRAL");
      expect(container.textContent).toContain("日経225と同等");
      expect(container.textContent).toContain("0.00%");
      expect(container.textContent).not.toContain("+0.00%");
      expect(container.textContent).not.toContain("-0.00%");
    });

    it("renders OUTPERFORM alpha for clear positive return difference", () => {
      const { container } = render(
        createElement(StatsGrid, {
          benchmarkData: {
            snapshot: makeSnapshot(150, 0.4),
          },
          benchmarkLoading: false,
          selectedIndex: mockIndex,
          latestCustomValue: 1050,
          loading: false,
          benchmarkLabel: "日経225",
          timeframe: "1M",
          periodCustomReturnPct: 5.0,
          periodBenchmarkReturnPct: 2.0,
          periodAlphaPct: 3.0,
        }),
      );

      expect(container.textContent).toContain("OUTPERFORM");
      expect(container.textContent).toContain("日経225をアウトパフォーム");
      expect(container.textContent).toContain("+3.00%");
    });

    it("renders UNDERPERFORM alpha for negative return difference", () => {
      const { container } = render(
        createElement(StatsGrid, {
          benchmarkData: {
            snapshot: makeSnapshot(-150, -0.4),
          },
          benchmarkLoading: false,
          selectedIndex: mockIndex,
          latestCustomValue: 970,
          loading: false,
          benchmarkLabel: "日経225",
          timeframe: "1M",
          periodCustomReturnPct: -3.0,
          periodBenchmarkReturnPct: 1.0,
          periodAlphaPct: -4.0,
        }),
      );

      expect(container.textContent).toContain("UNDERPERFORM");
      expect(container.textContent).toContain("日経225をアンダーパフォーム");
      expect(container.textContent).toContain("-4.00%");
    });
  });

  describe("2. RiskMetricsCard Micro-Values and Zero Edge Cases", () => {
    it("renders neutral CAGR when annualReturn rounds to 0.00%", () => {
      // Series designed to yield virtually 0% return (< 0.005% annualized)
      const series: PricePoint[] = [
        { date: "2026-01-01", close: 1000, value: 1000 },
        { date: "2026-01-02", close: 1000.00001, value: 1000.00001 },
      ];

      const { container } = render(
        createElement(RiskMetricsCard, {
          customSeries: series,
          benchmarkSeries: series,
        }),
      );

      expect(container.textContent).toContain("年率期待リターン (CAGR)");
      expect(container.textContent).toContain("0.00%");
      expect(container.textContent).not.toContain("+0.00%");
      expect(container.textContent).not.toContain("-0.00%");
      expect(container.textContent).toContain("横ばい推移");
    });
  });

  describe("3. changeTone & formatSignedAmount P&L Rules", () => {
    it("formats zero amounts without positive or negative signs", () => {
      expect(formatSignedAmount(0, (n) => `¥${n}`)).toBe("¥0");
      expect(formatSignedAmount(-0, (n) => `¥${n}`)).toBe("¥0");
      expect(formatSignedAmount(0.001, (n) => `¥${n}`)).toBe("¥0");
      expect(formatSignedAmount(-0.001, (n) => `¥${n}`)).toBe("¥0");
      expect(formatSignedAmount(1000, (n) => `¥${n}`)).toBe("+¥1000");
      expect(formatSignedAmount(-1000, (n) => `¥${n}`)).toBe("¥-1000");
    });

    it("resolves tone correctly for USD and JPY precision limits", () => {
      // JPY (digits = 0)
      expect(changeTone(0, 0)).toBe("neutral");
      expect(changeTone(0.4, 0)).toBe("neutral");
      expect(changeTone(-0.4, 0)).toBe("neutral");
      expect(changeTone(0.5, 0)).toBe("positive");
      expect(changeTone(-0.5, 0)).toBe("negative");

      // USD (digits = 2)
      expect(changeTone(0, 2)).toBe("neutral");
      expect(changeTone(0.004, 2)).toBe("neutral");
      expect(changeTone(-0.004, 2)).toBe("neutral");
      expect(changeTone(0.005, 2)).toBe("positive");
      expect(changeTone(-0.005, 2)).toBe("negative");
    });

    it("formats signed percentages safely without negative zero artefacts", () => {
      expect(formatSignedPercent(0, 2)).toBe("0.00%");
      expect(formatSignedPercent(-0, 2)).toBe("0.00%");
      expect(formatSignedPercent(-0.001, 2)).toBe("0.00%");
      expect(formatSignedPercent(0.001, 2)).toBe("0.00%");
      expect(formatSignedPercent(1.5, 2)).toBe("+1.50%");
      expect(formatSignedPercent(-1.5, 2)).toBe("-1.50%");
    });
  });
});
