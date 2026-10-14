import { describe, it, expect } from "vitest";
import {
  exportCalendarToIcs,
  exportCalendarToCsv,
  generateUpcomingEvents,
  type CalendarEvent,
} from "./marketDataService";
import { getEventDayOfWeek } from "../components/CalendarPage";

describe("Calendar Enhanced Features", () => {
  const sampleEvents: CalendarEvent[] = [
    {
      id: "evt-fomc-test",
      date: "03/18",
      fullDate: "2026-03-18",
      time: "03:00 JST",
      market: "US",
      type: "MACRO",
      title: "米FOMC 政策金利発表 & 記者会見",
      importance: "HIGH",
      previous: "4.50%",
      forecast: "4.25%",
      actual: "4.25%",
      description: "FRBによるフェデラルファンド金利誘導目標発表。",
      source: "live",
    },
    {
      id: "evt-7203-earn",
      date: "03/25",
      fullDate: "2026-03-25",
      time: "15:00 JST",
      market: "TSE",
      type: "EARNINGS",
      title: "トヨタ自動車 (7203) 決算発表",
      ticker: "7203",
      companyName: "トヨタ自動車",
      importance: "HIGH",
      previous: "1株利益 250円",
      forecast: "1株利益 280円",
      description: "通期決算および次期連結業績見通し発表。",
      source: "fallback",
    },
  ];

  describe("iCalendar (RFC 5545, .ics) Export", () => {
    it("generates valid RFC 5545 format with mandatory headers and event blocks", () => {
      const ics = exportCalendarToIcs(sampleEvents);

      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("VERSION:2.0");
      expect(ics).toContain("PRODID:-//IndexForge//Financial Calendar//JA");
      expect(ics).toContain("END:VCALENDAR");

      // Verify VEVENT blocks
      expect(ics).toContain("BEGIN:VEVENT");
      expect(ics).toContain("END:VEVENT");
      expect(ics).toContain("UID:evt-fomc-test-20260318@indexforge.internal");
      expect(ics).toContain("DTSTART;VALUE=DATE:20260318");
      expect(ics).toContain("DTEND;VALUE=DATE:20260319");
      expect(ics).toContain("SUMMARY:米FOMC 政策金利発表 & 記者会見");
      expect(ics).toContain("【市場予想】4.25%");
      expect(ics).toContain("【発表時刻】03:00 JST");
    });

    it("handles events with date string fallback (MM/DD)", () => {
      const eventsWithoutFullDate: CalendarEvent[] = [
        {
          id: "evt-no-full",
          date: "10/15",
          type: "MACRO",
          title: "テスト指標",
          importance: "MEDIUM",
        },
      ];
      const ics = exportCalendarToIcs(eventsWithoutFullDate);
      expect(ics).toContain("BEGIN:VEVENT");
      expect(ics).toContain("SUMMARY:テスト指標");
      expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{4}1015/);
    });
  });

  describe("CSV Export (Excel-Compatible UTF-8 BOM)", () => {
    it("exports all event properties with BOM and correctly escaped cells", () => {
      const csv = exportCalendarToCsv(sampleEvents);

      // Check UTF-8 BOM
      expect(csv.charCodeAt(0)).toBe(0xfeff);

      // Check CSV Header row
      expect(csv).toContain("日付,完全日付,種別,イベント名,ティッカー,企業名,重要度,発表時刻,市場,前回値,市場予想,発表結果,出所,詳細");

      // Check Event content rows
      expect(csv).toContain('"03/18","2026-03-18","経済指標","米FOMC 政策金利発表 & 記者会見"');
      expect(csv).toContain('"03/25","2026-03-25","企業決算","トヨタ自動車 (7203) 決算発表","7203","トヨタ自動車"');
      expect(csv).toContain('"米国"');
      expect(csv).toContain('"国内東証"');
    });
  });

  describe("generateUpcomingEvents enrichment", () => {
    it("includes time, market, description, and newly added Japan macro events", () => {
      const events = generateUpcomingEvents();
      expect(events.length).toBeGreaterThan(6);

      // Japan CPI
      const jpCpi = events.find((e) => e.id === "macro-jp-cpi");
      expect(jpCpi).toBeDefined();
      expect(jpCpi?.title).toContain("全国CPI");
      expect(jpCpi?.time).toBe("08:30 JST");
      expect(jpCpi?.market).toBe("TSE");
      expect(jpCpi?.description).toBeDefined();

      // Japan GDP
      const jpGdp = events.find((e) => e.id === "macro-jp-gdp");
      expect(jpGdp).toBeDefined();
      expect(jpGdp?.title).toContain("実質GDP");
      expect(jpGdp?.time).toBe("08:50 JST");
      expect(jpGdp?.market).toBe("TSE");

      // Earnings events include time and market
      const earnings = events.filter((e) => e.type === "EARNINGS");
      expect(earnings.length).toBeGreaterThan(0);
      for (const e of earnings) {
        expect(e.time).toBeDefined();
        expect(e.market).toBeDefined();
      }
    });
  });

  describe("getEventDayOfWeek edge cases", () => {
    it("returns correct day of week for fullDate and MM/DD format", () => {
      // 2026-03-18 is Wednesday (水)
      expect(getEventDayOfWeek("03/18", "2026-03-18")).toBe("水");
      // 2026-03-20 is Friday (金)
      expect(getEventDayOfWeek("03/20", "2026-03-20")).toBe("金");
      // Invalid input gracefully returns empty string
      expect(getEventDayOfWeek("invalid", "invalid")).toBe("");
      expect(getEventDayOfWeek("")).toBe("");
    });
  });

  describe("Empty event exports", () => {
    it("handles empty event lists gracefully", () => {
      const emptyIcs = exportCalendarToIcs([]);
      expect(emptyIcs).toContain("BEGIN:VCALENDAR");
      expect(emptyIcs).toContain("END:VCALENDAR");
      expect(emptyIcs).not.toContain("BEGIN:VEVENT");

      const emptyCsv = exportCalendarToCsv([]);
      expect(emptyCsv.charCodeAt(0)).toBe(0xfeff);
      expect(emptyCsv).toContain("日付,完全日付,種別,イベント名");
    });
  });
});
