import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMissingColumnError, isMissingTableError } from "../../worker/index";
import {
  calculateConstituentPerformance,
  calculatePeriodReturns,
} from "../hooks/useSimulation";
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
        { date: "2026-09-01", value: 1000 },
        { date: "2026-09-02", value: 999.9999 },
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
        { date: "2026-09-01", value: 1000 },
        { date: "2026-09-02", value: 1050 }, // +5.00%
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

    it("ensures SimulationPreview uses strict positive (> 0) comparison for sign and color highlights", () => {
      const preview = readFileSync(
        resolve(__dirname, "../components/SimulationPreview.tsx"),
        "utf8",
      );

      // Ensure periodCustomReturnPct > 0 and alphaPct > 0 are used instead of >= 0
      expect(preview).toContain('periodCustomReturnPct > 0 ? "+" : ""');
      expect(preview).toContain('alphaPct > 0 ? "+" : ""');
      expect(preview).toContain('metrics.annualReturn > 0 ? "+" : ""');

      // Ensure 0 values are not styled with neon green
      expect(preview).toContain('periodCustomReturnPct > 0\n              ? "var(--neon-green)"');
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
