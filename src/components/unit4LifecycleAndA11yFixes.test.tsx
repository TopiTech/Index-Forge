// @vitest-environment jsdom
/**
 * Behavioral regression tests for Unit 4A lifecycle, focus, timer, and chart fixes.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditPasswordModal } from "./EditPasswordModal";
import { ThemeControls } from "./ThemeControls";
import { TradingViewChartModal } from "./TradingViewChartModal";
import { TradingViewTickerTape, TICKER_SYMBOLS } from "./TradingViewTickerTape";
import { DataFreshness } from "./DataFreshness";
import { StockTechnicalChart, formatTechnicalAxisPrice } from "./StockTechnicalChart";
import { createStockQuote } from "../test-helpers/quote";

const { FakeScene } = vi.hoisted(() => {
  class FakeScene {
    static instances: FakeScene[] = [];
    isAutoRotatePaused = false;
    destroyCalls: Array<boolean | undefined> = [];
    constructor(_options: { canvas: HTMLCanvasElement; width: number; height: number }) {
      FakeScene.instances.push(this);
    }
    setStep() {}
    setReducedMotion() {}
    resize() {}
    rotateCamera() {}
    zoomCamera() {}
    resetCamera() {}
    toggleAutoRotate() {
      return false;
    }
    destroy(forceContextLoss?: boolean) {
      this.destroyCalls.push(forceContextLoss);
    }
  }
  return { FakeScene };
});

vi.mock("./Tutorial3DScene", () => ({
  Tutorial3DScene: FakeScene,
  isWebGLAvailable: () => true,
}));

vi.mock("./Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { Tutorial3DCanvas } from "./Tutorial3DCanvas";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  FakeScene.instances.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Unit 4A Lifecycle, Focus, and Resource Ownership Fixes", () => {
  it("does not lock body scroll when EditPasswordModal is isOpen=true but item=null", () => {
    document.body.style.overflow = "";
    const { container, rerender, unmount } = render(
      <EditPasswordModal
        isOpen={true}
        item={null}
        onClose={() => {}}
        onSuccess={() => {}}
        getHeaders={() => ({})}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(document.body.style.overflow).toBe("");

    rerender(
      <EditPasswordModal
        isOpen={true}
        item={{
          id: "pw-1",
          name: "tester",
          role: "user",
          max_stocks: 10,
          max_indices: 5,
          is_active: 1,
          created_at: 1700000000,
        }}
        onClose={() => {}}
        onSuccess={() => {}}
        getHeaders={() => ({})}
      />,
    );
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes ThemeControls popover on outside click without stealing focus, while Escape restores toggle focus", () => {
    render(
      <div>
        <ThemeControls />
        <input aria-label="外部検索入力" />
      </div>,
    );

    const accentToggle = screen.getByRole("button", { name: /テーマカラー選択/ });
    const outsideInput = screen.getByLabelText("外部検索入力");

    fireEvent.click(accentToggle);
    expect(accentToggle.getAttribute("aria-expanded")).toBe("true");

    // Outside click: focus moves to the external input and is NOT pulled back to the toggle.
    outsideInput.focus();
    fireEvent.mouseDown(outsideInput);
    expect(accentToggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(outsideInput);

    // Escape key: closes popover AND returns focus to the trigger button.
    fireEvent.click(accentToggle);
    expect(accentToggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(accentToggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(accentToggle);
  });

  it("attaches ResizeObserver cleanly when TradingViewChartModal transitions from symbol=null to open", () => {
    const observeCalls: Element[] = [];
    class SpyResizeObserver {
      observe(target: Element) {
        observeCalls.push(target);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", SpyResizeObserver);

    const { rerender } = render(<TradingViewChartModal symbol={null} onClose={() => {}} />);
    expect(observeCalls).toHaveLength(0);

    rerender(
      <TradingViewChartModal
        symbol={{ proName: "TSE:7203", title: "トヨタ自動車" }}
        onClose={() => {}}
      />,
    );

    expect(observeCalls).toHaveLength(1);
    expect(observeCalls[0].getAttribute("role")).toBe("dialog");
  });

  it("cancels pending hover timer when TradingViewTickerTape item is clicked directly", () => {
    vi.useFakeTimers();
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ quotes: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    render(<TradingViewTickerTape />);
    const firstItem = screen.getAllByRole("button", {
      name: new RegExp(TICKER_SYMBOLS[0].title),
    })[0];

    fireEvent.mouseEnter(firstItem);
    fireEvent.click(firstItem);
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Closing immediately must not have the superseded hover timer re-open the modal.
    fireEvent.click(screen.getByLabelText("チャートを閉じる"));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores out-of-range numeric timestamps in DataFreshness instead of throwing RangeError", () => {
    render(
      <DataFreshness
        benchmarkUpdatedAt={1e20}
        calculationUpdatedAt={Infinity}
        updatedAt="999999999-01-01"
        customStatusText="データ待機中"
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("データ待機中");
  });

  it("formats technical chart axis prices for stocks, zero, and FX pairs accurately", () => {
    expect(formatTechnicalAxisPrice(Number.NaN, "7203", "PRIME")).toBe("--");
    expect(formatTechnicalAxisPrice(2850, "7203", "PRIME")).toBe("¥2,850");
    expect(formatTechnicalAxisPrice(182.5, "AAPL", "US")).toBe("$182.50");
    expect(formatTechnicalAxisPrice(1.0845, "EURUSD=X", null)).toBe("$1.0845");
    expect(formatTechnicalAxisPrice(155.25, "USDJPY=X", null)).toBe("¥155.25");
    expect(formatTechnicalAxisPrice(0, "7203", "PRIME")).toBe("¥0");
    expect(formatTechnicalAxisPrice(0, "AAPL", "US")).toBe("$0.00");
  });

  it("resets TradingView fallback/error state when StockTechnicalChart stock.ticker changes", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, stockUniverse: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const aapl = createStockQuote({ ticker: "AAPL", name: "Apple", market: "US", price: 220 });
    const msft = createStockQuote({ ticker: "MSFT", name: "Microsoft", market: "US", price: 420 });

    const { rerender, container } = render(<StockTechnicalChart stock={aapl} theme="dark" />);

    expect(
      container.querySelector('script[src*="embed-widget-advanced-chart.js"]'),
    ).not.toBeNull();

    // Simulate runtime symbol error from TradingView frame for AAPL.
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://s.tradingview.com",
          data: JSON.stringify({ name: "tv-widget-symbol-error" }),
        }),
      );
    });

    await waitFor(() => {
      expect(
        container.querySelector('script[src*="embed-widget-advanced-chart.js"]'),
      ).toBeNull();
    });

    // Switching to another supported US ticker must reset error/fallback state and retry TradingView.
    rerender(<StockTechnicalChart stock={msft} theme="dark" />);
    await waitFor(() => {
      const nextScript = container.querySelector('script[src*="embed-widget-advanced-chart.js"]');
      expect(nextScript).not.toBeNull();
      expect(nextScript?.textContent).toContain("MSFT");
    });
  });

  it("calls destroy(false) during webglcontextlost and destroy() on unmount in Tutorial3DCanvas", () => {
    const { container, unmount } = render(
      <Tutorial3DCanvas currentStep={1} isReducedMotion={false} isAutoRotatePaused={false} />,
    );

    const firstScene = FakeScene.instances[0];
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();

    act(() => {
      canvas?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    expect(firstScene.destroyCalls).toEqual([false]);

    act(() => {
      canvas?.dispatchEvent(new Event("webglcontextrestored"));
    });
    const restoredScene = FakeScene.instances[1];
    expect(restoredScene).toBeDefined();

    unmount();
    expect(restoredScene.destroyCalls).toEqual([undefined]);
  });
});
