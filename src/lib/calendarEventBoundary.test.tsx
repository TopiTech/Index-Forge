// @vitest-environment jsdom
/**
 * G-1 / G-6: the calendar-event boundary must own the whole shape.
 *
 * The previous sanitizer spread an untrusted record into a typed CalendarEvent,
 * so `previous: {}` or `time: {}` reached React and threw
 * "Objects are not valid as a React child". These tests exercise both the pure
 * boundary and the real CalendarPage render path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CalendarPage } from "../components/CalendarPage";
import { FreshnessProvider } from "../contexts/FreshnessContext";
import {
  fetchUpcomingEvents,
  sanitizeCalendarEvent,
  type CalendarEvent,
} from "./marketDataService";

vi.mock("./marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./marketDataService")>();
  return { ...actual, fetchUpcomingEvents: vi.fn() };
});

vi.mock("../components/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

const fetchEvents = vi.mocked(fetchUpcomingEvents);

const BASE = {
  id: "evt-boundary",
  date: "10/02",
  title: "境界テストイベント",
  type: "MACRO" as const,
  importance: "HIGH" as const,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <FreshnessProvider>
      <CalendarPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
    </FreshnessProvider>,
  );
}

describe("sanitizeCalendarEvent boundary (G-1)", () => {
  it("drops every hostile optional field instead of copying it", () => {
    const sanitized = sanitizeCalendarEvent({
      ...BASE,
      fullDate: { nested: [] },
      ticker: { evil: true },
      companyName: ["array"],
      marketCap: "not-a-number",
      consensus: { evil: true },
      actual: { nested: { deep: [] } },
      previous: ["array"],
      forecast: 123,
      revisedPrevious: { nested: true },
      revision: 1,
      time: {},
      market: "INVALID",
      surprise: "INVALID",
      description: [],
      source: {},
    });

    expect(sanitized).toEqual(BASE);
    expect(Object.keys(sanitized ?? {}).sort()).toEqual(["date", "id", "importance", "title", "type"]);
  });

  it("preserves every valid optional field", () => {
    const valid: CalendarEvent = {
      ...BASE,
      fullDate: "2026-10-02",
      ticker: "7203",
      companyName: "トヨタ自動車",
      marketCap: 38_000_000_000_000,
      consensus: "5.2万人",
      actual: "2.9万人",
      previous: "16.2万人",
      revisedPrevious: "13.3万人",
      revision: 1,
      forecast: "5.2万人",
      time: "21:30 JST",
      market: "US",
      surprise: "BEAT",
      description: "雇用統計の解説",
      source: "official",
      fieldProvenance: { previous: "estimated", forecast: "reference" },
    };

    expect(sanitizeCalendarEvent(valid)).toEqual(valid);
  });

  it("requires revisedPrevious for a revision count (G-6)", () => {
    const countOnly = sanitizeCalendarEvent({ ...BASE, revision: 1 });
    expect(countOnly).not.toBeNull();
    expect(countOnly).not.toHaveProperty("revision");

    const paired = sanitizeCalendarEvent({
      ...BASE,
      revisedPrevious: "13.3万人",
      revision: 1,
    });
    expect(paired?.revisedPrevious).toBe("13.3万人");
    expect(paired?.revision).toBe(1);

    const invalidCount = sanitizeCalendarEvent({
      ...BASE,
      revisedPrevious: "13.3万人",
      revision: -1,
    });
    expect(invalidCount?.revisedPrevious).toBe("13.3万人");
    expect(invalidCount).not.toHaveProperty("revision");
  });

  it("rejects missing or hostile required fields instead of rendering blank rows", () => {
    expect(sanitizeCalendarEvent({ ...BASE, id: {} })).toBeNull();
    expect(sanitizeCalendarEvent({ ...BASE, date: [] })).toBeNull();
    expect(sanitizeCalendarEvent({ ...BASE, title: "   " })).toBeNull();
    expect(sanitizeCalendarEvent(null)).toBeNull();
    expect(sanitizeCalendarEvent([])).toBeNull();
  });
});

describe("CalendarPage hostile-input rendering (G-1)", () => {
  it("renders an event whose optional fields are objects/arrays without throwing", async () => {
    const sanitized = sanitizeCalendarEvent({
      ...BASE,
      title: "敵対的シェイプのイベント",
      previous: { nested: { deep: [] } },
      forecast: ["array"],
      actual: 42,
      time: {},
      fullDate: {},
      ticker: { evil: true },
      companyName: [],
      description: {},
    });
    if (!sanitized) throw new Error("hostile event was rejected instead of sanitized");
    fetchEvents.mockResolvedValue([sanitized]);

    renderPage();

    await screen.findByText("敵対的シェイプのイベント");
    expect(screen.queryByText(/前回:/)).toBeNull();
    expect(screen.queryByText(/結果:/)).toBeNull();
  });

  it("keeps a valid previous value while dropping an adjacent hostile actual value", async () => {
    const sanitized = sanitizeCalendarEvent({
      ...BASE,
      title: "混在シェイプのイベント",
      previous: "16.2万人",
      actual: { nested: { deep: [] } },
    });
    if (!sanitized) throw new Error("mixed-shape event was rejected instead of sanitized");
    fetchEvents.mockResolvedValue([sanitized]);

    renderPage();

    await screen.findByText("混在シェイプのイベント");
    expect(screen.getByText("16.2万人")).toBeTruthy();
    expect(screen.queryByText(/結果:/)).toBeNull();
  });
});
