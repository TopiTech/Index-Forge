import { describe, it, expect } from "vitest";
import { buildChartData, downsampleLTTB } from "./chartData";
import type { PricePoint } from "../types";

describe("buildChartData", () => {
  const base = 1000;

  it("uses date-aligned nikkei value when available", () => {
    const nikkei: PricePoint[] = [
      { date: "2026-04-01", close: 1000 },
      { date: "2026-04-02", close: 1100 },
    ];
    const custom: PricePoint[] = [
      { date: "2026-04-01", close: 100, value: 1000 },
      { date: "2026-04-02", close: 110, value: 1100 },
    ];
    const result = buildChartData(nikkei, custom, base);
    expect(result[0].nikkei).toBe(1000);
    expect(result[1].nikkei).toBe(1100);
  });

  it("does not use positional fallback when dates diverge (R2 regression)", () => {
    const nikkei: PricePoint[] = [
      { date: "2026-04-01", close: 1000 },
      { date: "2026-04-02", close: 2000 },
      { date: "2026-04-03", close: 3000 },
    ];
    const custom: PricePoint[] = [
      { date: "2026-04-01", close: 100, value: 1000 },
      { date: "2026-04-03", close: 120, value: 1200 },
    ];
    const result = buildChartData(nikkei, custom, base);
    expect(result[0].nikkei).toBe(1000);
    // 2026-04-03 should map to nikkei 3000, not positional nikkei[1]=2000
    expect(result[1].nikkei).toBe(3000);
  });

  it("forward-fills nikkei when date missing", () => {
    const nikkei: PricePoint[] = [
      { date: "2026-04-01", close: 1000 },
      { date: "2026-04-02", close: 1100 },
    ];
    const custom: PricePoint[] = [
      { date: "2026-04-01", close: 100, value: 1000 },
      { date: "2026-04-02", close: 110, value: 1100 },
      { date: "2026-04-03", close: 120, value: 1200 },
    ];
    const result = buildChartData(nikkei, custom, base);
    expect(result[2].nikkei).toBe(1100);
  });

  it("returns empty when either series is empty", () => {
    expect(buildChartData([], [{ date: "2026-04-01", close: 1, value: 1000 }], base)).toEqual([]);
    expect(buildChartData([{ date: "2026-04-01", close: 1000 }], [], base)).toEqual([]);
  });

  it("aligns benchmark baseline to customSeries start date when nikkei starts earlier", () => {
    const nikkei: PricePoint[] = [
      { date: "2026-03-25", close: 36000 },
      { date: "2026-04-01", close: 38000 },
      { date: "2026-04-02", close: 39900 },
    ];
    const custom: PricePoint[] = [
      { date: "2026-04-01", close: 1000, value: 1000 },
      { date: "2026-04-02", close: 1050, value: 1050 },
    ];
    const result = buildChartData(nikkei, custom, base);
    expect(result.length).toBe(2);
    // On 2026-04-01 (start date), Nikkei benchmark should normalize to baseValue (1000)
    expect(result[0].nikkei).toBe(1000);
    // On 2026-04-02, Nikkei should be 1000 * (39900 / 38000) = 1050
    expect(result[1].nikkei).toBe(1050);
  });

  it("handles fallback to point.close when point.value is omitted", () => {
    const nikkei: PricePoint[] = [
      { date: "2026-04-01", close: 1000 },
    ];
    const custom: PricePoint[] = [
      { date: "2026-04-01", close: 1250 },
    ];
    const result = buildChartData(nikkei, custom, base);
    expect(result[0].value).toBe(1250);
    expect(result[0].close).toBe(1250);
  });

  it("handles custom and invalid baseValues gracefully", () => {
    const nikkei: PricePoint[] = [
      { date: "2026-04-01", close: 1000 },
      { date: "2026-04-02", close: 1200 },
    ];
    const custom: PricePoint[] = [
      { date: "2026-04-01", close: 500, value: 500 },
      { date: "2026-04-02", close: 600, value: 600 },
    ];
    const result500 = buildChartData(nikkei, custom, 500);
    expect(result500[0].nikkei).toBe(500);
    expect(result500[1].nikkei).toBe(600);

    const resultInvalid = buildChartData(nikkei, custom, -50 as any);
    expect(resultInvalid[0].nikkei).toBe(1000);
    expect(resultInvalid[1].nikkei).toBe(1200);
  });

  it("filters out customSeries dates prior to nikkei start date to avoid flat line", () => {
    const nikkei: PricePoint[] = [
      { date: "2026-08-01", close: 38000 },
      { date: "2026-08-02", close: 39900 },
    ];
    const custom: PricePoint[] = [
      { date: "2026-04-01", close: 1000, value: 1000 },
      { date: "2026-05-01", close: 1020, value: 1020 },
      { date: "2026-08-01", close: 1050, value: 1050 },
      { date: "2026-08-02", close: 1100, value: 1100 },
    ];
    const result = buildChartData(nikkei, custom, base);
    expect(result.length).toBe(2);
    expect(result[0].date).toBe("2026-08-01");
    expect(result[0].nikkei).toBe(1000);
    expect(result[0].value).toBe(1050);
    expect(result[1].date).toBe("2026-08-02");
    expect(result[1].nikkei).toBe(1050);
    expect(result[1].value).toBe(1100);
  });

  it("aligns benchmark baseline to closest preceding price when custom startDate falls on a benchmark market holiday", () => {
    // Benchmark market was closed on 2026-07-04 (e.g. US holiday)
    // Most recent benchmark price before 2026-07-04 was on 2026-07-03 (close = 5000)
    const benchmark: PricePoint[] = [
      { date: "2026-07-01", close: 4800 },
      { date: "2026-07-02", close: 4900 },
      { date: "2026-07-03", close: 5000 },
      { date: "2026-07-06", close: 5100 },
    ];
    const custom: PricePoint[] = [
      { date: "2026-07-04", close: 1000, value: 1000 }, // TSE traded on 07-04
      { date: "2026-07-06", close: 1020, value: 1020 },
    ];

    const result = buildChartData(benchmark, custom, base);
    expect(result.length).toBe(2);
    // On 2026-07-04, benchmark was closed, so it uses 5000 (07-03 close) as baseline (1000 * 5000 / 5000 = 1000)
    expect(result[0].date).toBe("2026-07-04");
    expect(result[0].nikkei).toBe(1000);

    // On 2026-07-06, benchmark was 5100, normalized to (1000 * 5100 / 5000 = 1020)
    expect(result[1].date).toBe("2026-07-06");
    expect(result[1].nikkei).toBe(1020);
  });
});

