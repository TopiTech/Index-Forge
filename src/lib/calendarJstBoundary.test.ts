import { describe, expect, it, vi } from "vitest";

vi.mock("./marketCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./marketCache")>();
  return { ...actual, jstDateString: () => "2026-01-01" };
});

import { generateUpcomingEvents } from "./marketDataService";

function addBusinessDays(start: Date, days: number): Date {
  const cur = new Date(start);
  let added = 0;
  while (added < days) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return cur;
}

function fullDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

describe("fallback calendar JST boundary", () => {
  it("derives business-day offsets from the JST calendar day, not the host's local day", () => {
    // The caller's local day is 2025-12-31 while the JST calendar day is
    // 2026-01-01. A local-time generator produces a different weekday offset.
    const localDate = new Date(2025, 11, 31);
    const events = generateUpcomingEvents(localDate);
    const toyota = events.find((event) => event.id === "earn-toyota");

    expect(toyota?.fullDate).toBe(fullDate(addBusinessDays(new Date(2026, 0, 1), 2)));
  });
});
