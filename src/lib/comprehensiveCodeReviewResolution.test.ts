import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  deserializeBasketFromCsv,
  deserializePortfolioFromCsv,
  serializeBasketToCsv,
  serializePortfolioToCsv,
} from "./indexSerialization";
import { exportCalendarToIcs, type CalendarEvent } from "./marketDataService";
import { formatChartDisplayDate } from "../components/StockTechnicalChart";

describe("Comprehensive Code Review Remediation Tests", () => {
  describe("1. CSV Deserialization Column Mapping & Collision Prevention", () => {
    it("correctly handles Basket CSV with only 'コード' and '比率' columns without overwriting name with weight", () => {
      const csv = "コード,比率\n7203,35\n6758,65";
      const res = deserializeBasketFromCsv(csv);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.data).toHaveLength(2);
      expect(res.data[0].ticker).toBe("7203");
      // Before fix: name was assigned fields[1] which was "35". Now it falls back to ticker "7203".
      expect(res.data[0].name).toBe("7203");
      expect(res.data[0].weight).toBe(35);
      expect(res.data[0].theme).toBe("カスタム");

      expect(res.data[1].ticker).toBe("6758");
      expect(res.data[1].name).toBe("6758");
      expect(res.data[1].weight).toBe(65);
    });

    it("correctly handles Basket CSV with custom reordered columns", () => {
      const csv = "比率,銘柄名,コード,テーマ\n25,トヨタ自動車,7203,自動車\n75,ソニーグループ,6758,電機";
      const res = deserializeBasketFromCsv(csv);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.data[0]).toEqual({
        ticker: "7203",
        name: "トヨタ自動車",
        theme: "自動車",
        weight: 25,
      });
      expect(res.data[1]).toEqual({
        ticker: "6758",
        name: "ソニーグループ",
        theme: "電機",
        weight: 75,
      });
    });

    it("maintains positional fallback for Basket CSV when no recognised headers match", () => {
      const csv = "COL_A,COL_B,COL_C,COL_D\n7203,トヨタ自動車,自動車,50";
      const res = deserializeBasketFromCsv(csv);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.data[0]).toEqual({
        ticker: "7203",
        name: "トヨタ自動車",
        theme: "自動車",
        weight: 50,
      });
    });

    it("correctly handles Portfolio CSV with partial headers without column collisions", () => {
      // In partial header without '銘柄名', 'nameIdx' must not collide with 'sharesIdx' (column 1)
      const csv = "コード,保有株数,取得単価\n7203,200,2850\n9984,100,8500";
      const res = deserializePortfolioFromCsv(csv);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.data).toHaveLength(2);
      expect(res.data[0].ticker).toBe("7203");
      // Before fix: name was populated with "200" because nameIdx defaulted to 1.
      expect(res.data[0].name).toBe("7203");
      expect(res.data[0].shares).toBe(200);
      expect(res.data[0].averageCost).toBe(2850);
      expect(res.data[0].acquiredAt).toBeUndefined();
      expect(res.data[0].notes).toBeUndefined();

      expect(res.data[1].ticker).toBe("9984");
      expect(res.data[1].name).toBe("9984");
      expect(res.data[1].shares).toBe(100);
      expect(res.data[1].averageCost).toBe(8500);
    });

    it("correctly handles Portfolio CSV with reordered headers", () => {
      const csv = "取得単価,保有株数,コード,銘柄名,メモ\n3100,500,7203,トヨタ,長期保有分";
      const res = deserializePortfolioFromCsv(csv);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.data[0].ticker).toBe("7203");
      expect(res.data[0].name).toBe("トヨタ");
      expect(res.data[0].shares).toBe(500);
      expect(res.data[0].averageCost).toBe(3100);
      expect(res.data[0].notes).toBe("長期保有分");
    });

    it("preserves standard export-import roundtrip for both basket and portfolio", () => {
      const basket = [
        { ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 40 },
        { ticker: "6758", name: "ソニーグループ", theme: "電機", weight: 60 },
      ];
      const exportedBasket = serializeBasketToCsv(basket);
      const reimportedBasket = deserializeBasketFromCsv(exportedBasket);
      expect(reimportedBasket.ok).toBe(true);
      if (reimportedBasket.ok) {
        expect(reimportedBasket.data).toEqual(basket);
      }

      const portfolio = [
        {
          id: "pos-1",
          ticker: "7203",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2500,
          acquiredAt: "2026-01-10",
          notes: "NISA成長投資枠",
        },
      ];
      const exportedPort = serializePortfolioToCsv(portfolio);
      const reimportedPort = deserializePortfolioFromCsv(exportedPort);
      expect(reimportedPort.ok).toBe(true);
      if (reimportedPort.ok) {
        expect(reimportedPort.data[0].ticker).toBe("7203");
        expect(reimportedPort.data[0].name).toBe("トヨタ自動車");
        expect(reimportedPort.data[0].shares).toBe(100);
        expect(reimportedPort.data[0].averageCost).toBe(2500);
        expect(reimportedPort.data[0].acquiredAt).toBe("2026-01-10");
        expect(reimportedPort.data[0].notes).toBe("NISA成長投資枠");
      }
    });
  });

  describe("2. Calendar ICS Export Year Rollover", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("respects fullDate when provided", () => {
      const events: CalendarEvent[] = [
        {
          id: "evt-1",
          date: "01/15",
          fullDate: "2027-01-15",
          type: "EARNINGS",
          title: "テスト決算",
          importance: "HIGH",
        },
      ];
      const ics = exportCalendarToIcs(events);
      expect(ics).toContain("DTSTART;VALUE=DATE:20270115");
      expect(ics).toContain("DTEND;VALUE=DATE:20270116");
    });

    it("applies year rollover (+1 year) when exporting in December for January events without fullDate", () => {
      // Mock system date to December 28, 2026
      vi.setSystemTime(new Date(2026, 11, 28, 12, 0, 0));

      const events: CalendarEvent[] = [
        {
          id: "evt-jan",
          date: "01/10",
          type: "MACRO",
          title: "米雇用統計",
          importance: "HIGH",
        },
      ];

      const ics = exportCalendarToIcs(events);
      // Event in January (m=1) when current month is December (m=12) should be 2027, not 2026
      expect(ics).toContain("DTSTART;VALUE=DATE:20270110");
      expect(ics).toContain("DTEND;VALUE=DATE:20270111");
    });

    it("applies year rollover (-1 year) when exporting in January for December events without fullDate", () => {
      // Mock system date to January 5, 2027
      vi.setSystemTime(new Date(2027, 0, 5, 12, 0, 0));

      const events: CalendarEvent[] = [
        {
          id: "evt-dec",
          date: "12/28",
          type: "MACRO",
          title: "前年末FOMC議事録",
          importance: "MEDIUM",
        },
      ];

      const ics = exportCalendarToIcs(events);
      // Event in December (m=12) when current month is January (m=1) should be 2026
      expect(ics).toContain("DTSTART;VALUE=DATE:20261228");
      expect(ics).toContain("DTEND;VALUE=DATE:20261229");
    });
  });

  describe("3. Timezone-Resilient Date Parsing in Charting", () => {
    it("extracts month and day without timezone shift from ISO date string", () => {
      // Production helper (`src/components/StockTechnicalChart.tsx`): the chart
      // renders the API series on its axis, so the assertions run against the
      // very function the chart uses instead of a copy of it.
      expect(formatChartDisplayDate("2026-10-14")).toBe("10/14");
      expect(formatChartDisplayDate("2026-01-01")).toBe("1/1");
      expect(formatChartDisplayDate("2026/12/31")).toBe("12/31");
    });

    it("keeps the calendar day of an ISO timestamp instead of shifting it over the UTC boundary", () => {
      // A UTC timestamp must not become the previous day in a negative UTC
      // offset: the month and the day are read from the string itself.
      expect(formatChartDisplayDate("2026-10-14T00:00:00Z")).toBe("10/14");
      expect(formatChartDisplayDate("2026-10-14T23:59:59Z")).toBe("10/14");
    });

    it("keeps the raw value when the series date cannot be parsed", () => {
      expect(formatChartDisplayDate("")).toBe("");
      expect(formatChartDisplayDate("2026-xx-yy")).toBe("2026-xx-yy");
    });
  });

  describe("4. Accessible Scrollable Table Regions (WCAG 2.1)", () => {
    it("ensures ConstituentsTable has keyboard-accessible table wrapper region", () => {
      const content = fs.readFileSync(path.resolve(__dirname, "../components/ConstituentsTable.tsx"), "utf-8");
      expect(content).toContain('className="table-wrapper desktop-constituents-table" tabIndex={0} role="region" aria-label="構成銘柄一覧テーブル"');
    });

    it("ensures ScreenerPage has keyboard-accessible table container", () => {
      const content = fs.readFileSync(path.resolve(__dirname, "../components/ScreenerPage.tsx"), "utf-8");
      expect(content).toContain('<div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="銘柄スクリーナー結果テーブル">');
    });

    it("ensures CalendarPage month container is keyboard scrollable", () => {
      const content = fs.readFileSync(path.resolve(__dirname, "../components/CalendarPage.tsx"), "utf-8");
      expect(content).toContain('<div className="calendar-month-container" tabIndex={0} role="region" aria-label="月間カレンダーグリッド">');
    });

    it("ensures AdminDashboard tables are keyboard accessible regions", () => {
      const content = fs.readFileSync(path.resolve(__dirname, "../components/AdminDashboard.tsx"), "utf-8");
      expect(content).toContain('className="table-wrapper" tabIndex={0} role="region" aria-label="発行済みパスワード一覧テーブル"');
      expect(content).toContain('className="table-wrapper" style={{ maxHeight: 340, overflowY: "auto" }} tabIndex={0} role="region" aria-label="構成銘柄編集テーブル"');
    });

    it("ensures SimulationPreview contribution table is keyboard accessible", () => {
      const content = fs.readFileSync(path.resolve(__dirname, "../components/SimulationPreview.tsx"), "utf-8");
      expect(content).toContain("tabIndex={0}");
      expect(content).toContain('role="region"');
      expect(content).toContain('aria-label="構成銘柄パフォーマンス寄与度テーブル"');
    });
  });
});
