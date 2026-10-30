import { describe, it, expect } from "vitest";
import {
  evaluateTechnicalSignal,
  formatCalendarFieldValueWithProvenance,
  exportCalendarToCsv,
  exportCalendarToIcs,
  type CalendarEvent,
} from "./marketDataService";

describe("evaluateTechnicalSignal Robustness & Edge Cases", () => {
  it("returns NEUTRAL when changePct is NaN or non-finite instead of false-positive STRONG_SELL", () => {
    const nanResult = evaluateTechnicalSignal(Number.NaN);
    expect(nanResult.signal).toBe("NEUTRAL");
    expect(nanResult.reason).toContain("データ不足または中立");

    const posInfResult = evaluateTechnicalSignal(Number.POSITIVE_INFINITY);
    expect(posInfResult.signal).toBe("NEUTRAL");
    expect(posInfResult.reason).toContain("データ不足または中立");

    const negInfResult = evaluateTechnicalSignal(Number.NEGATIVE_INFINITY);
    expect(negInfResult.signal).toBe("NEUTRAL");
    expect(negInfResult.reason).toContain("データ不足または中立");

    // Even if sparkline and price are provided, non-finite changePct must return NEUTRAL
    const withSparkline = evaluateTechnicalSignal(Number.NaN, [100, 102, 105], 110);
    expect(withSparkline.signal).toBe("NEUTRAL");
  });

  it("filters non-finite values from sparkline before computing moving averages", () => {
    // Array with NaN but 3 valid numbers [100, 105, 110]
    // shortSMA = (100 + 105 + 110)/3 = 105, fullSMA = 105, price = 115 > shortSMA, changePct = 1.0 > 0.5
    const corruptedSparkline = [100, Number.NaN, 105, Number.POSITIVE_INFINITY, 110];
    const result = evaluateTechnicalSignal(1.0, corruptedSparkline, 115);
    // price (115) > shortSMA (105) and changePct (1.0) >= 0
    expect(result.signal).toBe("BUY");
  });

  it("falls back to momentum when sparkline has fewer than 3 finite values", () => {
    const insufficientSparkline = [100, Number.NaN];
    const result = evaluateTechnicalSignal(2.5, insufficientSparkline, 110);
    expect(result.signal).toBe("STRONG_BUY");
    expect(result.reason).toContain("急反発モメンタム (+2%以上)");
  });

  it("correctly evaluates standard momentum tiers when sparkline is absent", () => {
    expect(evaluateTechnicalSignal(2.5).signal).toBe("STRONG_BUY");
    expect(evaluateTechnicalSignal(0.8).signal).toBe("BUY");
    expect(evaluateTechnicalSignal(0.0).signal).toBe("NEUTRAL");
    expect(evaluateTechnicalSignal(-0.5).signal).toBe("NEUTRAL");
    expect(evaluateTechnicalSignal(-1.5).signal).toBe("SELL");
    expect(evaluateTechnicalSignal(-2.5).signal).toBe("STRONG_SELL");
  });

  it("evaluates golden cross and dead cross correctly with valid sparkline and price", () => {
    const bullishSparkline = [100, 102, 104, 106, 110, 115];
    const strongBuy = evaluateTechnicalSignal(1.2, bullishSparkline, 120);
    expect(strongBuy.signal).toBe("STRONG_BUY");
    expect(strongBuy.reason).toContain("ゴールデンクロス");

    const bearishSparkline = [120, 115, 110, 106, 104, 100];
    const strongSell = evaluateTechnicalSignal(-1.2, bearishSparkline, 95);
    expect(strongSell.signal).toBe("STRONG_SELL");
    expect(strongSell.reason).toContain("デッドクロス");
  });
});

describe("formatCalendarFieldValueWithProvenance", () => {
  it("formats value with provenance suffix", () => {
    expect(formatCalendarFieldValueWithProvenance("4.50%", "reference")).toBe("4.50% (参考値)");
    expect(formatCalendarFieldValueWithProvenance("4.75%", "estimated")).toBe("4.75% (推計)");
    expect(formatCalendarFieldValueWithProvenance("4.50%", undefined)).toBe("4.50%");
    expect(formatCalendarFieldValueWithProvenance("", "reference")).toBe("");
    expect(formatCalendarFieldValueWithProvenance(undefined, "reference")).toBe("");
  });

  it("prevents duplicate suffix when value already contains reference or estimate indicator", () => {
    expect(formatCalendarFieldValueWithProvenance("4.50% (参考値)", "reference")).toBe("4.50% (参考値)");
    expect(formatCalendarFieldValueWithProvenance("4.50% (参考推計: 3ヶ月物利回りベース)", "reference")).toBe(
      "4.50% (参考推計: 3ヶ月物利回りベース)",
    );
    expect(formatCalendarFieldValueWithProvenance("100億円 (推計)", "estimated")).toBe("100億円 (推計)");
  });
});

describe("exportCalendarToCsv with Field Provenance", () => {
  it("includes provenance in CSV cells for fields marked as reference or estimated", () => {
    const events: CalendarEvent[] = [
      {
        id: "evt-prov-1",
        date: "04/01",
        fullDate: "2026-04-01",
        type: "MACRO",
        title: "日銀短観",
        importance: "HIGH",
        previous: "+12",
        forecast: "+15",
        actual: "14",
        source: "official",
        fieldProvenance: {
          previous: "reference",
          forecast: "estimated",
        },
      },
    ];

    const csv = exportCalendarToCsv(events);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    // Cells starting with '+' are escaped with a leading apostrophe to prevent CSV formula injection
    expect(csv).toContain('"\' +12 (参考値)"'.replace(" ", ""));
    expect(csv).toContain('"\' +15 (推計)"'.replace(" ", ""));
    expect(csv).toContain('"14"'); // actual has no provenance and no formula trigger
    expect(csv).toContain('"実データ"'); // source is official
  });
});

describe("exportCalendarToIcs Robustness & Date Validation", () => {
  it("rejects invalid dates that would roll over into the next month", () => {
    const invalidEvents: CalendarEvent[] = [
      {
        id: "evt-invalid-date-1",
        date: "02/30",
        fullDate: "2026-02-30", // February 30 does not exist
        type: "MACRO",
        title: "無効日付イベント1",
        importance: "LOW",
      },
      {
        id: "evt-invalid-date-2",
        date: "13/45", // Month 13, Day 45
        type: "MACRO",
        title: "無効日付イベント2",
        importance: "LOW",
      },
    ];

    const ics = exportCalendarToIcs(invalidEvents);
    expect(ics).not.toContain("無効日付イベント1");
    expect(ics).not.toContain("無効日付イベント2");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("includes provenance in iCalendar description when present", () => {
    const event: CalendarEvent = {
      id: "evt-prov-ics",
      date: "05/10",
      fullDate: "2026-05-10",
      type: "MACRO",
      title: "消費者物価指数",
      importance: "HIGH",
      previous: "2.8%",
      forecast: "2.6%",
      fieldProvenance: {
        forecast: "estimated",
      },
    };

    const ics = exportCalendarToIcs([event]);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260510");
    expect(ics).toContain("DTEND;VALUE=DATE:20260511");
    // Unfold RFC 5545 lines before checking multi-line descriptions
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("【前回値】2.8%");
    expect(unfolded).toContain("【市場予想】2.6% (推計)");
  });
});
