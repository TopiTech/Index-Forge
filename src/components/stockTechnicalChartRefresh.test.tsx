// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { StockTechnicalChart } from "./StockTechnicalChart";
import { createStockQuote } from "../test-helpers/quote";

/**
 * The chart's data effect used to depend on the *identity* of the quote
 * object while its de-duplication guard was keyed on the quote's *content*
 * signature.
 *
 * A refresh that returned the same numbers therefore re-ran the effect: the
 * cleanup cancelled the in-flight request, and the guard then decided that
 * nothing had changed and skipped re-issuing it. The cancelled response was
 * discarded, so `localDataLoading` was never reset and the chart stayed on
 * its spinner until the page was reloaded.
 */
const quote = createStockQuote();

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("StockTechnicalChart refresh", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the in-flight request alive when the quote content is unchanged", async () => {
    const calculateCalls: string[] = [];
    let resolveCalculate: ((value: Response | PromiseLike<Response>) => void) | null = null;

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/sync-prices")) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.includes("/api/calculate")) {
        calculateCalls.push(url);
        return new Promise<Response>((resolve) => {
          resolveCalculate = resolve;
        });
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<StockTechnicalChart stock={quote} theme="dark" />);
    await waitFor(() => expect(calculateCalls.length).toBe(1));

    // A refresh that returns the very same numbers: a new object, identical
    // content.
    rerender(<StockTechnicalChart stock={{ ...quote }} theme="dark" />);

    const resolver = resolveCalculate;
    if (typeof resolver === "function") {
      (resolver as (value: Response | PromiseLike<Response>) => void)(
        jsonResponse({
          stockUniverse: [
            { ticker: "7203", series: [{ date: "2026-10-20", close: 2850 }] },
          ],
        }),
      );
    }

    // The request was not cancelled, so the chart leaves its loading state.
    await waitFor(() => {
      expect(document.querySelector(".spin.animate-spin")).toBeNull();
    });
    // And it was not issued a second time either.
    expect(calculateCalls.length).toBe(1);
  });

  it("re-issues the request when the quote content actually changed", async () => {
    const calculateCalls: string[] = [];

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/sync-prices")) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.includes("/api/calculate")) {
        calculateCalls.push(url);
        return Promise.resolve(
          jsonResponse({
            stockUniverse: [
              { ticker: "7203", series: [{ date: "2026-10-20", close: 2850 }] },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<StockTechnicalChart stock={quote} theme="dark" />);
    await waitFor(() => expect(calculateCalls.length).toBe(1));

    rerender(<StockTechnicalChart stock={{ ...quote, price: 3000 }} theme="dark" />);

    await waitFor(() => expect(calculateCalls.length).toBe(2));
  });
});
