import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import providerFixtures from "./__fixtures__/macroCalendarProvider.json";
import {
  formatMacroCalendarValue,
  parseMacroCalendarApiItem,
  type MacroCalendarApiItem,
} from "../../worker/macroCalendarProvider";
import {
  fetchLiveMacroEventsFromApiAsync,
  resetLastKnownCalendarEvents,
} from "../../worker/internal";
import { sanitizeCalendarEvent } from "./marketDataService";

/**
 * Direct contract tests for the extracted provider module.
 *
 * These fixtures are deliberately data, not endpoint mocks: the provider's
 * wire shape (including revised previous values and every unit/multiplier
 * combination) is pinned here, so a regression cannot hide behind a mock that
 * happens to omit the fields the mapping forgot.
 */

const REF_DATE = new Date("2026-10-30T12:00:00Z");

function baseItem(overrides: Partial<MacroCalendarApiItem> = {}): MacroCalendarApiItem {
  return {
    time: "2026-10-02T12:30:00Z",
    countryCode: "US",
    name: "Nonfarm Payrolls",
    unit: "job",
    multiplier: "thousands",
    digits: 0,
    actual: null,
    forecast: null,
    previous: null,
    revisedPrevious: null,
    revision: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetLastKnownCalendarEvents();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("macro calendar provider module", () => {
  it("formats every unit/multiplier variant from the pinned fixtures", () => {
    for (const fixture of providerFixtures.formatCases) {
      const item = baseItem({
        unit: fixture.unit,
        multiplier: fixture.multiplier,
        digits: fixture.digits,
      });
      expect(formatMacroCalendarValue(fixture.value, item), fixture.label).toBe(fixture.expected);
    }
  });

  it("parses revised previous and revision without inventing values", () => {
    for (const fixture of providerFixtures.parserCases) {
      const parsed = parseMacroCalendarApiItem({
        time: "2026-10-02T12:30:00Z",
        countryCode: "US",
        name: "Nonfarm Payrolls",
        unit: "job",
        multiplier: "thousands",
        digits: 0,
        actual: 29,
        forecast: 52,
        previous: 162,
        ...fixture.input,
      });

      expect(parsed, fixture.label).not.toBeNull();
      if (!parsed) throw new Error(`${fixture.label}: provider 行を parse できませんでした`);
      expect(parsed.revisedPrevious, fixture.label).toBe(fixture.expectedRevisedPrevious);
      expect(parsed.revision, fixture.label).toBe(fixture.expectedRevision);
    }
  });

  it("carries revised previous and revision through the live mapping", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(providerFixtures.endpointRows), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const events = await fetchLiveMacroEventsFromApiAsync(REF_DATE);

    const jobs = events.find((event) => event.title.includes("雇用統計"));
    expect(jobs).toBeDefined();
    // Backward-compatible contract: `previous` remains the unrevised value.
    expect(jobs?.previous).toBe("16.2万人");
    expect(jobs?.revisedPrevious).toBe("13.3万人");
    expect(jobs?.revision).toBe(1);

    const cpi = events.find((event) => event.title.includes("消費者物価指数"));
    expect(cpi).toBeDefined();
    expect(cpi?.previous).toBe("3.4%");
    expect(cpi?.revisedPrevious).toBe("3.3%");
    expect(cpi?.revision).toBe(0);
  });

  it("normalizes revised fields at the API boundary", () => {
    const base = {
      id: "evt-revised",
      date: "10/20",
      title: "改定値イベント",
      type: "MACRO",
      importance: "HIGH",
      previous: "16.2万人",
      forecast: "5.2万人",
    };

    const valid = sanitizeCalendarEvent({
      ...base,
      revisedPrevious: "13.3万人",
      revision: 1,
    });
    expect(valid?.revisedPrevious).toBe("13.3万人");
    expect(valid?.revision).toBe(1);

    const invalid = sanitizeCalendarEvent({
      ...base,
      revisedPrevious: 133,
      revision: -1,
    });
    expect(invalid?.revisedPrevious).toBeUndefined();
    expect(invalid?.revision).toBeUndefined();

    const fractional = sanitizeCalendarEvent({
      ...base,
      revisedPrevious: "13.3万人",
      revision: 1.5,
    });
    expect(fractional?.revisedPrevious).toBe("13.3万人");
    expect(fractional?.revision).toBeUndefined();

    const empty = sanitizeCalendarEvent({
      ...base,
      revisedPrevious: "   ",
      revision: 0,
    });
    expect(empty?.revisedPrevious).toBeUndefined();
    // G-6: a count without the revised value it describes is meaningless.
    expect(empty?.revision).toBeUndefined();
  });
});
