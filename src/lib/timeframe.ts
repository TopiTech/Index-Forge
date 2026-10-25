import type { Timeframe } from "../types";

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1W": "1週間",
  "1M": "1か月",
  "3M": "3か月",
  "6M": "6か月",
  YTD: "年初来",
  "1Y": "全期間",
};

/** Milliseconds in one civil day; JST-midnight arithmetic stays aligned. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a `YYYY-MM-DD` trading date; `null` when the cell is malformed. */
function parseTradingDate(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject impossible calendar dates (e.g. 2026-02-30) the same way the
  // chart would fail to place them.
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return { y, m, d };
}

/** Latest trading date in the input (inputs may arrive unsorted). */
function maxTradingDate<T extends { date: string }>(data: T[]): string | null {
  let latest: string | null = null;
  for (const point of data) {
    if (parseTradingDate(point.date) === null) continue;
    if (latest === null || point.date > latest) latest = point.date;
  }
  return latest;
}

function formatTradingDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Shift a trading date by whole calendar months, clamping the day (Mar 31 → Feb 28). */
function shiftTradingMonth(date: string, months: number): string | null {
  const parsed = parseTradingDate(date);
  if (!parsed) return null;
  const total = parsed.y * 12 + (parsed.m - 1) - months;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  const d = Math.min(parsed.d, new Date(Date.UTC(y, m, 0)).getUTCDate());
  return formatTradingDate(y, m, d);
}

/** Shift a trading date by whole days through its JST-midnight instant. */
function shiftTradingDay(date: string, days: number): string | null {
  const parsed = parseTradingDate(date);
  if (!parsed) return null;
  // JST midnight is 15:00 UTC the previous day; shifting by whole days keeps
  // the calendar date aligned regardless of the viewer's time zone.
  const shifted = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d) - days * DAY_MS);
  return formatTradingDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function filterByTimeframe<T extends { date: string }>(
  data: T[],
  timeframe: Timeframe,
): T[] {
  if (data.length === 0) return [];
  if (timeframe === "1Y") return data;
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
  // Fixed point counts (5/22/65/130) approximated calendar months by trading
  // days, so a sparse series showed two calendar months under the "1か月"
  // label while a dense one showed three weeks. Cut by calendar date in JST
  // instead, anchored at the series' own latest date (not "now", which would
  // empty out a stale series). The window always contains the latest point.
  const latest = maxTradingDate(data);
  if (latest === null) return [...data];
  const cutoff = timeframe === "1W"
    ? shiftTradingDay(latest, 6)
    : timeframe === "1M"
      ? shiftTradingMonth(latest, 1)
      : timeframe === "3M"
        ? shiftTradingMonth(latest, 3)
        : shiftTradingMonth(latest, 6);
  if (cutoff === null) return [...data];
  return data.filter((point) => point.date >= cutoff);
}
