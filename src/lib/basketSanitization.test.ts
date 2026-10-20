// @vitest-environment jsdom
/**
 * Regression tests for the "send only a Worker-valid basket" contract.
 *
 * POST /api/calculate rejects a whole request on a single malformed entry
 * (`0 < weight <= 100`, ticker `^[A-Za-z0-9.-]{1,20}$`), while GET /api/indices
 * happily serves legacy rows with NULL weights coerced to `0` and imports can
 * produce full-width tickers. Sending such a basket verbatim turned one bad
 * constituent into a permanently empty dashboard with a cryptic 400, so both
 * calculation hooks now pass the basket through `sanitizeBasketForRequest`.
 *
 * Every assertion below is behavioural: the production modules are called with
 * concrete inputs and the observable outcome is checked (the payload that
 * reaches the network, the rendered DOM, the sanitized basket). Nothing is
 * asserted against the source text of a hook.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { sanitizeBasketForRequest } from "./indexEngine";
import { clearScreenerUniverseClientCache } from "./marketDataService";
import { useCalculation } from "../hooks/useCalculation";
import { useSimulation } from "../hooks/useSimulation";
import { ScreenerPage } from "../components/ScreenerPage";
import { ToastProvider } from "../components/Toast";
import type { BasketItem } from "../types";
import type { CustomIndex } from "../data/indices";

const item = (over: Partial<BasketItem>): BasketItem => ({
  ticker: "7203",
  name: "トヨタ自動車",
  theme: "自動車",
  weight: 50,
  ...over,
});

describe("sanitizeBasketForRequest", () => {
  it("keeps a compliant basket untouched", () => {
    const input = [item({ ticker: "7203", weight: 60 }), item({ ticker: "8035", weight: 40 })];
    const result = sanitizeBasketForRequest(input);

    expect(result.dropped).toEqual([]);
    expect(result.basket).toHaveLength(2);
    expect(result.basket[0]).toEqual(input[0]);
    expect(result.basket[1]).toEqual(input[1]);
  });

  it("repairs legacy NULL/zero weights by excluding them instead of sending weight: 0", () => {
    const result = sanitizeBasketForRequest([
      item({ ticker: "7203", weight: 70 }),
      item({ ticker: "8035", weight: 0 as unknown as number }),
      item({ ticker: "8306", weight: null as unknown as number }),
    ]);

    expect(result.basket.map((b) => b.ticker)).toEqual(["7203"]);
    expect(result.basket.every((b) => b.weight > 0 && b.weight <= 100)).toBe(true);
    expect(result.dropped).toEqual(["8035", "8306"]);
  });

  it("never returns an empty basket when the input had items but no usable weight", () => {
    // A single legacy zero-weight row must stay computable: an empty request
    // would be rejected with "must contain at least 1 item" as well.
    const result = sanitizeBasketForRequest([item({ ticker: "7203", weight: 0 })]);

    expect(result.basket).toHaveLength(1);
    expect(result.basket[0].weight).toBe(100);
    expect(result.dropped).toEqual([]);
  });

  it("keeps a zero-weight constituent and gives it the remaining budget when the weights are repaired", () => {
    // DATA-17: dropping a legacy `weight: 0` row deleted the constituent from
    // the index on the next save, so the repair mode keeps the row and gives it
    // the part of the 100% budget that the usable weights do not use.
    const result = sanitizeBasketForRequest(
      [
        item({ ticker: "7203", weight: 70 }),
        item({ ticker: "8035", weight: 0 as unknown as number }),
      ],
      { repairMissingWeights: true },
    );

    expect(result.basket.map((b) => b.ticker)).toEqual(["7203", "8035"]);
    expect(result.basket[1].weight).toBe(30);
    // The budget is redistributed, not duplicated: the basket still sums to 100.
    expect(result.basket.reduce((sum, b) => sum + b.weight, 0)).toBe(100);
    // The repair is reported so the caller can tell the user what changed.
    expect(result.repaired).toEqual([{ ticker: "8035", from: 0, to: 30 }]);
    expect(result.dropped).toEqual([]);
  });

  it("reports no repair when every weight is already usable", () => {
    const result = sanitizeBasketForRequest([item({ ticker: "7203", weight: 100 })], {
      repairMissingWeights: true,
    });

    expect(result.basket).toHaveLength(1);
    expect(result.repaired).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it("converts full-width tickers to the ASCII form the Worker validates", () => {
    const result = sanitizeBasketForRequest([
      item({ ticker: "７２０３" }),
      item({ ticker: "aapl", weight: 30 }),
    ]);

    expect(result.basket.map((b) => b.ticker)).toEqual(["7203", "AAPL"]);
    expect(result.dropped).toEqual([]);
  });

  it("drops tickers that stay invalid after normalization and deduplicates the rest", () => {
    const result = sanitizeBasketForRequest([
      item({ ticker: "BAD TICKER" }),
      item({ ticker: "", weight: 30 }),
      item({ ticker: "7203", weight: 50 }),
      item({ ticker: "７２０３", weight: 20 }), // duplicate of 7203 after normalization
    ]);

    expect(result.basket.map((b) => b.ticker)).toEqual(["7203"]);
    expect(result.basket[0].weight).toBe(50);
    expect(result.dropped).toHaveLength(3);
  });

  it("clamps over-100 weights instead of dropping the constituent", () => {
    const result = sanitizeBasketForRequest([
      item({ ticker: "7203", weight: 150 }),
      item({ ticker: "8035", weight: 50 }),
    ]);

    expect(result.basket).toHaveLength(2);
    expect(result.basket[0].weight).toBe(100);
    expect(result.dropped).toEqual([]);
  });

  it("repairs missing/oversized name and theme fields to fit the Worker limits", () => {
    const result = sanitizeBasketForRequest([
      item({ ticker: "7203", name: "   ", theme: "" }),
      item({ ticker: "8035", name: "x".repeat(150), theme: "y".repeat(150), weight: 40 }),
    ]);

    expect(result.basket[0].name).toBe("7203");
    expect(result.basket[0].theme).toBe("カスタム");
    expect(result.basket[1].name).toHaveLength(100);
    expect(result.basket[1].theme).toHaveLength(100);
  });

  it("returns an empty basket only when no ticker can be repaired", () => {
    const result = sanitizeBasketForRequest([item({ ticker: "@@@" }), item({ ticker: "" })]);

    expect(result.basket).toEqual([]);
    expect(result.dropped).toHaveLength(2);
  });
});

/** A basket as a legacy D1 row / an import can deliver it. */
const LEGACY_BASKET: BasketItem[] = [
  { ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 60 },
  // A legacy row whose weight column was NULL: GET /api/indices coerces it to 0.
  { ticker: "8035", name: "東京エレクトロン", theme: "半導体", weight: 0 },
  // A full-width ticker: the Worker only accepts `^[A-Za-z0-9.-]{1,20}$`.
  { ticker: "６８５７", name: "アドバンテスト", theme: "半導体", weight: 40 },
];

