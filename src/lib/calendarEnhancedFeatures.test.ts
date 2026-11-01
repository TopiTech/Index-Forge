import { describe, it, expect } from "vitest";
import {
  exportCalendarToIcs,
  exportCalendarToCsv,
  generateUpcomingEvents,
  type CalendarEvent,
} from "./marketDataService";
import { getEventDayOfWeek } from "../components/CalendarPage";
import { parseCsv } from "./csv";

const LEGACY_CALENDAR_HEADERS = [
  "日付",
  "完全日付",
  "種別",
  "イベント名",
  "ティッカー",
  "企業名",
  "重要度",
  "発表時刻",
  "市場",
  "前回値",
  "市場予想",
  "発表結果",
  "出所",
  "詳細",
] as const;

/** A consumer that only knows the historical 14 columns and reads by header. */
function parseLegacyCsvConsumer(csv: string): Record<string, string> {
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  const header = rows[0] ?? [];
  const values = rows[1] ?? [];
  const legacy = new Set<string>(LEGACY_CALENDAR_HEADERS);
  const result: Record<string, string> = {};
  for (let index = 0; index < header.length; index += 1) {
    const key = header[index];
    if (key && legacy.has(key)) result[key] = values[index] ?? "";
  }
  return result;
}

/** A strict consumer that only understands the pre-G-7 DESCRIPTION fields. */
function parseLegacyIcsDescription(ics: string): Record<string, string> {
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  const line = unfolded.split("\r\n").find((entry) => entry.startsWith("DESCRIPTION:"));
  if (!line) return {};
  const text = line.slice("DESCRIPTION:".length).replace(/\\n/g, "\n");
  const known = new Set(["発表時刻", "重要度", "市場", "市場予想", "前回値", "発表結果"]);
  const result: Record<string, string> = {};
  for (const part of text.split("\n")) {
    const match = /^【(.+?)】(.*)$/.exec(part);
    if (match && known.has(match[1])) result[match[1]] = match[2];
  }
  return result;
}

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

    it("exports the revised previous value without replacing the original (G-7)", () => {
      const revised = { ...sampleEvents[0], revisedPrevious: "4.75%", revision: 2 };
      const ics = exportCalendarToIcs([revised]).replace(/\r\n[ \t]/g, "");
      expect(ics).toContain("【前回値】4.50%");
      expect(ics).toContain("【改定後前回値】4.75%（2回改定）");
    });

    it("leaves a strict legacy ICS consumer's known fields identical (G-7)", () => {
      const base = parseLegacyIcsDescription(exportCalendarToIcs([sampleEvents[0]]));
      const revised = parseLegacyIcsDescription(
        exportCalendarToIcs([{ ...sampleEvents[0], revisedPrevious: "4.75%", revision: 2 }]),
      );

      expect(revised).toEqual(base);
      expect(revised).not.toHaveProperty("改定後前回値");
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

      // Check CSV Header row. The revision columns are appended so the
      // historical 14-column positions stay stable for existing consumers.
      expect(csv).toContain(
        "日付,完全日付,種別,イベント名,ティッカー,企業名,重要度,発表時刻,市場,前回値,市場予想,発表結果,出所,詳細,改定後前回値,改定回数",
      );

      // Check Event content rows
      expect(csv).toContain('"03/18","2026-03-18","経済指標","米FOMC 政策金利発表 & 記者会見"');
      expect(csv).toContain('"03/25","2026-03-25","企業決算","トヨタ自動車 (7203) 決算発表","7203","トヨタ自動車"');
      expect(csv).toContain('"米国"');
      expect(csv).toContain('"国内東証"');
    });

    it("appends the revised previous value and revision count without moving old columns (G-7)", () => {
      const revised = { ...sampleEvents[0], revisedPrevious: "4.75%", revision: 2 };
      const csv = exportCalendarToCsv([revised]);
      expect(csv).toContain('"4.50%"');
      expect(csv).toContain('"4.75%","2"');
      expect(csv.split("\r\n")[0].endsWith(",改定後前回値,改定回数")).toBe(true);

      const noRevision = exportCalendarToCsv([sampleEvents[0]]);
      expect(noRevision.split("\r\n")[1].endsWith('"",""')).toBe(true);
    });

    it("keeps a legacy 14-column CSV consumer's values identical (G-7)", () => {
      const csv = exportCalendarToCsv([sampleEvents[0]]);
      const rows = parseCsv(csv.replace(/^\uFEFF/, ""));

      expect(rows[0]).toHaveLength(16);
      expect(rows[0].slice(0, 14)).toEqual([...LEGACY_CALENDAR_HEADERS]);
      expect(parseLegacyCsvConsumer(csv)).toEqual({
        日付: "03/18",
        完全日付: "2026-03-18",
        種別: "経済指標",
        イベント名: "米FOMC 政策金利発表 & 記者会見",
        ティッカー: "",
        企業名: "",
        重要度: "HIGH",
        発表時刻: "03:00 JST",
        市場: "米国",
        前回値: "4.50%",
        市場予想: "4.25%",
        発表結果: "4.25%",
        出所: "実データ",
        詳細: "FRBによるフェデラルファンド金利誘導目標発表。",
      });
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
