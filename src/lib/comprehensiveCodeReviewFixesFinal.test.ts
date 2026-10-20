import { describe, it, expect } from "vitest";
import {
  exportCalendarToIcs,
  escapeIcsText,
  type CalendarEvent,
} from "./marketDataService";
import {
  parseNumericValue,
  serializeBasketToCsv,
  serializePortfolioToCsv,
  deserializePortfolioFromCsv,
  deserializeBasketFromCsv,
} from "./indexSerialization";
import { createPortfolioPosition } from "./portfolioStorage";
import * as fs from "fs";
import * as path from "path";

/**
 * RFC 5545 §3.1 folding.
 *
 * A content line longer than 75 octets is split into continuation lines that
 * start with a single space. Unfolding removes the CRLF + space so that the
 * payload can be compared with the escaped text.
 */
function unfoldIcs(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

/** Octet length of a content line (RFC 5545 counts octets, not characters). */
function octetLength(line: string): number {
  return new TextEncoder().encode(line).length;
}

describe("Comprehensive Code Review Final: RFC 5545 iCalendar Text Escaping", () => {
  it("escapes special characters per RFC 5545 Section 3.3.11", () => {
    expect(escapeIcsText("")).toBe("");
    expect(escapeIcsText("Simple Title")).toBe("Simple Title");
    expect(escapeIcsText("CPI, PPI & Core")).toBe("CPI\\, PPI & Core");
    expect(escapeIcsText("Earnings; Q3 report")).toBe("Earnings\\; Q3 report");
    expect(escapeIcsText("Path\\To\\Folder")).toBe("Path\\\\To\\\\Folder");
    expect(escapeIcsText("Line 1\nLine 2\r\nLine 3")).toBe("Line 1\\nLine 2\\nLine 3");
    expect(escapeIcsText("A;B,C\\D\nE")).toBe("A\\;B\\,C\\\\D\\nE");
  });

  it("exports calendar events with properly escaped SUMMARY and DESCRIPTION", () => {
    const complexEvents: CalendarEvent[] = [
      {
        id: "evt-complex-01",
        date: "04/15",
        fullDate: "2026-04-15",
        type: "MACRO",
        title: "日銀政策決定会合, 展望レポート; 植田総裁記者会見",
        importance: "HIGH",
        time: "15:30 JST",
        market: "TSE",
        forecast: "0.50%",
        previous: "0.25%",
        actual: "0.50%",
        description: "第1四半期の展望レポート公表。\n金融政策の現状維持または追加利上げの検討;",
      },
    ];

    const ics = exportCalendarToIcs(complexEvents);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");

    // The Japanese SUMMARY/DESCRIPTION exceed the 75-octet limit, so the
    // export folds them. The folded payload is compared after unfolding, and
    // the folding itself is asserted below.
    const unfolded = unfoldIcs(ics);

    // Escaped commas and semicolons in SUMMARY
    expect(unfolded).toContain(
      `SUMMARY:${escapeIcsText("日銀政策決定会合, 展望レポート; 植田総裁記者会見")}`,
    );
    expect(unfolded).toContain(
      "SUMMARY:日銀政策決定会合\\, 展望レポート\\; 植田総裁記者会見",
    );

    // Escaped description with escaped newline and semicolon
    const expectedDescription =
      "【発表時刻】15:30 JST\n【重要度】HIGH\n【市場】国内東証\n【市場予想】0.50%\n【前回値】0.25%\n【発表結果】0.50%\n第1四半期の展望レポート公表。\n金融政策の現状維持または追加利上げの検討;";
    expect(unfolded).toContain(`DESCRIPTION:${escapeIcsText(expectedDescription)}`);
    expect(unfolded).toContain(
      "DESCRIPTION:【発表時刻】15:30 JST\\n【重要度】HIGH\\n【市場】国内東証\\n【市場予想】0.50%\\n【前回値】0.25%\\n【発表結果】0.50%\\n第1四半期の展望レポート公表。\\n金融政策の現状維持または追加利上げの検討\\;",
    );

    expect(ics).toContain("END:VCALENDAR");

    // RFC 5545 §3.1: no content line may exceed 75 octets, and the long
    // Japanese lines must actually be folded (a continuation line starts with
    // a single space).
    const lines = ics.split("\r\n");
    for (const line of lines) {
      expect(octetLength(line)).toBeLessThanOrEqual(75);
    }
    expect(lines.some((line) => line.startsWith(" "))).toBe(true);
  });

  it("handles events with malformed date without crashing or producing NaN", () => {
    const invalidEvents: CalendarEvent[] = [
      {
        id: "evt-invalid-date",
        date: "invalid-date",
        type: "MACRO",
        title: "壊れた日付のイベント",
        importance: "LOW",
      },
    ];

    const ics = exportCalendarToIcs(invalidEvents);
    expect(ics).not.toContain("NaN");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("Comprehensive Code Review Final: Broker CSV Parsing Resilience", () => {
  it("parses numeric values with currency symbols, thousand separators, and full-width numbers", () => {
    expect(parseNumericValue(1234.5)).toBe(1234.5);
    expect(parseNumericValue("1,000")).toBe(1000);
    expect(parseNumericValue("2,500.50")).toBe(2500.5);
    expect(parseNumericValue("¥3,200")).toBe(3200);
    expect(parseNumericValue("￥15,000")).toBe(15000);
    expect(parseNumericValue("$250.75")).toBe(250.75);
    expect(parseNumericValue("€99.99")).toBe(99.99);
    expect(parseNumericValue("£50.00")).toBe(50);
    expect(parseNumericValue("１,２３４")).toBe(1234);
    expect(parseNumericValue("  ¥ 5,000  ")).toBe(5000);
    expect(parseNumericValue("invalid")).toBeNaN();
    expect(parseNumericValue(null)).toBeNaN();
  });

  it("deserializes portfolio CSV containing broker-formatted commas and currency symbols", () => {
    const brokerCsv = [
      "コード,銘柄名,保有株数,取得単価,取得日,メモ",
      '7203,トヨタ自動車,"1,500","¥2,850.50",2025-01-15,SBI証券',
      'AAPL,Apple Inc.,"200","$185.20",2025-02-01,楽天証券',
      '6758,ソニーグループ,500,"￥12,300",2025-03-10,マネックス証券',
      '9984,ソフトバンクグループ,１００,"¥8,500",2025-04-01,全角株数',
    ].join("\r\n");

    const result = deserializePortfolioFromCsv(brokerCsv);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.length).toBe(4);

    const toyota = result.data!.find((p) => p.ticker === "7203");
    expect(toyota).toBeDefined();
    expect(toyota!.shares).toBe(1500);
    expect(toyota!.averageCost).toBe(2850.5);

    const apple = result.data!.find((p) => p.ticker === "AAPL");
    expect(apple).toBeDefined();
    expect(apple!.shares).toBe(200);
    expect(apple!.averageCost).toBe(185.2);

    const sony = result.data!.find((p) => p.ticker === "6758");
    expect(sony).toBeDefined();
    expect(sony!.shares).toBe(500);
    expect(sony!.averageCost).toBe(12300);

    const sbg = result.data!.find((p) => p.ticker === "9984");
    expect(sbg).toBeDefined();
    expect(sbg!.shares).toBe(100);
    expect(sbg!.averageCost).toBe(8500);
  });

  it("deserializes basket CSV with thousand commas and formatted weights", () => {
    const basketCsv = [
      "コード,銘柄名,テーマ,ウェイト",
      '7203,トヨタ自動車,自動車,"1,000"',
      '6758,ソニーグループ,テクノロジー,500',
    ].join("\n");

    const result = deserializeBasketFromCsv(basketCsv);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.length).toBe(2);
    expect(result.data![0].weight).toBe(1000);
    expect(result.data![1].weight).toBe(500);
  });
});

describe("Comprehensive Code Review Final: CSV Round Trip Against the Production Writer", () => {
  it("writes the portfolio header in the current production format", () => {
    const csv = serializePortfolioToCsv([
      createPortfolioPosition({
        ticker: "7203",
        name: "トヨタ自動車",
        shares: 100,
        averageCost: 2500,
      }),
    ]);

    expect(csv.split("\r\n")[0]).toBe("コード,銘柄名,保有株数,取得単価,取得日,メモ");
  });

  it("round-trips a portfolio through the production serializer and parser", () => {
    const positions = [
      createPortfolioPosition({
        ticker: "7203",
        name: "トヨタ自動車",
        shares: 1500,
        averageCost: 2850.5,
        acquiredAt: "2025-01-15",
        notes: "SBI証券",
      }),
      createPortfolioPosition({
        ticker: "AAPL",
        name: "Apple Inc.",
        shares: 200,
        averageCost: 185.2,
        acquiredAt: "2025-02-01",
        notes: "楽天証券",
      }),
    ];

    const csv = serializePortfolioToCsv(positions);
    const result = deserializePortfolioFromCsv(csv);

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!).toHaveLength(2);

    // The parsed values must match the written ones - not only the tickers.
    const toyota = result.data!.find((p) => p.ticker === "7203");
    expect(toyota).toBeDefined();
    expect(toyota!.name).toBe("トヨタ自動車");
    expect(toyota!.shares).toBe(1500);
    expect(toyota!.averageCost).toBe(2850.5);
    expect(toyota!.acquiredAt).toBe("2025-01-15");
    expect(toyota!.notes).toBe("SBI証券");

    const apple = result.data!.find((p) => p.ticker === "AAPL");
    expect(apple).toBeDefined();
    expect(apple!.name).toBe("Apple Inc.");
    expect(apple!.shares).toBe(200);
    expect(apple!.averageCost).toBe(185.2);
    expect(apple!.acquiredAt).toBe("2025-02-01");
    expect(apple!.notes).toBe("楽天証券");
  });

  it("writes the basket header in the current production format", () => {
    const csv = serializeBasketToCsv([
      { ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 60 },
    ]);

    expect(csv.split("\r\n")[0]).toBe("コード,銘柄名,テーマ,比率(%)");
  });

  it("round-trips a basket through the production serializer and parser", () => {
    const basket = [
      { ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 60 },
      { ticker: "6758", name: "ソニーグループ", theme: "エンタメ", weight: 40 },
    ];

    const csv = serializeBasketToCsv(basket);
    const result = deserializeBasketFromCsv(csv);

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!).toHaveLength(2);

    const toyota = result.data!.find((b) => b.ticker === "7203");
    expect(toyota).toBeDefined();
    expect(toyota!.name).toBe("トヨタ自動車");
    expect(toyota!.theme).toBe("自動車");
    expect(toyota!.weight).toBe(60);

    const sony = result.data!.find((b) => b.ticker === "6758");
    expect(sony).toBeDefined();
    expect(sony!.name).toBe("ソニーグループ");
    expect(sony!.theme).toBe("エンタメ");
    expect(sony!.weight).toBe(40);
  });
});

describe("Comprehensive Code Review Final: CalendarPage Accessibility & UI Integrity", () => {
  it("ensures CalendarPage list item has accessible controls and event propagation containment", () => {
    const calendarPagePath = path.resolve(__dirname, "../components/CalendarPage.tsx");
    const content = fs.readFileSync(calendarPagePath, "utf-8");

    // Container role & tabIndex for keyboard navigation
    expect(content).toContain('role={ticker ? "button" : undefined}');
    expect(content).toContain("tabIndex={ticker ? 0 : undefined}");

    // Detail button should have explicit aria-label and stopPropagation to isolate click/keypress
    expect(content).toContain('aria-label={`${evt.title}のイベント詳細を表示`}');
    expect(content).toContain("e.stopPropagation()");
  });

  it("ensures ScreenerPage batch index creation button does not have redundant star character", () => {
    const screenerPagePath = path.resolve(__dirname, "../components/ScreenerPage.tsx");
    const content = fs.readFileSync(screenerPagePath, "utf-8");

    expect(content).not.toContain("★");
    expect(content).toContain("<Sparkles size={14} />");
  });
});
