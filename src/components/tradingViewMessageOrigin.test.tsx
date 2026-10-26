// @vitest-environment jsdom
/**
 * Regression test for N-2 (TradingView postMessage origin gate).
 *
 * The chart listened to every `message` event on the window and switched to
 * its local fallback whenever any payload matched the symbol-error shape, so
 * an arbitrary frame could force the fallback even with a healthy widget.
 * The listener now accepts only events from the TradingView embed origins
 * (the same hosts the deployed CSP allow-lists in `frame-src`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  isTradingViewMessageOrigin,
  isTradingViewSymbolError,
  StockTechnicalChart,
} from "./StockTechnicalChart";
import { createStockQuote } from "../test-helpers/quote";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const usStock = () =>
  createStockQuote({ ticker: "AAPL", name: "Apple", market: "US" });

function postSymbolError(origin: string): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify({ name: "tv-widget-symbol-error" }),
      origin,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isTradingViewMessageOrigin (N-2)", () => {
  it("accepts the TradingView embed origins", () => {
    expect(isTradingViewMessageOrigin("https://s.tradingview.com")).toBe(true);
    expect(isTradingViewMessageOrigin("https://www.tradingview-widget.com")).toBe(true);
    expect(isTradingViewMessageOrigin("https://tradingview.com")).toBe(true);
    expect(isTradingViewMessageOrigin("https://www.tradingview.com")).toBe(true);
    expect(isTradingViewMessageOrigin("https://s.tradingview-widget.com")).toBe(true);
  });

  it("is case-insensitive and tolerates explicit ports", () => {
    expect(isTradingViewMessageOrigin("https://S.TradingView.COM")).toBe(true);
    expect(isTradingViewMessageOrigin("https://s.tradingview.com:443")).toBe(true);
  });

  it("rejects empty, non-string and malformed origins", () => {
    expect(isTradingViewMessageOrigin("")).toBe(false);
    expect(isTradingViewMessageOrigin(undefined)).toBe(false);
    expect(isTradingViewMessageOrigin(null)).toBe(false);
    expect(isTradingViewMessageOrigin(42)).toBe(false);
    expect(isTradingViewMessageOrigin("not-a-url")).toBe(false);
  });

  it("rejects lookalike and unrelated origins", () => {
    expect(isTradingViewMessageOrigin("https://evil-tradingview.com")).toBe(false);
    expect(isTradingViewMessageOrigin("https://tradingview.com.evil.com")).toBe(false);
    expect(isTradingViewMessageOrigin("https://tradingview-widget.com.evil.com")).toBe(false);
    expect(isTradingViewMessageOrigin("https://evil.com")).toBe(false);
    // Userinfo smuggling: the hostname is evil.com, not the embed host.
    expect(isTradingViewMessageOrigin("https://s.tradingview.com@evil.com")).toBe(false);
  });

  it("keeps the payload predicate unchanged", () => {
    expect(isTradingViewSymbolError({ name: "tv-widget-symbol-error" })).toBe(true);
    expect(isTradingViewSymbolError({ hello: "world" })).toBe(false);
  });
});

describe("StockTechnicalChart message listener (N-2)", () => {
  it("ignores a symbol-error payload from a foreign origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            stockUniverse: [
              {
                ticker: "AAPL",
                series: [
                  { date: "2026-10-20", close: 230 },
                  { date: "2026-10-21", close: 232 },
                ],
              },
            ],
          }),
        ),
      ),
    );

    render(<StockTechnicalChart stock={usStock()} theme="dark" />);
    await waitFor(() =>
      expect(document.querySelector(".tradingview-widget-container")).not.toBeNull(),
    );

    await act(async () => {
      postSymbolError("https://evil.example");
      await Promise.resolve();
    });

    // Still on the TradingView engine: no fallback badge, widget intact.
    expect(document.querySelector(".tradingview-widget-container")).not.toBeNull();
    expect(screen.queryByText(/LOCAL QUANT ENGINE/)).toBeNull();
  });

  it("falls back on a symbol-error payload from the TradingView origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            stockUniverse: [
              {
                ticker: "AAPL",
                series: [
                  { date: "2026-10-20", close: 230 },
                  { date: "2026-10-21", close: 232 },
                ],
              },
            ],
          }),
        ),
      ),
    );

    render(<StockTechnicalChart stock={usStock()} theme="dark" />);
    await waitFor(() =>
      expect(document.querySelector(".tradingview-widget-container")).not.toBeNull(),
    );

    await act(async () => {
      postSymbolError("https://s.tradingview.com");
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByText(/LOCAL QUANT ENGINE/)).not.toBeNull());
    expect(document.querySelector(".tradingview-widget-container")).toBeNull();
  });
});