describe("downsampleLTTB", () => {
  it("returns original data if length is below or equal to threshold", () => {
    const points = [
      { date: "2026-01-01", value: 10 },
      { date: "2026-01-02", value: 20 },
      { date: "2026-01-03", value: 15 },
    ];
    expect(downsampleLTTB(points, 5)).toEqual(points);
  });

  it("downsamples large series to exact threshold while keeping first and last points", () => {
    const points = Array.from({ length: 500 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(3, "0")}`,
      value: Math.sin(i / 10) * 50 + 100,
    }));

    const result = downsampleLTTB(points, 50);
    expect(result.length).toBe(50);
    expect(result[0]).toEqual(points[0]);
    expect(result[result.length - 1]).toEqual(points[points.length - 1]);
  });

  it("preserves prominent peak values during downsampling", () => {
    const points = [
      { date: "2026-01-01", value: 10 },
      { date: "2026-01-02", value: 12 },
      { date: "2026-01-03", value: 100 }, // Prominent peak
      { date: "2026-01-04", value: 11 },
      { date: "2026-01-05", value: 10 },
    ];
    const result = downsampleLTTB(points, 3);
    expect(result.length).toBe(3);
    expect(result[0].value).toBe(10);
    expect(result[1].value).toBe(100); // Peak is captured
    expect(result[2].value).toBe(10);
  });
});
