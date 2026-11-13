import { describe, expect, it } from "vitest";
import { resolveEventYear } from "./eventCalendar";

/** 2026-01-01T00:30 JST (still 2025-12-31 in UTC). */
const JST_NEW_YEAR = new Date("2025-12-31T15:30:00.000Z");
/** 2026-07-01T01:00 JST (still 2026-06-30 in UTC). */
const JST_JULY_FIRST = new Date("2026-06-30T16:00:00.000Z");

describe("resolveEventYear (shared MM/DD year rule)", () => {
  it("resolves the nearest occurrence in JST, not the UTC month", () => {
    // Seen from January 1 JST, a June event is closer forward (5 months).
    expect(resolveEventYear(6, 15, JST_NEW_YEAR)).toBe(2026);
    // A December event is closer backwards (one day).
    expect(resolveEventYear(12, 20, JST_NEW_YEAR)).toBe(2025);
    // Exactly six months ahead is a tie, which the existing rule breaks
    // toward the previous year (unchanged for backwards compatibility).
    expect(resolveEventYear(7, 1, JST_NEW_YEAR)).toBe(2025);
  });

  it("uses the JST month at the UTC month boundary", () => {
    // 2026-06-30T16:00Z is already July 1 in JST: a January event is six
    // months behind, so its nearest occurrence is 2027. The UTC clock still
    // reads June, where the same event stays in 2026.
    expect(resolveEventYear(1, 15, JST_JULY_FIRST)).toBe(2027);
    expect(resolveEventYear(1, 15, new Date("2026-06-30T14:00:00.000Z"))).toBe(2026);
  });

  it("rejects month/day pairs the resolved year does not contain", () => {
    expect(resolveEventYear(2, 30, JST_NEW_YEAR)).toBeNull();
    expect(resolveEventYear(4, 31, JST_NEW_YEAR)).toBeNull();
    expect(resolveEventYear(2, 29, JST_NEW_YEAR)).toBeNull(); // 2025 is not leap
    expect(resolveEventYear(2, 29, new Date("2024-01-10T00:00:00.000Z"))).toBe(2024);
  });

  it("rejects out-of-range and non-integer inputs", () => {
    expect(resolveEventYear(0, 10, JST_NEW_YEAR)).toBeNull();
    expect(resolveEventYear(13, 10, JST_NEW_YEAR)).toBeNull();
    expect(resolveEventYear(5, 0, JST_NEW_YEAR)).toBeNull();
    expect(resolveEventYear(Number.NaN, 10, JST_NEW_YEAR)).toBeNull();
    expect(resolveEventYear(5, 10.5, JST_NEW_YEAR)).toBeNull();
  });
});
