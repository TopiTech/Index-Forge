// @vitest-environment jsdom
/**
 * Behavioral replacement for the `<Bar …>` / `not.toContain("dynamicVol")`
 * source pins in `src/lib/stockChartVolumeFix.test.ts` (S6, U-1).
 *
 * The volume pane (hidden YAxis + bars + the "出来高" legend entry) must
 * exist exactly when the API supplied real volumes, and a close-only window
 * must render the line chart with no volume artifacts and no invented data.
 * These drive the real component instead of asserting source text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StockTechnicalChart } from "./StockTechnicalChart";
import { createStockQuote } from "../test-helpers/quote";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function stubCalculate(series: Array<{ date: string; close: number; volume?: number }>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/sync-prices")) return Promise.resolve(jsonResponse({ ok: true }));
      if (url.includes("/api/calculate")) {
        return Promise.resolve(jsonResponse({ stockUniverse: [{ ticker: "7203", series }] }));
      }
      return Promise.resolve(jsonResponse({}));
    }),
  );
}

function closeOnlySeries() {
  return [
    { date: "2026-09-28", close: 2800 },
    { date: "2026-09-29", close: 2820 },
    { date: "2026-09-30", close: 2810 },
    { date: "2026-10-01", close: 2850 },
    { date: "2026-10-02", close: 2860 },
  ];
}

function volumeSeries() {
  return closeOnlySeries().map((point, i) => ({ ...point, volume: 10_000_000 + i * 500_000 }));
}

async function waitForChartReady(): Promise<void> {
  await waitFor(() => expect(document.querySelector(".recharts-wrapper")).not.toBeNull());
  await waitFor(() => expect(document.querySelector(".spin.animate-spin")).toBeNull());
}

// recharts' ResponsiveContainer sizes itself from a ResizeObserver callback,
// which the shared jsdom stub never fires (size stays 0 and no SVG renders).
// Reporting a fixed content box makes the chart paint synchronously.
class ResizeObserverWithSize {
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(): void {
    this.callback(
      [{ contentRect: { width: 800, height: 400 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverWithSize);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StockTechnicalChart volume pane gating (behavioral, U-1)", () => {
  it("renders volume bars and the legend entry when the API supplied real volumes", async () => {
    stubCalculate(volumeSeries());
    render(<StockTechnicalChart stock={createStockQuote()} theme="dark" />);
    await waitForChartReady();

    expect(
      document.querySelectorAll(".recharts-bar-rectangle").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("出来高")).not.toBeNull();
  });

  it("renders the line chart with no volume artifacts for a close-only window", async () => {
    stubCalculate(closeOnlySeries());
    render(<StockTechnicalChart stock={createStockQuote()} theme="dark" />);
    await waitForChartReady();

    // No bars, no volume legend entry, no synthetic badge: a missing volume
    // leaves the pane out instead of inventing one (S1).
    expect(document.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(0);
    expect(screen.queryByText("出来高")).toBeNull();
    expect(screen.queryByText("参考値（デモ）")).toBeNull();
  });
});
