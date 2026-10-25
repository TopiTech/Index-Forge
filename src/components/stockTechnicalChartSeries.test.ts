// @vitest-environment node
/**
 * S1: provenance of the technical chart series.
 *
 * `/api/calculate` and the benchmark snapshot only provide `{date, close}`.
 * The chart used to synthesize open/high/low and volume per point, then render
 * them (and the demo badge was suppressed), so invented values read as market
 * facts. The mapper may only carry what the API actually supplied.
 */
import { describe, expect, it } from "vitest";
import { buildTechnicalChartSeries } from "./StockTechnicalChart";

describe("buildTechnicalChartSeries data provenance (S1)", () => {
  it("carries no OHLC or volume for a close-only API series", () => {
    const points = buildTechnicalChartSeries([
      { date: "2026-10-01", close: 100 },
      { date: "2026-10-02", close: 110 },
    ]);

    expect(points).toHaveLength(2);
    for (const point of points) {
      expect(Object.keys(point).sort()).toEqual([
        "close",
        "date",
        "displayDate",
        "sma25",
        "sma75",
      ]);
    }
  });

  it("keeps a real positive volume supplied by the API", () => {
    const [point] = buildTechnicalChartSeries([
      { date: "2026-10-01", close: 100, volume: 12_345 },
    ]);

    expect(point.volume).toBe(12_345);
  });

  it("drops a zero or non-finite volume instead of drawing a fake or zero bar", () => {
    const points = buildTechnicalChartSeries([
      { date: "2026-10-01", close: 100, volume: 0 },
      { date: "2026-10-02", close: 101, volume: Number.NaN },
    ]);

    for (const point of points) {
      expect(point).not.toHaveProperty("volume");
    }
  });

  it("drops a row whose close is missing or non-positive instead of inventing a past price", () => {
    const points = buildTechnicalChartSeries([
      { date: "2026-10-01", close: 0 },
      { date: "2026-10-02", close: Number.NaN },
      { date: "2026-10-03", close: 101 },
    ]);

    expect(points).toHaveLength(1);
    expect(points[0].date).toBe("2026-10-03");
    expect(points[0].close).toBe(101);
    expect(points[0]).not.toHaveProperty("volume");
  });

  it("returns no history when every observation is unusable", () => {
    expect(
      buildTechnicalChartSeries([
        { date: "2026-10-01", close: 0 },
        { date: "2026-10-02", close: Number.NaN },
      ]),
    ).toEqual([]);
  });
});
