import { describe, expect, it } from "vitest";
import { filterByTimeframe } from "./timeframe";

function dailySeries(from: string, days: number): Array<{ date: string; close: number }> {
  const [y, m, d] = from.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  return Array.from({ length: days }, (_, i) => {
    const t = new Date(start + i * 24 * 60 * 60 * 1000);
    const date =
      `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
    return { date, close: 100 + i };
  });
}

describe("filterByTimeframe calendar windows (M-3)", () => {
  it("cuts 1M by calendar month in JST, not by 22 points", () => {
    // Dense daily series Jan 1 - Mar 31: the old slice(-22) returned Mar 10-31.
    const data = dailySeries("2026-01-01", 90);
    const result = filterByTimeframe(data, "1M");
    // Latest Mar 31 minus one calendar month, clamped: Feb 28 - Mar 31.
    expect(result[0].date).toBe("2026-02-28");
    expect(result[result.length - 1].date).toBe("2026-03-31");
    expect(result.every((p) => p.date >= "2026-02-28")).toBe(true);
  });

  it("keeps a sparse series within the labeled calendar month", () => {
    // Gappy series spanning three months: point counts cannot express this.
    const data = [
      { date: "2026-01-05", close: 1 },
      { date: "2026-02-05", close: 2 },
      { date: "2026-03-05", close: 3 },
      { date: "2026-03-20", close: 4 },
    ];
    const result = filterByTimeframe(data, "1M");
    // Latest Mar 20 minus one month = Feb 20: Jan/Feb-05 are out, both March points stay.
    expect(result.map((p) => p.date)).toEqual(["2026-03-05", "2026-03-20"]);
  });

  it("returns the last 7 calendar days for 1W", () => {
    const data = dailySeries("2026-04-01", 14);
    const result = filterByTimeframe(data, "1W");
    expect(result).toHaveLength(7);
    expect(result[0].date).toBe("2026-04-08");
    expect(result[result.length - 1].date).toBe("2026-04-14");
  });

  it("clamps month-end cutoffs (Mar 31 minus one month is Feb 28)", () => {
    const data = dailySeries("2026-02-01", 59); // Feb 1 - Mar 31 (2026 is not a leap year)
    const result = filterByTimeframe(data, "1M");
    expect(result[0].date).toBe("2026-02-28");
  });

  it("anchors at the series latest date even when unsorted", () => {
    const data = [
      { date: "2026-03-20", close: 4 },
      { date: "2026-01-05", close: 1 },
      { date: "2026-03-05", close: 3 },
    ];
    const result = filterByTimeframe(data, "1M");
    expect(result.map((p) => p.date)).toEqual(["2026-03-20", "2026-03-05"]);
  });

  it("always keeps at least the latest point", () => {
    const data = [{ date: "2020-01-01", close: 1 }];
    for (const tf of ["1W", "1M", "3M", "6M"] as const) {
      expect(filterByTimeframe(data, tf)).toEqual(data);
    }
  });

  it("returns a copy when no date is parseable instead of failing", () => {
    const data = [{ date: "not-a-date", close: 1 }];
    const result = filterByTimeframe(data, "1M");
    expect(result).toEqual(data);
    expect(result).not.toBe(data);
  });

  it("returns everything for 1Y and nothing for empty input", () => {
    const data = dailySeries("2025-01-01", 400);
    expect(filterByTimeframe(data, "1Y")).toHaveLength(400);
    expect(filterByTimeframe([], "1M")).toEqual([]);
  });

  it("keeps 3M/6M calendar cutoffs", () => {
    const data = dailySeries("2026-01-01", 180); // Jan 1 - Jun 29
    const latest = data[data.length - 1].date;
    expect(latest).toBe("2026-06-29");
    expect(filterByTimeframe(data, "3M")[0].date).toBe("2026-03-29");
    expect(filterByTimeframe(data, "6M")[0].date).toBe("2026-01-01");
  });
});
