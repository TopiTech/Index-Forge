import { describe, expect, it } from "vitest";
import {
  exportCalendarToIcs,
  foldIcsLine,
  sanitizeIcsUid,
  type CalendarEvent,
} from "./marketDataService";

/**
 * RFC 5545 conformance for the calendar export (SEC-09).
 *
 * Two defects motivated these tests:
 *  - the `UID` was built from the raw event id, so an id containing CRLF could
 *    inject arbitrary iCalendar properties into the exported file;
 *  - no line was folded, so the 75-octet limit was violated by every Japanese
 *    description, and strict clients truncated it.
 */
describe("iCalendar export conformance", () => {
  const baseEvent: CalendarEvent = {
    id: "earn-7203",
    date: "10/15",
    fullDate: "2026-10-15",
    type: "EARNINGS",
    title: "トヨタ自動車 決算",
    importance: "HIGH",
    time: "15:00 JST",
    market: "TSE",
    ticker: "7203",
    companyName: "トヨタ自動車",
  };

  const octets = (value: string) => new TextEncoder().encode(value).length;

  it("sanitizes the UID so an injected id cannot add properties", () => {
    expect(sanitizeIcsUid("abc\r\nATTENDEE:mailto:a@b")).toBe("abc--ATTENDEE-mailto-a-b");
    expect(sanitizeIcsUid("")).toBe("event");
  });

  it("does not let a hostile event id inject iCalendar properties", () => {
    const ics = exportCalendarToIcs([
      { ...baseEvent, id: "evil\r\nATTENDEE:mailto:attacker@example.com" },
    ]);
    const lines = ics.split("\r\n");
    const uidLines = lines.filter((line) => line.startsWith("UID:"));
    expect(uidLines).toHaveLength(1);
    // The sanitized id may still contain the word, but it must stay inside a
    // single property value: no injected property may appear as its own line.
    expect(uidLines[0]).not.toContain("\r");
    expect(uidLines[0]).not.toContain("\n");
    expect(lines.some((line) => line.startsWith("ATTENDEE:"))).toBe(false);
    expect(lines.some((line) => line.startsWith("mailto:"))).toBe(false);
  });

  it("folds every content line to at most 75 octets", () => {
    const ics = exportCalendarToIcs([
      { ...baseEvent, description: "あ".repeat(400) },
    ]);
    for (const line of ics.split("\r\n")) {
      expect(octets(line)).toBeLessThanOrEqual(75);
    }
  });

  it("round-trips the folded description", () => {
    const description = "説明".repeat(120);
    const ics = exportCalendarToIcs([{ ...baseEvent, description }]);
    // Unfolding removes the CRLF + single space that the fold inserted.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:");
    // The description is the last element of the exported description block,
    // so it must survive the folding byte for byte.
    expect(unfolded).toContain(description);
  });

  it("folds a single line without losing characters", () => {
    const folded = foldIcsLine("X".repeat(200));
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toHaveLength(75);
    expect(parts.slice(1).every((part) => part.startsWith(" "))).toBe(true);
    expect(parts.map((part) => part.replace(/^ /, "")).join("")).toBe("X".repeat(200));
  });
});
