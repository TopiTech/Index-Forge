// @vitest-environment jsdom
/**
 * N-10 UI contract: when the provider revises its previous reading, the
 * calendar shows both the original "前回" value and the revised value. The
 * original stays in place for backward compatibility; the revision is
 * additional information, not a replacement.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { CalendarPage } from "./CalendarPage";
import { FreshnessProvider } from "../contexts/FreshnessContext";
import { fetchUpcomingEvents, type CalendarEvent } from "../lib/marketDataService";

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return { ...actual, fetchUpcomingEvents: vi.fn() };
});

vi.mock("./Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

const fetchEvents = vi.mocked(fetchUpcomingEvents);

function revisedMacroEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "macro-revised",
    date: "10/02",
    fullDate: "2026-10-02",
    type: "MACRO",
    title: "改定値検証マクロ指標",
    importance: "HIGH",
    time: "21:30 JST",
    market: "US",
    previous: "16.2万人",
    revisedPrevious: "13.3万人",
    revision: 1,
    forecast: "5.2万人",
    actual: "2.9万人",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <FreshnessProvider>
      <CalendarPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
    </FreshnessProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CalendarPage revised previous display (N-10)", () => {
  it("shows the original previous value and the revised value with its revision count", async () => {
    fetchEvents.mockResolvedValue([revisedMacroEvent()]);

    renderPage();

    await screen.findByText("改定値検証マクロ指標");
    expect(screen.getByText("改定後 13.3万人（1回改定）")).toBeTruthy();
    // The original value remains the canonical 前回 display.
    expect(screen.getByText("16.2万人")).toBeTruthy();
  });

  it("shows the revised value without a count when the provider reports revision zero", async () => {
    fetchEvents.mockResolvedValue([revisedMacroEvent({ revision: 0 })]);

    renderPage();

    await screen.findByText("改定値検証マクロ指標");
    expect(screen.getByText("改定後 13.3万人")).toBeTruthy();
    expect(screen.queryByText(/0回改定/)).toBeNull();
  });

  it("shows the revised value in the detail modal", async () => {
    fetchEvents.mockResolvedValue([revisedMacroEvent()]);

    renderPage();

    const detailButton = await screen.findByRole("button", {
      name: "改定値検証マクロ指標のイベント詳細を表示",
    });
    detailButton.click();

    const dialog = await screen.findByRole("dialog", { name: "イベント詳細" });
    const previousRow = within(dialog).getByText("前回値").parentElement;
    if (!previousRow) throw new Error("前回値の親要素が見つかりません");
    expect(within(previousRow).getByText("16.2万人")).toBeTruthy();
    expect(within(previousRow).getByText("改定後 13.3万人（1回改定）")).toBeTruthy();
  });
});
