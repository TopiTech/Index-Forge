// @vitest-environment jsdom
/**
 * Search-normalization regressions for the screener and the calendar.
 *
 * The calendar's event filter is not a standalone helper: it lives inside
 * `src/components/CalendarPage.tsx`. These tests therefore drive the real
 * component (the events are served through the production
 * `/api/market/calendar` request) and assert which events survive the filter.
 * Re-implementing the filter inside this file would keep passing even when
 * the component breaks.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { runStockScreener } from "./marketDataService";
import { CalendarPage } from "../components/CalendarPage";
import { ToastProvider } from "../components/Toast";
import { normalizeSearchQuery, getUniverseStockByTicker } from "../data/stockUniverse";
import type { CalendarEvent } from "./marketDataService";

const TOYOTA_EVENT_TITLE = "トヨタ自動車 (7203) 決算発表";
const FOMC_EVENT_TITLE = "FOMC 政策金利発表";
const SONY_EVENT_TITLE = "ソニーグループ (6758) 決算発表";

/**
 * The events the Worker would serve from `/api/market/calendar`.
 */
const CALENDAR_FIXTURE: CalendarEvent[] = [
  {
    id: "ev-1",
    date: "04/25",
    type: "EARNINGS",
    title: TOYOTA_EVENT_TITLE,
    ticker: "7203",
    companyName: "トヨタ自動車",
    importance: "HIGH",
    description: "2026年3月期 通期決算発表",
  },
  {
    id: "ev-2",
    date: "05/01",
    type: "MACRO",
    title: FOMC_EVENT_TITLE,
    importance: "HIGH",
    description: "米国連邦公開市場委員会 (FOMC) 声明公表",
  },
  {
    id: "ev-3",
    date: "05/10",
    type: "EARNINGS",
    title: SONY_EVENT_TITLE,
    ticker: "6758",
    companyName: "ソニーグループ",
    importance: "HIGH",
    description: "2026年3月期 決算発表",
  },
];

/** Faithful `Response` for the stubbed `/api/market/calendar` call. */
function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function renderCalendar() {
  render(
    createElement(
      ToastProvider,
      null,
      createElement(CalendarPage, {
        onNavigate: vi.fn(),
        onOpenStockDetail: vi.fn(),
      }),
    ),
  );
  // The page starts with the generated fallback calendar; the assertion below
  // waits until the fetched events replaced it.
  await screen.findByText(TOYOTA_EVENT_TITLE);
}

function searchEvents(query: string) {
  fireEvent.change(screen.getByLabelText("イベント・銘柄名検索"), {
    target: { value: query },
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(CALENDAR_FIXTURE)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Search Normalization Enhancements", () => {
  describe("runStockScreener query normalization", () => {
    it("matches full-width Japanese ticker numbers (７２０３ -> 7203)", () => {
      const results = runStockScreener({ searchQuery: "７２０３" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("matches Hiragana queries against Katakana company names (とよた -> トヨタ自動車)", () => {
      const results = runStockScreener({ searchQuery: "とよた" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("matches Hiragana queries against Katakana themes (もびりてぃ -> モビリティ)", () => {
      const results = runStockScreener({ searchQuery: "もびりてぃ" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("matches full-width English ticker symbols (ＡＡＰＬ -> AAPL)", () => {
      const results = runStockScreener({ searchQuery: "ＡＡＰＬ" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "AAPL")).toBe(true);
    });

    it("matches half-width Katakana queries (ﾄﾖﾀ -> トヨタ自動車)", () => {
      const results = runStockScreener({ searchQuery: "ﾄﾖﾀ" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("supports multi-token AND matching (e.g. '7203 トヨタ')", () => {
      const results = runStockScreener({ searchQuery: "7203 トヨタ" });
      expect(results.length).toBe(1);
      expect(results[0].ticker).toBe("7203");
    });

    it("supports multi-token matching across theme and name (e.g. 'モビリティ トヨタ')", () => {
      const results = runStockScreener({ searchQuery: "モビリティ トヨタ" });
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("returns empty array for non-matching queries", () => {
      const results = runStockScreener({ searchQuery: "xyznonexistent9999" });
      expect(results).toHaveLength(0);
    });
  });

  describe("search normalization primitives used by the calendar filter", () => {
    it("normalizes full-width digits and Hiragana to the indexed form", () => {
      expect(normalizeSearchQuery("７２０３")).toBe("7203");
      expect(normalizeSearchQuery("とよた")).toBe("トヨタ");
      expect(normalizeSearchQuery("ｆｏｍｃ")).toBe("fomc");
    });

    it("exposes the romanized aliases of a universe stock", () => {
      const toyota = getUniverseStockByTicker("7203");
      expect(toyota).toBeDefined();
      expect(toyota?.normAliases || "").toContain("toyota");
    });
  });

  describe("CalendarPage event search filtering logic", () => {
    it("matches calendar earnings events with full-width ticker (７２０３)", async () => {
      await renderCalendar();

      searchEvents("７２０３");

      expect(screen.queryByText(TOYOTA_EVENT_TITLE)).not.toBeNull();
      expect(screen.queryByText(FOMC_EVENT_TITLE)).toBeNull();
      expect(screen.queryByText(SONY_EVENT_TITLE)).toBeNull();
    });

    it("matches calendar earnings events with Hiragana (とよた)", async () => {
      await renderCalendar();

      searchEvents("とよた");

      expect(screen.queryByText(TOYOTA_EVENT_TITLE)).not.toBeNull();
      expect(screen.queryByText(FOMC_EVENT_TITLE)).toBeNull();
      expect(screen.queryByText(SONY_EVENT_TITLE)).toBeNull();
    });

    it("matches calendar earnings events via aliases (toyota)", async () => {
      await renderCalendar();

      searchEvents("toyota");

      expect(screen.queryByText(TOYOTA_EVENT_TITLE)).not.toBeNull();
      expect(screen.queryByText(FOMC_EVENT_TITLE)).toBeNull();
      expect(screen.queryByText(SONY_EVENT_TITLE)).toBeNull();
    });

    it("matches macro events with full-width letters (ｆｏｍｃ)", async () => {
      await renderCalendar();

      searchEvents("ｆｏｍｃ");

      expect(screen.queryByText(FOMC_EVENT_TITLE)).not.toBeNull();
      expect(screen.queryByText(TOYOTA_EVENT_TITLE)).toBeNull();
      expect(screen.queryByText(SONY_EVENT_TITLE)).toBeNull();
    });

    it("matches multi-token queries (FOMC 政策)", async () => {
      await renderCalendar();

      searchEvents("FOMC 政策");

      expect(screen.queryByText(FOMC_EVENT_TITLE)).not.toBeNull();
      expect(screen.queryByText(TOYOTA_EVENT_TITLE)).toBeNull();
      expect(screen.queryByText(SONY_EVENT_TITLE)).toBeNull();
    });

    it("matches multi-token queries combining Hiragana and keywords (とよた 決算)", async () => {
      await renderCalendar();

      searchEvents("とよた 決算");

      expect(screen.queryByText(TOYOTA_EVENT_TITLE)).not.toBeNull();
      expect(screen.queryByText(FOMC_EVENT_TITLE)).toBeNull();
      expect(screen.queryByText(SONY_EVENT_TITLE)).toBeNull();
    });
  });
});
