/**
 * Regression test for the Japan CPI calendar event (round-2 ledger, TEST-03 →
 * R35).
 *
 * Every other macro event of `generateUpcomingEvents` reads its
 * previous/forecast/description from the shared `MACRO_METRICS_DEFAULTS`.
 * The `macro-jp-cpi` event used to duplicate the literals instead, and its
 * duplicated description already differed in wording from the master copy, so
 * the calendar and the macro schedule could drift apart.
 *
 * The event must therefore read the shared default. The equality assertions
 * pin the values, and the second test proves that the event really reads
 * *through* the shared object: a re-duplication with literals would keep the
 * old values when the shared default changes.
 */
import { describe, expect, it } from "vitest";
import { MACRO_METRICS_DEFAULTS } from "../data/macroSchedule";
import { generateUpcomingEvents } from "./marketDataService";

const REFERENCE_DATE = new Date(2026, 0, 10);

describe("macro-jp-cpi calendar event (R35)", () => {
  it("uses the shared JP CPI defaults for previous, forecast and description", () => {
    const events = generateUpcomingEvents(REFERENCE_DATE);
    const jpCpi = events.find((event) => event.id === "macro-jp-cpi");

    expect(jpCpi).toBeDefined();
    expect(jpCpi?.previous).toBe(MACRO_METRICS_DEFAULTS.jpCpi.previous);
    expect(jpCpi?.forecast).toBe(MACRO_METRICS_DEFAULTS.jpCpi.forecast);
    expect(jpCpi?.description).toBe(MACRO_METRICS_DEFAULTS.jpCpi.description);
  });

  it("follows the shared default instead of a duplicated literal", () => {
    const original = { ...MACRO_METRICS_DEFAULTS.jpCpi };
    try {
      MACRO_METRICS_DEFAULTS.jpCpi.previous = "9.9%";
      MACRO_METRICS_DEFAULTS.jpCpi.forecast = "9.8%";
      MACRO_METRICS_DEFAULTS.jpCpi.description = "共有デフォルトのテスト用文言";

      const events = generateUpcomingEvents(REFERENCE_DATE);
      const jpCpi = events.find((event) => event.id === "macro-jp-cpi");

      expect(jpCpi?.previous).toBe("9.9%");
      expect(jpCpi?.forecast).toBe("9.8%");
      expect(jpCpi?.description).toBe("共有デフォルトのテスト用文言");
    } finally {
      Object.assign(MACRO_METRICS_DEFAULTS.jpCpi, original);
    }

    // The shared default is restored for the other suites.
    const restored = generateUpcomingEvents(REFERENCE_DATE).find(
      (event) => event.id === "macro-jp-cpi",
    );
    expect(restored?.previous).toBe(MACRO_METRICS_DEFAULTS.jpCpi.previous);
  });
});
