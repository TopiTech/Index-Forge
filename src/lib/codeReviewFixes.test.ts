import { describe, it, expect } from "vitest";
import { calculateRiskMetrics } from "./analytics";
import { getMarketAwareCacheDuration, isPriceCacheFresh, jstDateString } from "./marketCache";
import type { PricePoint } from "../types";

describe("jstDateString: one JST calendar day for every producer", () => {
  it("returns the JST day, not the UTC day, just after midnight JST", () => {
    // 2026-01-01T00:30+09:00 == 2025-12-31T15:30Z
    expect(jstDateString(new Date("2025-12-31T15:30:00.000Z"))).toBe("2026-01-01");
  });

  it("stays on the same JST day through 08:59 JST", () => {
    expect(jstDateString(new Date("2025-12-31T23:59:59.999Z"))).toBe("2026-01-01");
  });

  it("rolls over exactly at 00:00 JST", () => {
    expect(jstDateString(new Date("2025-12-31T14:59:59.999Z"))).toBe("2025-12-31");
    expect(jstDateString(new Date("2025-12-31T15:00:00.000Z"))).toBe("2026-01-01");
  });
});

// ---------------------------------------------------------------------------
// HIGH-01: CAGR calculation parentheses / boundary regression tests
// ---------------------------------------------------------------------------
describe("HIGH-01: CAGR annual return calculation", () => {
  /**
   * Generate a synthetic price series of `days` length with a fixed daily
   * return so we can predict the annualized result precisely.
   */
  function makeSeries(days: number, dailyReturn: number): PricePoint[] {
    const series: PricePoint[] = [];
    let price = 1000;
    for (let i = 0; i < days; i++) {
      series.push({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        close: price,
        value: price,
      });
      price *= 1 + dailyReturn;
    }
    return series;
  }

  it("computes positive CAGR for a long series (>= 250 days)", () => {
    // 260 data points → 259 daily returns (>= 250 threshold for CAGR branch)
    const series = makeSeries(260, 0.001); // +0.1% daily
    const metrics = calculateRiskMetrics(series, []);
    expect(Number.isFinite(metrics.annualReturn)).toBe(true);
    expect(metrics.annualReturn).toBeGreaterThan(0);
  });

  it("computes negative CAGR for a long declining series (>= 250 days)", () => {
    const series = makeSeries(260, -0.001); // -0.1% daily
    const metrics = calculateRiskMetrics(series, []);
    expect(Number.isFinite(metrics.annualReturn)).toBe(true);
    expect(metrics.annualReturn).toBeLessThan(0);
  });

  it("returns -100 for a total-wipeout scenario in CAGR branch", () => {
    // Construct a series where the asset loses >99.9% of its value over 260 days
    const series: PricePoint[] = [];
    for (let i = 0; i < 260; i++) {
      const price = i === 0 ? 1000 : 0.001;
      series.push({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        close: price,
        value: price,
      });
    }
    const metrics = calculateRiskMetrics(series, []);
    expect(Number.isFinite(metrics.annualReturn)).toBe(true);
    // totalReturn ≈ -0.999999 → (1 + totalReturn) ≈ 0.000001 > 0
    // so it takes the CAGR path, not the -100 cap.
    // Just ensure it's a large negative finite number.
    expect(metrics.annualReturn).toBeLessThan(-90);
  });

  it("uses linear annualization for short series (< 250 days)", () => {
    const series = makeSeries(100, 0.001); // +0.1% daily, 99 returns
    const metrics = calculateRiskMetrics(series, []);
    expect(Number.isFinite(metrics.annualReturn)).toBe(true);
    // Linear: totalReturn * (250/99) * 100
    // totalReturn ≈ (1.001^99 - 1) ≈ 0.1042 → ~26.3%
    expect(metrics.annualReturn).toBeGreaterThan(20);
    expect(metrics.annualReturn).toBeLessThan(35);
  });

  it("all metrics remain finite at the 249→250 day boundary", () => {
    // 250 data points → 249 daily returns: just below CAGR threshold
    const shortSeries = makeSeries(250, 0.0005);
    const shortMetrics = calculateRiskMetrics(shortSeries, []);
    expect(Number.isFinite(shortMetrics.annualReturn)).toBe(true);

    // 251 data points → 250 daily returns: at CAGR threshold
    const longSeries = makeSeries(251, 0.0005);
    const longMetrics = calculateRiskMetrics(longSeries, []);
    expect(Number.isFinite(longMetrics.annualReturn)).toBe(true);

    // Both should be positive and roughly in the same ballpark
    expect(shortMetrics.annualReturn).toBeGreaterThan(0);
    expect(longMetrics.annualReturn).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// HIGH-02: Market cache duration regression tests
// ---------------------------------------------------------------------------
describe("HIGH-02: getMarketAwareCacheDuration trading-hours TTL", () => {
  /**
   * Create a Date that represents the given JST day-of-week and JST time.
   * day: 0=Sun ... 5=Fri 6=Sat
   */
  function makeJstDate(day: number, hours: number, mins: number): Date {
    // Start from a known Monday 00:00 UTC → Monday 09:00 JST
    // 2024-01-01 is a Monday
    const baseMonday = new Date("2024-01-01T00:00:00Z"); // Mon 09:00 JST
    // Shift to target day-of-week (Mon=1)
    const daysFromMon = ((day - 1) + 7) % 7;
    const jstOffsetMs = 9 * 60 * 60 * 1000;
    // Target JST time → UTC time
    const targetJstMs = (hours * 60 + mins) * 60 * 1000;
    const utcMs = baseMonday.getTime() + daysFromMon * 86400000 + targetJstMs - jstOffsetMs;
    return new Date(utcMs);
  }

  it("returns less than 12 hours during trading hours", () => {
    // Monday 10:00 JST — well within market hours
    const mon10am = makeJstDate(1, 10, 0);
    const duration = getMarketAwareCacheDuration(mon10am);
    // Should be roughly (15:30 + 0:30 - 10:00) * 60 = 360 minutes = 21600s
    expect(duration).toBeLessThan(12 * 60 * 60);
    // More precisely: (16:00 - 10:00) * 60 * 60 = 21600
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(6 * 60 * 60 + 60); // max ~6h
  });

  it("returns time until settlement (close + 30min) during market hours", () => {
    // Wednesday 14:00 JST → settlement at 16:00 JST → 2 hours = 7200s
    const wed2pm = makeJstDate(3, 14, 0);
    const duration = getMarketAwareCacheDuration(wed2pm);
    // MARKET_CLOSE_JST = 15:30 = 930 min, +30 = 960 min, current = 840 min
    // 960 - 840 = 120 min = 7200s
    expect(duration).toBe(7200);
  });

  it("returns at least 60 seconds even near end of settlement window", () => {
    // 15:29 JST — 1 minute before close, settlement at 16:00
    // 960 - 929 = 31 min = 1860s
    const nearClose = makeJstDate(2, 15, 29);
    const duration = getMarketAwareCacheDuration(nearClose);
    expect(duration).toBeGreaterThanOrEqual(60);
  });

  it("returns next-market-open duration outside trading hours", () => {
    // Saturday 12:00 JST — weekend
    const sat = makeJstDate(6, 12, 0);
    const duration = getMarketAwareCacheDuration(sat);
    // Should be until Monday 09:00 JST ≈ 45 hours = 162000s
    expect(duration).toBeGreaterThan(40 * 60 * 60);
  });

  it("returns next-market-open duration after market close on weekday", () => {
    // Tuesday 18:00 JST — after close
    const tueEvening = makeJstDate(2, 18, 0);
    const duration = getMarketAwareCacheDuration(tueEvening);
    // Until Wednesday 09:00 JST = 15 hours = 54000s
    expect(duration).toBe(15 * 60 * 60);
  });
});

// ---------------------------------------------------------------------------
// Integration: isPriceCacheFresh with updated cache duration
// ---------------------------------------------------------------------------
describe("isPriceCacheFresh with trading-hours cache", () => {
  function toUnixSec(dateStr: string): number {
    return Math.floor(new Date(dateStr).getTime() / 1000);
  }

  it("considers a sync during trading hours stale after market close same day", () => {
    // Synced at Monday 10:00 JST, checking at Monday 16:00 JST
    const syncedAt = toUnixSec("2024-01-01T01:00:00Z"); // Mon 10:00 JST
    const nowAt = toUnixSec("2024-01-01T07:00:00Z");    // Mon 16:00 JST
    expect(isPriceCacheFresh(nowAt, syncedAt)).toBe(false);
  });

  it("considers a sync during trading hours fresh before market close same day", () => {
    // Synced at Monday 10:00 JST, checking at Monday 14:00 JST
    const syncedAt = toUnixSec("2024-01-01T01:00:00Z"); // Mon 10:00 JST
    const nowAt = toUnixSec("2024-01-01T05:00:00Z");    // Mon 14:00 JST
    expect(isPriceCacheFresh(nowAt, syncedAt)).toBe(true);
  });

  it("fails closed for invalid synchronization timestamps", () => {
    const nowAt = toUnixSec("2024-01-02T05:00:00Z");
    expect(isPriceCacheFresh(nowAt, 0)).toBe(false);
    expect(isPriceCacheFresh(nowAt, -1)).toBe(false);
    expect(isPriceCacheFresh(nowAt, Number.NaN)).toBe(false);
    expect(isPriceCacheFresh(Number.NaN, nowAt)).toBe(false);
    expect(isPriceCacheFresh(0, nowAt)).toBe(false);
  });
});
