// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FreshnessProvider } from "../contexts/FreshnessContext";
import { CalendarPage, metricTone, normalizeMetricText } from "./CalendarPage";
import { ToastProvider } from "./Toast";
import { TradingViewChartModal } from "./TradingViewChartModal";
import { TradingViewTickerTape } from "./TradingViewTickerTape";
import { jstDateString } from "../lib/marketCache";
import { fetchUpcomingEvents, type CalendarEvent } from "../lib/marketDataService";

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return { ...actual, fetchUpcomingEvents: vi.fn() };
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const SYMBOL = { proName: "TSE:7203", title: "トヨタ自動車" };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BUG-04: TradingViewChartModal resets resize state when closed mid-drag", () => {
  it("clears .is-resizing class and drag tracking when symbol becomes null before pointerup", () => {
    const { rerender } = render(
      <TradingViewChartModal symbol={SYMBOL} onClose={() => {}} />,
    );

    const grip = screen.getByLabelText("枠のサイズを調整 (方向キーでも調整できます)");
    fireEvent.pointerDown(grip, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(screen.getByRole("dialog").classList.contains("is-resizing")).toBe(true);

    // Close modal without firing pointerup (e.g., Escape key)
    rerender(<TradingViewChartModal symbol={null} onClose={() => {}} />);

    // Reopen modal: resize state must be cleanly reset
    rerender(<TradingViewChartModal symbol={SYMBOL} onClose={() => {}} />);
    expect(screen.getByRole("dialog").classList.contains("is-resizing")).toBe(false);
  });
});

describe("BUG-08: CalendarPage unified metric tone parsing and flexible fullDate matching", () => {
  it("normalizes -0.0pt and strips units consistently in metricTone", () => {
    expect(normalizeMetricText("-0.0pt")).toBe("0.0pt");
    expect(metricTone("-0.0pt")).toBe("neutral");
    expect(metricTone("-0.0%")).toBe("neutral");
    expect(metricTone("--")).toBe("neutral");
    expect(metricTone("N/A")).toBe("neutral");
    expect(metricTone("+2.5pt")).toBe("positive");
    expect(metricTone("-1.2倍")).toBe("negative");
  });

  it("renders positive/negative/neutral color consistently in detail modal and matches unpadded/slash fullDate in calendar grid", async () => {
    const [yStr, mStr] = jstDateString(new Date()).split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const unpaddedSlashDate = `${y}/${m}/5`;
    const sampleEvent: CalendarEvent = {
      id: "unpadded-evt",
      date: `${m}/5`,
      fullDate: unpaddedSlashDate,
      type: "MACRO",
      title: "ゼロ埋めなしカレンダーイベント",
      importance: "HIGH",
      time: "09:00 JST",
      market: "TSE",
      previous: "0.0pt",
      forecast: "1.0pt",
      actual: "-0.0pt",
    };
    vi.mocked(fetchUpcomingEvents).mockResolvedValue([sampleEvent]);

    render(
      <ToastProvider>
        <FreshnessProvider>
          <CalendarPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
        </FreshnessProvider>
      </ToastProvider>,
    );

    const detailBtn = await screen.findByRole("button", {
      name: "ゼロ埋めなしカレンダーイベントのイベント詳細を表示",
    });
    fireEvent.click(detailBtn);

    // Detail modal shows actual value "-0.0pt" with neutral text color, never red/green
    const actualNode = await screen.findByText("-0.0pt", { selector: "div" });
    expect((actualNode as HTMLElement).style.color).toBe("var(--text-primary)");

    // Close modal and switch to CALENDAR grid view
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "月間表示" }));

    // The unpadded/slash fullDate must match the 5th day cell in the grid
    expect(await screen.findByText(/ゼロ埋めなしカレンダーイベント/)).toBeTruthy();
  });
});

describe("BUG-05: TradingViewTickerTape functional hover cleanup", () => {
  it("preserves current hovered item when mouseLeave fires for a different item and clears when current item leaves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ updatedAt: "2026-01-01T00:00:00.000Z", quotes: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const { container } = render(<TradingViewTickerTape />);
    const items = Array.from(container.querySelectorAll<HTMLElement>(".tv-ticker-item"));
    expect(items.length).toBeGreaterThanOrEqual(2);

    const first = items[0];
    const second = items[1];

    fireEvent.mouseEnter(first);
    expect(first.classList.contains("is-hovered")).toBe(true);

    fireEvent.mouseEnter(second);
    expect(second.classList.contains("is-hovered")).toBe(true);

    // Leaving the first item must not clear the second item's hover state
    fireEvent.mouseLeave(first);
    expect(second.classList.contains("is-hovered")).toBe(true);

    fireEvent.mouseLeave(second);
    expect(second.classList.contains("is-hovered")).toBe(false);
  });
});
