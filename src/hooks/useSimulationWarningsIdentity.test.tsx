// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useSimulation } from "./useSimulation";
import type { BasketItem } from "../types";

const BASKET: BasketItem[] = [
  { ticker: "7203", name: "7203", theme: "テスト", weight: 100 },
];

const SERIES = [
  { date: "2026-01-02", close: 100, value: 100 },
  { date: "2026-01-03", close: 110, value: 110 },
];

let seenWarnings: string[][] = [];

function Harness({ basket }: { basket: BasketItem[] }) {
  const { syncWarnings } = useSimulation(basket);
  seenWarnings.push(syncWarnings);
  return null;
}

beforeEach(() => {
  seenWarnings = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/snapshot")) {
        return new Response(
          JSON.stringify({
            snapshot: { symbol: "^N225", label: "日経225", current: 1, change: 0, changePct: 0, updatedAt: "", description: "" },
            series: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/sync-prices")) {
        return new Response(JSON.stringify({ ok: true, results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          baseValue: 1000,
          basket: BASKET,
          series: SERIES,
          stockUniverse: [
            {
              ticker: "7203",
              name: "7203",
              theme: "テスト",
              sector: "Unknown",
              latestPrice: 110,
              series: SERIES,
            },
          ],
          latest: null,
          syncStatus: { total: 1, found: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useSimulation warning identity (H2)", () => {
  it("keeps the same syncWarnings reference for an equal basket with a new array", async () => {
    const { rerender } = render(<Harness basket={BASKET} />);
    await waitFor(() => expect(seenWarnings.length).toBeGreaterThan(2));
    const before = seenWarnings[seenWarnings.length - 1];
    seenWarnings = [];

    await act(async () => {
      rerender(<Harness basket={[...BASKET]} />);
    });
    await waitFor(() => expect(seenWarnings.length).toBeGreaterThan(0));

    expect(seenWarnings[seenWarnings.length - 1]).toBe(before);
  });
});