interface CalculateRequest {
  url: string;
  body: { basket: BasketItem[]; baseValue?: number } | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Stub the whole client API and record every POST /api/calculate payload.
 *
 * The stub is hermetic: no request can reach the network whatever the
 * environment looks like.
 */
function stubApi(calculateResponder: () => Response): CalculateRequest[] {
  const calculateCalls: CalculateRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/calculate")) {
        const rawBody = init?.body;
        calculateCalls.push({
          url,
          body: typeof rawBody === "string" ? JSON.parse(rawBody) : null,
        });
        return calculateResponder();
      }
      if (url.includes("/api/sync-prices")) {
        return jsonResponse({ ok: true, results: [] });
      }
      if (url.includes("/api/snapshot")) {
        return jsonResponse({ snapshot: null, series: [] });
      }
      return jsonResponse({});
    }),
  );
  return calculateCalls;
}

const CALCULATE_OK = (): Response =>
  jsonResponse({
    ok: true,
    baseValue: 1000,
    basket: [],
    series: [],
    stockUniverse: [],
    latest: null,
    syncStatus: { total: 0, found: 0 },
  });

/** Both calculation hooks, reduced to "run once and report the request". */
const CALCULATION_HOOKS: Array<{
  name: string;
  run: (basket: BasketItem[]) => Promise<CalculateRequest[]>;
}> = [
  {
    name: "useCalculation",
    run: async (basket) => {
      const calls = stubApi(CALCULATE_OK);
      const index: CustomIndex = {
        id: "legacy-idx",
        name: "レガシー指数",
        description: "",
        baseValue: 1000,
        basket,
      };
      renderHook(() => useCalculation(index));
      await waitFor(() => expect(calls.length).toBeGreaterThan(0), { timeout: 5000 });
      return calls;
    },
  },
  {
    name: "useSimulation",
    run: async (basket) => {
      const calls = stubApi(CALCULATE_OK);
      renderHook(() => useSimulation(basket, 1000));
      await waitFor(() => expect(calls.length).toBeGreaterThan(0), { timeout: 5000 });
      return calls;
    },
  },
];

describe("calculation hooks send the sanitized basket", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(CALCULATION_HOOKS)(
    "$name sanitizes before POST /api/calculate",
    async ({ run }) => {
      const calls = await run(LEGACY_BASKET);
      const body = calls[0].body;

      expect(body).not.toBeNull();
      const sentBasket = body?.basket ?? [];

      // The Worker-valid basket is what reaches the network: the legacy
      // zero-weight row is gone and the full-width ticker is ASCII.
      expect(sentBasket.map((b) => b.ticker)).toEqual(["7203", "6857"]);
      expect(sentBasket.every((b) => b.weight > 0 && b.weight <= 100)).toBe(true);
      expect(sentBasket.map((b) => b.weight)).toEqual([60, 40]);

      // The raw basket is never forwarded verbatim (the pre-fix payload).
      expect(sentBasket.map((b) => b.ticker)).not.toContain("8035");
      expect(sentBasket.map((b) => b.ticker)).not.toContain("６８５７");
      expect(JSON.stringify(sentBasket)).not.toContain("６８５７");
    },
  );

  it("useSimulation surfaces the calculation API error instead of discarding it", async () => {
    const serverMessage = "Invalid basket item: weight must be > 0 and <= 100";
    stubApi(() => jsonResponse({ error: serverMessage }, 400));

    const { result } = renderHook(() => useSimulation(LEGACY_BASKET, 1000));

    // The pre-fix behaviour was an unconditional reset that hid the 400 reason.
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 5000 });
    expect(result.current.error).toContain(serverMessage);
    expect(result.current.usingDemoData).toBe(true);
  });
});

