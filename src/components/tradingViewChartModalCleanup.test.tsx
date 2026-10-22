// @vitest-environment jsdom
/**
 * Behavioral contract for `TradingViewChartModal` resource ownership.
 *
 * The modal schedules a widget load timeout, an animation timeout, and two
 * resize-notification timers. All of them must be cancelled on unmount; a
 * timer that survives dispatches a global `resize` event after the chart is
 * gone, which is exactly what this test observes instead of grepping for
 * `clearTimeout`.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradingViewChartModal } from "./TradingViewChartModal";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const SYMBOL = { proName: "TSE:7203", title: "トヨタ自動車" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TradingViewChartModal resource cleanup", () => {
  it("cancels the widget load timeout on unmount", () => {
    const { unmount } = render(<TradingViewChartModal symbol={SYMBOL} onClose={() => {}} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the post-load resize notification when closed before it fires", () => {
    const { baseElement, unmount } = render(
      <TradingViewChartModal symbol={SYMBOL} onClose={() => {}} />,
    );

    const script = baseElement.querySelector("script");
    expect(script).not.toBeNull();

    act(() => {
      script?.onload?.(new Event("load"));
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending drag animation frame on unmount", () => {
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
    const { getByLabelText, unmount } = render(
      <TradingViewChartModal symbol={SYMBOL} onClose={() => {}} />,
    );

    const grip = getByLabelText("枠のサイズを調整 (方向キーでも調整できます)");
    fireEvent.pointerDown(grip, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 60, clientY: 40 });
    expect(cancelSpy).not.toHaveBeenCalled();

    unmount();

    expect(cancelSpy).toHaveBeenCalled();
  });

  it("does not dispatch a resize after the modal is unmounted mid-animation", () => {
    const { getByLabelText, unmount } = render(
      <TradingViewChartModal symbol={SYMBOL} onClose={() => {}} />,
    );

    fireEvent.click(getByLabelText("画面に合わせて最大化"));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    const resizeListener = vi.fn();
    window.addEventListener("resize", resizeListener);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(resizeListener).not.toHaveBeenCalled();
    window.removeEventListener("resize", resizeListener);
  });

  it("mounts safely and falls back to default responsive dimensions when localStorage throws SecurityError", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Access to Storage is denied for this document", "SecurityError");
      },
    });

    expect(() => {
      const { unmount } = render(
        <TradingViewChartModal symbol={SYMBOL} onClose={() => {}} />,
      );
      unmount();
    }).not.toThrow();
  });

  it("updates dimensions and classes dynamically on window resize when maximized", () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1200 });
    Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 800 });

    const { getByLabelText, getByRole, unmount } = render(
      <TradingViewChartModal symbol={SYMBOL} onClose={() => {}} />,
    );

    // Click maximize
    fireEvent.click(getByLabelText("画面に合わせて最大化"));
    const dialog = getByRole("dialog");
    expect(dialog.classList.contains("is-maximized")).toBe(true);

    // Simulate resizing window to 1600x1000
    act(() => {
      window.innerWidth = 1600;
      window.innerHeight = 1000;
      window.dispatchEvent(new Event("resize"));
    });

    expect(dialog.classList.contains("is-maximized")).toBe(true);

    // Un-maximize should restore bounded size within new viewport limits
    fireEvent.click(getByLabelText("元のサイズに戻す"));
    expect(dialog.classList.contains("is-maximized")).toBe(false);
    expect(dialog.style.width).toBeTruthy();
    expect(dialog.style.height).toBeTruthy();

    unmount();
  });
});
