// @vitest-environment jsdom
/**
 * S5: the technical chart's two API requests go through the shared request
 * layer, so they carry an abort signal and a deadline.
 *
 * Before the consolidation the chart called `fetch()` directly: unmounting a
 * stock page (or switching ticker) left both requests running, and a response
 * that arrived afterwards still published its series into the unmounted or
 * superseded component.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StockTechnicalChart } from "./StockTechnicalChart";
import { createStockQuote } from "../test-helpers/quote";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const realSeries = [
  { date: "2026-10-20", close: 2850 },
  { date: "2026-10-21", close: 2860 },
];

/** The badge the chart shows only while it draws the generated reference series. */
const SYNTHETIC_BADGE = "参考値（デモ）";

describe("StockTechnicalChart request lifecycle (S5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("aborts an in-flight request when the chart unmounts", async () => {
    const signals: AbortSignal[] = [];
    let rejectCalculate: ((error: unknown) => void) | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/api/sync-prices")) return Promise.resolve(jsonResponse({ ok: true }));
        if (url.includes("/api/calculate")) {
          if (init?.signal) signals.push(init.signal);
          return new Promise<Response>((_resolve, reject) => {
            rejectCalculate = reject;
          });
        }
        return Promise.resolve(jsonResponse({}));
      }),
    );

    const { unmount } = render(
      <StockTechnicalChart stock={createStockQuote()} theme="dark" />,
    );
    await waitFor(() => expect(signals).toHaveLength(1));

    unmount();

    // The shared layer buffered the caller's abort and forwarded it to the
    // transport: no request survives the component.
    expect(signals[0].aborted).toBe(true);

    // Draining the rejected request must not throw out of the effect.
    const reject = rejectCalculate;
    if (typeof reject === "function") {
      (reject as (error: unknown) => void)(new DOMException("The operation was aborted.", "AbortError"));
    }
    await Promise.resolve();
  });

  it("does not publish a superseded response over the current ticker's series", async () => {
    const calculateSignals: AbortSignal[] = [];
    let rejectFirst: ((error: unknown) => void) | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/api/sync-prices")) return Promise.resolve(jsonResponse({ ok: true }));
        if (url.includes("/api/calculate")) {
          if (init?.signal) calculateSignals.push(init.signal);
          if (calculateSignals.length === 1) {
            // Deliberately ignores the abort: the promise settles only when
            // the test rejects it, after the replacement already succeeded.
            return new Promise<Response>((_resolve, reject) => {
              rejectFirst = reject;
            });
          }
          return Promise.resolve(
            jsonResponse({ stockUniverse: [{ ticker: "9984", series: realSeries }] }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      }),
    );

    const { rerender } = render(
      <StockTechnicalChart stock={createStockQuote()} theme="dark" />,
    );
    await waitFor(() => expect(calculateSignals).toHaveLength(1));

    rerender(
      <StockTechnicalChart
        stock={createStockQuote({ ticker: "9984", name: "ソフトバンクグループ" })}
        theme="dark"
      />,
    );

    // The replacement finished: the chart is showing real data, not the
    // generated reference series.
    await waitFor(() => expect(document.querySelector(".spin.animate-spin")).toBeNull());
    expect(screen.queryByText(SYNTHETIC_BADGE)).toBeNull();

    expect(calculateSignals[0].aborted).toBe(true);
    const reject = rejectFirst;
    if (typeof reject === "function") {
      // A late failure of the superseded request must not trigger the
      // synthetic-series fallback.
      (reject as (error: unknown) => void)(new TypeError("Failed to fetch"));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText(SYNTHETIC_BADGE)).toBeNull();
  });

  it("does not render a quote-priced point when every API close is unusable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/api/sync-prices")) return Promise.resolve(jsonResponse({ ok: true }));
        if (url.includes("/api/calculate")) {
          return Promise.resolve(
            jsonResponse({
              stockUniverse: [
                {
                  ticker: "7203",
                  series: [
                    { date: "2026-10-20", close: 0 },
                    { date: "2026-10-21", close: Number.NaN },
                  ],
                },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<StockTechnicalChart stock={createStockQuote()} theme="dark" />);

    // No usable observation is history. The chart falls through to the
    // generated series and discloses it instead of drawing the quote price on
    // the two historical dates.
    await waitFor(() => expect(screen.getByText(SYNTHETIC_BADGE)).toBeTruthy());
  });

  it("falls back to the disclosed reference series when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/api/sync-prices")) return Promise.resolve(jsonResponse({ ok: true }));
        if (url.includes("/api/calculate")) return Promise.reject(new TypeError("Failed to fetch"));
        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<StockTechnicalChart stock={createStockQuote()} theme="dark" />);

    // The shared layer's normalized network error is handled exactly like the
    // raw rejection was: a graceful, disclosed fallback instead of a crash.
    await waitFor(() => expect(screen.getByText(SYNTHETIC_BADGE)).toBeTruthy());
  });
});
