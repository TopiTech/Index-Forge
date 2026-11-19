// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { StockTechnicalChart } from "./StockTechnicalChart";
import { createStockQuote } from "../test-helpers/quote";
import { CALCULATION_REQUEST_TIMEOUT_MS } from "../lib/apiContract";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("StockTechnicalChart calculate deadline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the endpoint's 30s budget for /api/calculate, not the generic 8s budget", async () => {
    const timerSpy = vi.spyOn(globalThis, "setTimeout");
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/api/calculate")) return new Promise<Response>(() => {});
        return Promise.resolve(jsonResponse({ ok: true }));
      }),
    );

    render(<StockTechnicalChart stock={createStockQuote()} theme="dark" />);

    await waitFor(() => {
      expect(
        vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/api/calculate")),
      ).toBe(true);
    });

    const delays = timerSpy.mock.calls.map((call) => call[1]);
    // Pin the contract itself: importing the constant alone would let a
    // 30s -> 8s regression of the shared constant keep this test green.
    expect(CALCULATION_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(delays).toContain(CALCULATION_REQUEST_TIMEOUT_MS);
  });
});
