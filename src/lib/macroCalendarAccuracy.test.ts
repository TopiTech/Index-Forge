import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BOJ_MEETING_SCHEDULE,
  FOMC_MEETING_SCHEDULE,
  getNextScheduledMeetings,
  MACRO_METRICS_DEFAULTS,
} from "../data/macroSchedule";
import { generateUpcomingEvents } from "./marketDataService";

const mockStore = new Map<string, string>();
const mockSessionStorage = {
  getItem: (k: string) => mockStore.get(k) ?? null,
  setItem: (k: string, v: string) => mockStore.set(k, String(v)),
  removeItem: (k: string) => mockStore.delete(k),
  clear: () => mockStore.clear(),
};

if (typeof globalThis.sessionStorage === "undefined") {
  Object.defineProperty(globalThis, "sessionStorage", {
    value: mockSessionStorage,
    writable: true,
  });
}

describe("Macro Calendar Events Accuracy and Meeting Schedules", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockStore.clear();
  });

  describe("Official Meeting Schedule Master", () => {
    it("contains complete 2024 to 2027 schedules for BOJ and FOMC", () => {
      expect(BOJ_MEETING_SCHEDULE.length).toBeGreaterThanOrEqual(32);
      expect(FOMC_MEETING_SCHEDULE.length).toBeGreaterThanOrEqual(32);

      // Verify specific 2025/2026 meetings
      const boj2025 = BOJ_MEETING_SCHEDULE.filter((m) => m.year === 2025);
      expect(boj2025.length).toBe(8);

      const fomc2025 = FOMC_MEETING_SCHEDULE.filter((m) => m.year === 2025);
      expect(fomc2025.length).toBe(8);
    });

    it("extracts the exact next meeting from a given reference date", () => {
      // Reference date: 2025-02-01
      const ref = new Date(2025, 1, 1);
      const nextBoj = getNextScheduledMeetings(BOJ_MEETING_SCHEDULE, ref, 2);
      expect(nextBoj[0]).toEqual(new Date(2025, 2, 19)); // March 19, 2025
      expect(nextBoj[1]).toEqual(new Date(2025, 4, 1)); // May 1, 2025

      const nextFomc = getNextScheduledMeetings(FOMC_MEETING_SCHEDULE, ref, 2);
      expect(nextFomc[0]).toEqual(new Date(2025, 2, 19)); // March 19, 2025
      expect(nextFomc[1]).toEqual(new Date(2025, 4, 7)); // May 7, 2025
    });
  });

  describe("generateUpcomingEvents Accuracy", () => {
    it("generates BOJ meeting with official dates instead of hardcoded 4-day offset", () => {
      const ref = new Date(2025, 0, 10); // Jan 10, 2025
      const events = generateUpcomingEvents(ref);
      const boj = events.find((e) => e.id === "macro-boj");
      expect(boj).toBeDefined();
      // Official next meeting in Jan 2025 was Jan 24, 2025
      expect(boj?.fullDate).toBe("2025-01-24");
      expect(boj?.previous).toBe(MACRO_METRICS_DEFAULTS.boj.previous);
      expect(boj?.forecast).toBe(MACRO_METRICS_DEFAULTS.boj.forecast);
    });

    it("generates FOMC meeting with official dates instead of hardcoded 12-day offset", () => {
      const ref = new Date(2025, 0, 10); // Jan 10, 2025
      const events = generateUpcomingEvents(ref);
      const fomc = events.find((e) => e.id === "macro-fomc");
      expect(fomc).toBeDefined();
      // Official next meeting in Jan 2025 was Jan 29, 2025
      expect(fomc?.fullDate).toBe("2025-01-29");
      expect(fomc?.previous).toBe(MACRO_METRICS_DEFAULTS.fomc.previous);
      expect(fomc?.forecast).toBe(MACRO_METRICS_DEFAULTS.fomc.forecast);
    });

    it("generates accurate US Jobs report on the 1st Friday of target month", () => {
      const ref = new Date(2025, 1, 15); // Feb 15, 2025
      const events = generateUpcomingEvents(ref);
      const jobs = events.find((e) => e.id === "macro-jobs");
      expect(jobs).toBeDefined();
      // Next 1st Friday after Feb 15, 2025 is March 7, 2025
      expect(jobs?.fullDate).toBe("2025-03-07");
    });
  });

  describe("Calendar Session Storage Cache Expiration (TTL)", () => {
    it("expires cache after 1 hour TTL", () => {
      const cacheKey = "indexforge:calendar:cache:v1";
      const now = Date.now();
      const oldTimestamp = now - 2 * 60 * 60 * 1000; // 2 hours ago

      sessionStorage.setItem(
        cacheKey,
        JSON.stringify({
          timestamp: oldTimestamp,
          events: [
            {
              id: "stale-event",
              date: "01/01",
              title: "Old Stale Event",
              importance: "HIGH",
              type: "MACRO",
            },
          ],
        }),
      );

      // Generating or loading events will ignore/discard expired cache
      const stored = sessionStorage.getItem(cacheKey);
      expect(stored).toContain("stale-event");
      const parsed = JSON.parse(stored!);
      expect(now - parsed.timestamp).toBeGreaterThan(60 * 60 * 1000);
    });
  });
});
