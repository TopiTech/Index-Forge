import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMissingColumnError, isMissingTableError } from "../../worker/internal";
import {
  calculateConstituentPerformance,
  calculatePeriodReturns,
} from "../hooks/useSimulation";
import {
  changeTone,
  formatDrawdownPercent,
  formatSignedPercent,
} from "../components/changeTone";
import type { BasketItem, StockSeries } from "../types";

describe("Comprehensive Review Resolution & Regression Tests", () => {
  describe("1. Worker Database Error Discrimination (isMissingTableError & isMissingColumnError)", () => {
    it("does not misclassify generic operational SQLite errors as missing table errors", () => {
      // D1 prefixes operational SQLite errors with sqlite_error.
      // If table name is in the message (e.g. constraint failure), it must NOT be treated as missing table!
      const constraintError = new Error(
        "D1_ERROR: sqlite_error: UNIQUE constraint failed: stock_series.ticker",
      );
      expect(isMissingTableError(constraintError, "stock_series")).toBe(false);

      const lockError = new Error(
        "D1_ERROR: sqlite_error: database is locked: stock_series",
      );
      expect(isMissingTableError(lockError, "stock_series")).toBe(false);

      const ioError = new Error(
        "D1_ERROR: sqlite_error: disk I/O error on sync_logs",
      );
      expect(isMissingTableError(ioError, "sync_logs")).toBe(false);

      const busyError = new Error(
        "D1_ERROR: sqlite_error: sqlite_busy: snapshot_cache locked",
      );
      expect(isMissingTableError(busyError, "snapshot_cache")).toBe(false);
    });

    it("correctly identifies genuine missing table errors across various D1/SQLite formats", () => {
      const missing1 = new Error("D1_ERROR: no such table: stock_series");
      expect(isMissingTableError(missing1, "stock_series")).toBe(true);

      const missing2 = new Error(
        "D1_ERROR: sqlite_error: no such table: snapshot_cache",
      );
      expect(isMissingTableError(missing2, "snapshot_cache")).toBe(true);

      const missing3 = new Error("Table 'benchmark_cache' does not exist");
      expect(isMissingTableError(missing3, "benchmark_cache")).toBe(true);

      const missing4 = new Error("Error: no table found for sync_logs");
      expect(isMissingTableError(missing4, "sync_logs")).toBe(true);
    });

    it("correctly discriminates missing column errors without false positives on other column errors", () => {
      const genuineMissingCol = new Error(
        "D1_ERROR: table indices has no column named owner_token_hash: SQLITE_ERROR",
      );
      expect(isMissingColumnError(genuineMissingCol, "owner_token_hash")).toBe(true);

      const constraintCol = new Error(
        "D1_ERROR: sqlite_error: UNIQUE constraint failed: indices.owner_token_hash",
      );
      expect(isMissingColumnError(constraintCol, "owner_token_hash")).toBe(false);
    });
  });

  describe("2. useSimulation Period Returns & Float / Negative Zero Sanitization", () => {
    it("sanitizes sub-basis-point negative drops to +0 without -0 artifacts", () => {
      // 1000 to 999.9999 is a drop of 0.0001%
      const customSeries = [
        { date: "2026-09-01", close: 1000, value: 1000 },
        { date: "2026-09-02", close: 999.9999, value: 999.9999 },
      ];
      const benchmarkSeries = [
        { date: "2026-09-01", close: 38000 },
        { date: "2026-09-02", close: 38000 },
      ];

      const res = calculatePeriodReturns(customSeries, benchmarkSeries);
      expect(res.periodCustomReturnPct).toBe(0);
      expect(Object.is(res.periodCustomReturnPct, -0)).toBe(false);
      expect(res.alphaPct).toBe(0);
      expect(Object.is(res.alphaPct, -0)).toBe(false);
    });

    it("correctly computes standard positive and negative period returns and alpha", () => {
      const customSeries = [
        { date: "2026-09-01", close: 1000, value: 1000 },
        { date: "2026-09-02", close: 1050, value: 1050 }, // +5.00%
      ];
      const benchmarkSeries = [
        { date: "2026-09-01", close: 40000 },
        { date: "2026-09-02", close: 40800 }, // +2.00%
      ];

      const res = calculatePeriodReturns(customSeries, benchmarkSeries);
      expect(res.periodCustomReturnPct).toBe(5);
      expect(res.periodBenchmarkReturnPct).toBe(2);
      expect(res.alphaPct).toBe(3);
    });

    it("sanitizes constituent performance against negative zero on tiny price fluctuations", () => {
      const basket: BasketItem[] = [
        { ticker: "7203", name: "Toyota", theme: "Auto", weight: 50 },
      ];
      const stockUniverse: StockSeries[] = [
        {
          ticker: "7203",
          name: "Toyota",
          theme: "Auto",
          sector: "Auto",
          latestPrice: 2000,
          series: [
            { date: "2026-08-01", close: 2000 },
            { date: "2026-08-02", close: 1999.999 }, // sub-basis-point drop
          ],
        },
      ];

      const perf = calculateConstituentPerformance(basket, stockUniverse, "1M");
      expect(perf).toHaveLength(1);
      expect(perf[0].periodReturnPct).toBe(0);
      expect(Object.is(perf[0].periodReturnPct, -0)).toBe(false);
      expect(perf[0].contributionPct).toBe(0);
      expect(Object.is(perf[0].contributionPct, -0)).toBe(false);
    });
  });

  describe("3. UI / Component Contract Verification", () => {
    it("ensures IndexBuilderContent range slider matches 0.1 decimal precision", () => {
      const content = readFileSync(
        resolve(__dirname, "../components/IndexBuilderContent.tsx"),
        "utf8",
      );

      // Verify range slider min and step are 0.1
      expect(content).toContain('type="range"');
      expect(content).toContain("min={0.1}");
      expect(content).toContain("step={0.1}");
    });

    it("ensures SimulationPreview treats a zero change as neutral, not as a gain or a loss", () => {
      const preview = readFileSync(
        resolve(__dirname, "../components/SimulationPreview.tsx"),
        "utf8",
      );

      // UI-28: the sign and the colour of every signed figure are decided by
      // the shared zero-safe tone helper instead of a `> 0` comparison that
      // painted a flat 0% green.
      expect(preview).toContain(
        'import { changeTone, formatDrawdownPercent, formatSignedPercent } from "./changeTone";',
      );
      expect(preview).toContain("toneColor(periodCustomReturnPct)");
      expect(preview).toContain("toneColor(alphaPct)");
      expect(preview).toContain("toneColor(metrics.annualReturn)");
      expect(preview).toContain("signedPctText(periodCustomReturnPct)");
      expect(preview).toContain("signedPctText(alphaPct)");
      expect(preview).toContain("formatSignedPercent(metrics.annualReturn, 1)");

      // The drawdown magnitude is rendered by the shared formatter, so a flat
      // period can no longer print "-0.0%".
      expect(preview).toContain("formatDrawdownPercent(metrics.maxDrawdown)");

      // A zero is neutral: no sign and no green/red highlight.
      expect(changeTone(0)).toBe("neutral");
      expect(changeTone(-0)).toBe("neutral");
      expect(changeTone(0.001)).toBe("neutral");
      expect(changeTone(0.01)).toBe("positive");
      expect(changeTone(-0.01)).toBe("negative");

      expect(formatSignedPercent(0)).toBe("0.00%");
      expect(formatSignedPercent(-0)).toBe("0.00%");
      expect(formatSignedPercent(0.01)).toBe("+0.01%");
      expect(formatSignedPercent(-0.01)).toBe("-0.01%");

      expect(formatDrawdownPercent(0)).toBe("0.0%");
      expect(formatDrawdownPercent(-0)).toBe("0.0%");
      expect(formatDrawdownPercent(0.04)).toBe("0.0%");
      expect(formatDrawdownPercent(1.5)).toBe("-1.5%");
    });

    it("ensures PerformanceChart verifies finite numbers for SMA tooltip items", () => {
      const chart = readFileSync(
        resolve(__dirname, "../components/PerformanceChart.tsx"),
        "utf8",
      );

      expect(chart).toContain('typeof sma5Item?.value === "number" &&');
      expect(chart).toContain("Number.isFinite(sma5Item.value)");
      expect(chart).toContain('typeof sma25Item?.value === "number" &&');
      expect(chart).toContain("Number.isFinite(sma25Item.value)");
    });
  });
});
