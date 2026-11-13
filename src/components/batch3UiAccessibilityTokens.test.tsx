// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StockAnalysisPage } from "./StockAnalysisPage";
import {
  PerformanceChart,
  getSystemPrefersReducedMotion,
  type ChartPoint,
} from "./PerformanceChart";

// Mock recharts Line and Area to capture props passed during render
const capturedLineProps: Array<Record<string, unknown>> = [];
const capturedAreaProps: Array<Record<string, unknown>> = [];

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    ComposedChart: ({ children }: { children: React.ReactNode }) => {
      React.Children.forEach(children, (child) => {
        if (React.isValidElement(child) && child.props) {
          const props = child.props as Record<string, unknown>;
          if (props.name === "nikkei" || props.dataKey === "nikkei") {
            capturedLineProps.push(props);
          }
          if (props.name === "value" || props.dataKey === "value") {
            capturedAreaProps.push(props);
          }
        }
      });
      return <div data-testid="composed-chart" />;
    },
  };
});

describe("Batch 3: UI-04 & UI-08 - VisualViewport Tracking & prefers-reduced-motion", () => {
  beforeEach(() => {
    capturedLineProps.length = 0;
    capturedAreaProps.length = 0;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("UI-04: StockAnalysisPage visualViewport tracking", () => {
    it("attaches resize and scroll listeners to window and window.visualViewport when search dropdown opens", () => {
      const vvListeners: Record<string, ((e: Event) => void)[]> = {};
      const mockVisualViewport = {
        addEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
          vvListeners[event] = vvListeners[event] || [];
          vvListeners[event].push(handler);
        }),
        removeEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
          if (vvListeners[event]) {
            vvListeners[event] = vvListeners[event].filter((h) => h !== handler);
          }
        }),
      };

      vi.stubGlobal("visualViewport", mockVisualViewport);

      const windowAddSpy = vi.spyOn(window, "addEventListener");
      const windowRemoveSpy = vi.spyOn(window, "removeEventListener");

      const { unmount } = render(
        <StockAnalysisPage
          onNavigate={vi.fn()}
          onOpenStockDetail={vi.fn()}
        />,
      );

      const searchInput = screen.getByPlaceholderText(/銘柄コード/);

      // Open the dropdown by typing into search
      act(() => {
        fireEvent.change(searchInput, { target: { value: "7203" } });
      });

      // Window resize and scroll must be registered
      expect(windowAddSpy).toHaveBeenCalledWith("resize", expect.any(Function));
      expect(windowAddSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);

      // visualViewport resize and scroll must be registered
      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));

      // Trigger visualViewport resize to exercise callback
      expect(vvListeners.resize?.length).toBeGreaterThan(0);
      act(() => {
        vvListeners.resize?.[0]?.(new Event("resize"));
      });

      // Unmounting cleans up all registered listeners
      unmount();

      expect(windowRemoveSpy).toHaveBeenCalledWith("resize", expect.any(Function));
      expect(windowRemoveSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);
      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    });

    it("operates gracefully when window.visualViewport is undefined", () => {
      vi.stubGlobal("visualViewport", undefined);

      const { unmount } = render(
        <StockAnalysisPage
          onNavigate={vi.fn()}
          onOpenStockDetail={vi.fn()}
        />,
      );

      const searchInput = screen.getByPlaceholderText(/銘柄コード/);

      expect(() => {
        act(() => {
          fireEvent.change(searchInput, { target: { value: "トヨタ" } });
        });
      }).not.toThrow();

      expect(() => {
        unmount();
      }).not.toThrow();
    });
  });

  describe("UI-08: PerformanceChart prefers-reduced-motion support", () => {
    it("getSystemPrefersReducedMotion returns false when window or matchMedia is undefined", () => {
      const origMatchMedia = window.matchMedia;
      try {
        delete (window as unknown as { matchMedia?: unknown }).matchMedia;
        expect(getSystemPrefersReducedMotion()).toBe(false);
      } finally {
        window.matchMedia = origMatchMedia;
      }
    });

    it("getSystemPrefersReducedMotion returns true when prefers-reduced-motion matches", () => {
      vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })));

      expect(getSystemPrefersReducedMotion()).toBe(true);
    });

    it("getSystemPrefersReducedMotion returns false when prefers-reduced-motion does not match", () => {
      vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })));

      expect(getSystemPrefersReducedMotion()).toBe(false);
    });

    it("disables animation on Line and Area components when prefers-reduced-motion matches", () => {
      vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })));

      const sampleData: ChartPoint[] = [
        { date: "2026-01-01", value: 1000, nikkei: 38000 },
        { date: "2026-01-02", value: 1050, nikkei: 38500 },
      ];

      render(
        <PerformanceChart
          data={sampleData}
          loading={false}
          syncing={false}
          syncProgress={100}
          timeframe="1M"
          onTimeframeChange={vi.fn()}
        />,
      );

      // Verify captured recharts Line and Area props
      const nikkeiLine = capturedLineProps.find((p) => p.name === "nikkei");
      expect(nikkeiLine).toBeDefined();
      expect(nikkeiLine?.isAnimationActive).toBe(false);

      const customArea = capturedAreaProps.find((p) => p.name === "value");
      expect(customArea).toBeDefined();
      expect(customArea?.isAnimationActive).toBe(false);
    });

    it("enables animation on Line and Area when neither reload nor reduced-motion is active", () => {
      vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })));

      const sampleData: ChartPoint[] = [
        { date: "2026-01-01", value: 1000, nikkei: 38000 },
        { date: "2026-01-02", value: 1050, nikkei: 38500 },
      ];

      render(
        <PerformanceChart
          data={sampleData}
          loading={false}
          syncing={false}
          syncProgress={100}
          timeframe="1M"
          onTimeframeChange={vi.fn()}
          isReloadSuppressed={false}
        />,
      );

      const nikkeiLine = capturedLineProps.find((p) => p.name === "nikkei");
      expect(nikkeiLine).toBeDefined();
      expect(nikkeiLine?.isAnimationActive).toBe(true);

      const customArea = capturedAreaProps.find((p) => p.name === "value");
      expect(customArea).toBeDefined();
      expect(customArea?.isAnimationActive).toBe(true);
    });

    it("disables animation on Line and Area when isReloadSuppressed is true even without reduced-motion", () => {
      vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })));

      const sampleData: ChartPoint[] = [
        { date: "2026-01-01", value: 1000, nikkei: 38000 },
        { date: "2026-01-02", value: 1050, nikkei: 38500 },
      ];

      render(
        <PerformanceChart
          data={sampleData}
          loading={false}
          syncing={false}
          syncProgress={100}
          timeframe="1M"
          onTimeframeChange={vi.fn()}
          isReloadSuppressed={true}
        />,
      );

      const nikkeiLine = capturedLineProps.find((p) => p.name === "nikkei");
      expect(nikkeiLine?.isAnimationActive).toBe(false);

      const customArea = capturedAreaProps.find((p) => p.name === "value");
      expect(customArea?.isAnimationActive).toBe(false);
    });

    it("dynamically responds to prefers-reduced-motion media query change events and cleans up listener", () => {
      let changeHandler: ((e: MediaQueryListEvent) => void) | null = null;
      const removeEventListenerMock = vi.fn();

      // A real MediaQueryList reflects the new value before it dispatches the
      // change event, and the shared subscription reads `matches` from the
      // list (not from the event payload), so the mock has to do the same.
      const mediaQueryList = {
        matches: false,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((_type: string, handler: (e: MediaQueryListEvent) => void) => {
          changeHandler = handler;
        }),
        removeEventListener: removeEventListenerMock,
        dispatchEvent: vi.fn(),
      };

      vi.stubGlobal("matchMedia", vi.fn((query: string) => {
        mediaQueryList.media = query;
        return mediaQueryList;
      }));

      const sampleData: ChartPoint[] = [
        { date: "2026-01-01", value: 1000, nikkei: 38000 },
        { date: "2026-01-02", value: 1050, nikkei: 38500 },
      ];

      const { unmount } = render(
        <PerformanceChart
          data={sampleData}
          loading={false}
          syncing={false}
          syncProgress={100}
          timeframe="1M"
          onTimeframeChange={vi.fn()}
        />,
      );

      expect(changeHandler).not.toBeNull();

      // Initially animation is active
      const initialNikkei = capturedLineProps.find((p) => p.name === "nikkei");
      expect(initialNikkei?.isAnimationActive).toBe(true);

      // Trigger change event to prefers-reduced-motion: true
      capturedLineProps.length = 0;
      capturedAreaProps.length = 0;

      act(() => {
        mediaQueryList.matches = true;
        changeHandler?.({ matches: true } as MediaQueryListEvent);
      });

      const updatedNikkei = capturedLineProps.find((p) => p.name === "nikkei");
      expect(updatedNikkei?.isAnimationActive).toBe(false);

      unmount();
      expect(removeEventListenerMock).toHaveBeenCalledWith("change", changeHandler);
    });
  });
});
