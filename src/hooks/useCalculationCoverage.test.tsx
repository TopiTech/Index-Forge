// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useCalculation } from "./useCalculation";
import { expectConnectionHint, renderWithFailingFetch } from "../test-helpers/networkFailure";
import type { CustomIndex } from "../data/indices";

const SYNC_CACHE_KEY = "osi_stock_sync_cache";

const INDEX: CustomIndex = {
  id: "idx-1",
  name: "Test Index",
  description: "",
  baseValue: 1000,
  basket: [
    { ticker: "7203", name: "Toyota", theme: "Auto", weight: 50 },
    { ticker: "6758", name: "Sony", theme: "Elec", weight: 50 },
  ],
};

/**
 * H-4 wiring: the dashboard must disclose carried-forward prices, not just
 * tickers with no data at all. B stops printing on 04-02 while the window
 * runs to 04-03, so the latest value is stale for B.
 */
describe("useCalculation coverage disclosure (H-4)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("warns when the latest date is carried forward for a constituent", async () => {
    // Fresh sync cache: the sync endpoint is not consulted in this test.
    window.localStorage.setItem(
      SYNC_CACHE_KEY,
      JSON.stringify({ "7203": Date.now(), "6758": Date.now() }),
    );

    const universe = [
      {
        ticker: "7203",
        name: "Toyota",
        series: [
          { date: "2026-04-01", close: 3000 },
          { date: "2026-04-02", close: 3100 },
          { date: "2026-04-03", close: 3200 },
        ],
      },
      {
        ticker: "6758",
        name: "Sony",
        series: [
          { date: "2026-04-01", close: 13000 },
          { date: "2026-04-02", close: 13100 },
        ],
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/calculate") && init?.method === "POST") {
        return new Response(JSON.stringify({ series: [], stockUniverse: universe }), {
          status: 200,
        });
      }
      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCalculation(INDEX, true));
    await waitFor(() => expect(result.current.syncWarnings.length).toBeGreaterThan(0));

    const text = result.current.syncWarnings.join("\n");
    expect(text).toContain("最新日（2026-04-03）");
    expect(text).toContain("6758");
    // The fully-priced constituent must not be reported as missing.
    expect(text).not.toContain("7203");

    await act(async () => {
      cleanup();
    });
  });

  it("reports the connection hint (not raw browser text) when the calculate fetch fails", async () => {
    // Fresh sync cache: the sync endpoint is not consulted in this test.
    window.localStorage.setItem(
      SYNC_CACHE_KEY,
      JSON.stringify({ "7203": Date.now(), "6758": Date.now() }),
    );

    const { result } = renderWithFailingFetch((index: typeof INDEX) => useCalculation(index, true), {
      initialProps: INDEX,
    });
    await waitFor(() => expectConnectionHint(result.current.error));

    await act(async () => {
      cleanup();
    });
  });
});
