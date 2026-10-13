import { describe, it, expect } from "vitest";
import {
  exportCalendarToCsv,
  exportCalendarToIcs,
  escapeIcsText,
  type CalendarEvent,
} from "./marketDataService";
import * as fs from "fs";
import * as path from "path";

describe("Comprehensive Goal Code Review Final Audit Pass", () => {
  describe("1. CSV Formula Injection Hardening in exportCalendarToCsv", () => {
    it("escapes formula trigger characters (=, +, -, @, |) with a leading apostrophe", () => {
      const maliciousEvents: CalendarEvent[] = [
        {
          id: "evt-formula-injection-1",
          date: "10/15",
          fullDate: "2026-10-15",
          time: "10:00 JST",
          market: "US",
          type: "MACRO",
          title: "=cmd|'/C calc'!A0",
          importance: "HIGH",
          companyName: "@malicious Corp",
          previous: "+100%",
          forecast: "-50%",
          actual: "|system('calc')",
          description: "=1+1",
          source: "live",
        },
      ];

      const csv = exportCalendarToCsv(maliciousEvents);

      // Verify UTF-8 BOM
      expect(csv.charCodeAt(0)).toBe(0xfeff);

      // Verify formula cells are prepended with an apostrophe before quotes
      expect(csv).toContain("\"'=cmd|'/C calc'!A0\"");
      expect(csv).toContain("\"'@malicious Corp\"");
      expect(csv).toContain("\"'+100%\"");
      expect(csv).toContain("\"'-50%\"");
      expect(csv).toContain("\"'|system('calc')\"");
      expect(csv).toContain("\"'=1+1\"");
    });

    it("does not corrupt plain numbers or safe strings with stray apostrophes", () => {
      const safeEvents: CalendarEvent[] = [
        {
          id: "evt-safe-1",
          date: "03/20",
          fullDate: "2026-03-20",
          type: "EARNINGS",
          title: "トヨタ自動車 (7203) 本決算",
          ticker: "7203",
          companyName: "トヨタ自動車",
          importance: "HIGH",
          market: "TSE",
          previous: "250",
          forecast: "280",
          description: "安全な日本語テキスト説明文",
        },
      ];

      const csv = exportCalendarToCsv(safeEvents);

      // Safe cells should NOT have leading apostrophe
      expect(csv).toContain('"トヨタ自動車 (7203) 本決算"');
      expect(csv).toContain('"7203"');
      expect(csv).toContain('"トヨタ自動車"');
      expect(csv).toContain('"安全な日本語テキスト説明文"');
      expect(csv).not.toContain("\"'トヨタ自動車\"");
    });
  });

  describe("2. RFC 5545 Line Break & Character Escaping in escapeIcsText", () => {
    it("escapes CRLF, LF, and standalone CR into literal '\\n'", () => {
      // CRLF
      expect(escapeIcsText("Line 1\r\nLine 2")).toBe("Line 1\\nLine 2");
      // LF
      expect(escapeIcsText("Line 1\nLine 2")).toBe("Line 1\\nLine 2");
      // Standalone CR (legacy Mac / unusual client payloads)
      expect(escapeIcsText("Line 1\rLine 2")).toBe("Line 1\\nLine 2");
      // Mixed
      expect(escapeIcsText("A\rB\nC\r\nD")).toBe("A\\nB\\nC\\nD");
    });

    it("escapes semicolons, commas, and backslashes according to RFC 5545", () => {
      expect(escapeIcsText("Title; with, special\\ characters")).toBe(
        "Title\\; with\\, special\\\\ characters",
      );
    });

    it("generates iCalendar payload without raw CR or unescaped line breaks", () => {
      const eventWithMultilines: CalendarEvent[] = [
        {
          id: "evt-multiline-test",
          date: "04/01",
          fullDate: "2026-04-01",
          type: "MACRO",
          title: "日銀短観\r第1四半期",
          description: "業況判断D.I.\r\n大企業製造業: +15\n先行き: +12",
        },
      ];

      const ics = exportCalendarToIcs(eventWithMultilines);

      expect(ics).toContain("SUMMARY:日銀短観\\n第1四半期");
      expect(ics).toContain("DESCRIPTION:業況判断D.I.\\n大企業製造業: +15\\n先行き: +12");
      // There must be no standalone CR character anywhere in the entire output
      const rawCrCount = (ics.match(/\r(?!\n)/g) || []).length;
      expect(rawCrCount).toBe(0);
    });
  });

  describe("3. WAI-ARIA Accessibility Contracts for CalendarPage.tsx", () => {
    it("ensures viewMode toggle buttons implement aria-pressed states and group label", () => {
      const calendarPagePath = path.resolve(process.cwd(), "src/components/CalendarPage.tsx");
      const content = fs.readFileSync(calendarPagePath, "utf-8");

      expect(content).toContain('role="group"');
      expect(content).toContain('aria-pressed={viewMode === "LIST"}');
      expect(content).toContain('aria-pressed={viewMode === "CALENDAR"}');
    });

    it("ensures month grid event chips have descriptive aria-label attributes", () => {
      const calendarPagePath = path.resolve(process.cwd(), "src/components/CalendarPage.tsx");
      const content = fs.readFileSync(calendarPagePath, "utf-8");

      expect(content).toContain('aria-label={`${evt.title} (${evt.importance}重要度) の詳細を表示`}');
    });
  });
});
