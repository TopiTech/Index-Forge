import type { Timeframe } from "../types";

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1W": "1週間",
  "1M": "1か月",
  "3M": "3か月",
  "6M": "6か月",
  YTD: "年初来",
  "1Y": "全期間",
};

export function filterByTimeframe<T extends { date: string }>(
  data: T[],
  timeframe: Timeframe,
): T[] {
  if (data.length === 0) return [];
  if (timeframe === "1W") return data.slice(-5);
  if (timeframe === "1M") return data.slice(-22);
  if (timeframe === "3M") return data.slice(-65);
  if (timeframe === "6M") return data.slice(-130);
  if (timeframe === "YTD") {
    // Price dates are JST trading dates, so the year boundary must be
    // evaluated in JST as well. Using the browser-local year returned the
    // previous year's series (labeled 年初来) for users west of JST during the
    // first hours of January 1.
    const currentYear = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear().toString();
    // Never mix the previous year into a YTD series. Returning a short series
    // is safer than labeling a cross-year return as year-to-date; callers can
    // render it as insufficient data when fewer than two points are available.
    return data.filter((point) => point.date.startsWith(currentYear));
  }
  return data;
}