describe("screener selection is operable from the keyboard", () => {
  beforeEach(() => {
    clearScreenerUniverseClientCache();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /**
   * A conforming browser activates a `<button>` on Space *unless* the keydown
   * was default-prevented, so the native click would toggle the selection a
   * second time. jsdom does not implement that activation behaviour, so the
   * sequence is replayed here to prove the handler prevents the double toggle.
   */
  function pressSpace(button: HTMLElement): KeyboardEvent {
    const keydown = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      button.dispatchEvent(keydown);
    });
    if (!keydown.defaultPrevented) {
      act(() => {
        button.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
        button.click();
      });
    }
    return keydown;
  }

  it("toggles the selection exactly once and never lets the native click double-toggle it", async () => {
    const onOpenStockDetail = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/stocks/screener")) {
          return jsonResponse([
            {
              ticker: "7203",
              name: "トヨタ自動車",
              theme: "自動車",
              sector: "輸送用機器 (自動車)",
              market: "PRIME",
              price: 2910.5,
              change: 8.5,
              changePercent: 0.29,
              volume: 17845800,
              previousClose: 2902,
              dayHigh: 2936.5,
              dayLow: 2891,
              yearHigh: 4000,
              yearLow: 2686,
              marketCap: 344657,
              per: 8.3,
              pbr: 0.92,
              dividendYield: 3.45,
              roe: 12.4,
              equityRatio: 46.5,
              eps: 351.4,
              dps: 100,
              technicalSignal: "NEUTRAL",
              sparkline: [2900, 2905, 2902, 2908, 2910.5],
            },
          ]);
        }
        return jsonResponse({});
      }),
    );

    render(
      createElement(
        ToastProvider,
        null,
        createElement(ScreenerPage, { onNavigate: vi.fn(), onOpenStockDetail }),
      ),
    );

    // The desktop table and the mobile card list both render the row, so the
    // selection control exists twice; both must behave the same way.
    const checkboxes = await screen.findAllByRole("checkbox", {
      name: "トヨタ自動車 の選択切り替え",
    });
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    const [desktopCheckbox, mobileCheckbox] = checkboxes;

    // Nothing is selected yet.
    expect(desktopCheckbox.getAttribute("aria-checked")).toBe("false");
    expect(mobileCheckbox.getAttribute("aria-checked")).toBe("false");

    const keydown = pressSpace(desktopCheckbox);

    // preventDefault: the browser must not synthesise the extra click.
    expect(keydown.defaultPrevented).toBe(true);
    // The selection was toggled exactly once (a double toggle would leave the
    // checkbox unchecked again).
    expect(desktopCheckbox.getAttribute("aria-checked")).toBe("true");
    // Both controls show the same selection state.
    expect(mobileCheckbox.getAttribute("aria-checked")).toBe("true");
    // stopPropagation: the shortcut must not also open the stock detail.
    expect(onOpenStockDetail).not.toHaveBeenCalled();

    // The mobile control behaves exactly the same and toggles exactly once.
    const mobileKeydown = pressSpace(mobileCheckbox);
    expect(mobileKeydown.defaultPrevented).toBe(true);
    expect(mobileCheckbox.getAttribute("aria-checked")).toBe("false");
    expect(desktopCheckbox.getAttribute("aria-checked")).toBe("false");
    expect(onOpenStockDetail).not.toHaveBeenCalled();
  });

  it("ignores keys other than Enter and Space", async () => {
    const onOpenStockDetail = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/stocks/screener")) {
          return jsonResponse([
            {
              ticker: "7203",
              name: "トヨタ自動車",
              theme: "自動車",
              sector: "輸送用機器 (自動車)",
              market: "PRIME",
              price: 2910.5,
              change: 8.5,
              changePercent: 0.29,
              technicalSignal: "NEUTRAL",
            },
          ]);
        }
        return jsonResponse({});
      }),
    );

    render(
      createElement(
        ToastProvider,
        null,
        createElement(ScreenerPage, { onNavigate: vi.fn(), onOpenStockDetail }),
      ),
    );

    const checkboxes = await screen.findAllByRole("checkbox", {
      name: "トヨタ自動車 の選択切り替え",
    });
    const checkbox = checkboxes[0];

    const otherKey = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      checkbox.dispatchEvent(otherKey);
    });

    expect(otherKey.defaultPrevented).toBe(false);
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(onOpenStockDetail).not.toHaveBeenCalled();
  });
});
