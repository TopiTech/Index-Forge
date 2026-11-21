import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOJ_MEETING_SCHEDULE,
  FOMC_MEETING_SCHEDULE,
  getNextScheduledMeetingsForJstDate,
} from "../data/macroSchedule";
import {
  generateUpcomingEvents,
  getStockFundamentals,
} from "./marketDataService";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("BUG-01: macroSchedule & generateUpcomingEvents JST date precision", () => {
  it("selects the next BOJ/FOMC meetings using explicit JST Y/M/D without double timezone shifting", () => {
    // 2025-01-24 is a BOJ meeting day; 2025-01-25 (the next JST day) must advance to 2025-03-19.
    const onMeetingDay = getNextScheduledMeetingsForJstDate(BOJ_MEETING_SCHEDULE, 2025, 1, 24, 1);
    expect(onMeetingDay[0]).toEqual(new Date(2025, 0, 24));

    const dayAfterMeeting = getNextScheduledMeetingsForJstDate(BOJ_MEETING_SCHEDULE, 2025, 1, 25, 1);
    expect(dayAfterMeeting[0]).toEqual(new Date(2025, 2, 19));

    // FOMC: 2025-01-29 decision day -> 2025-01-30 advances to 2025-03-19.
    const dayAfterFomc = getNextScheduledMeetingsForJstDate(FOMC_MEETING_SCHEDULE, 2025, 1, 30, 1);
    expect(dayAfterFomc[0]).toEqual(new Date(2025, 2, 19));
  });

  it("handles reference instants around UTC midnight (00:00-08:59 JST) identically in generateUpcomingEvents", () => {
    // 2025-01-24T16:00:00.000Z === 2025-01-25 01:00:00 JST (day after Jan 24 BOJ meeting)
    const jstMorningAfterBoj = new Date("2025-01-24T16:00:00.000Z");
    const events = generateUpcomingEvents(jstMorningAfterBoj);
    const boj = events.find((e) => e.id === "macro-boj");
    expect(boj?.fullDate).toBe("2025-03-19");

    // 2025-01-24T14:59:59.000Z === 2025-01-24 23:59:59 JST (still Jan 24 JST)
    const jstNightOfBoj = new Date("2025-01-24T14:59:59.000Z");
    const eventsSameDay = generateUpcomingEvents(jstNightOfBoj);
    const bojSameDay = eventsSameDay.find((e) => e.id === "macro-boj");
    expect(bojSameDay?.fullDate).toBe("2025-01-24");
  });

  it("returns empty array when count <= 0 or after the final scheduled year", () => {
    expect(getNextScheduledMeetingsForJstDate(BOJ_MEETING_SCHEDULE, 2025, 1, 1, 0)).toEqual([]);
    expect(getNextScheduledMeetingsForJstDate(BOJ_MEETING_SCHEDULE, 2025, 1, 1, -1)).toEqual([]);
    expect(getNextScheduledMeetingsForJstDate(BOJ_MEETING_SCHEDULE, 2099, 1, 1, 2)).toEqual([]);
  });
});

describe("BUG-02: getStockFundamentals currency/market classification for TSE prefixes & JPY pairs", () => {
  it("classifies TSE:/TYO: unknown equities as JPY/PRIME rather than US Technology", () => {
    const tseCustom = getStockFundamentals("TSE:9999");
    expect(tseCustom.market).toBe("PRIME");
    expect(tseCustom.price).toBe(1000);
    expect(tseCustom.sector).toBe("その他");

    const tyoCustom = getStockFundamentals("TYO:8888");
    expect(tyoCustom.market).toBe("PRIME");
    expect(tyoCustom.price).toBe(1000);
  });

  it("keeps US tickers classified as US with USD fallback baseline", () => {
    const usCustom = getStockFundamentals("ZZZZ");
    expect(usCustom.market).toBe("US");
    expect(usCustom.price).toBe(100);
  });
});
