/**
 * Regression tests for the "send only a Worker-valid basket" contract.
 *
 * POST /api/calculate rejects a whole request on a single malformed entry
 * (`0 < weight <= 100`, ticker `^[A-Za-z0-9.-]{1,20}$`), while GET /api/indices
 * happily serves legacy rows with NULL weights coerced to `0` and imports can
 * produce full-width tickers. Sending such a basket verbatim turned one bad
 * constituent into a permanently empty dashboard with a cryptic 400, so both
 * calculation hooks now pass the basket through `sanitizeBasketForRequest`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeBasketForRequest } from "./indexEngine";
import type { BasketItem } from "../types";

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

describe("calculation hooks send the sanitized basket", () => {
  const useCalculationSource = readFileSync(
    resolve(process.cwd(), "src/hooks/useCalculation.ts"),
    "utf8",
  );
  const useSimulationSource = readFileSync(
    resolve(process.cwd(), "src/hooks/useSimulation.ts"),
    "utf8",
  );

  it.each([
    ["useCalculation", useCalculationSource],
    ["useSimulation", useSimulationSource],
  ])("%s sanitizes before POST /api/calculate", (_name, source) => {
    expect(source).toContain("sanitizeBasketForRequest(");
    expect(source).toContain("basket: requestBasket");
    // The pre-fix payload: the raw basket forwarded verbatim to the API.
    expect(source).not.toContain("basket: selectedIndex.basket,");
    expect(source).not.toContain("basket: basket.map(");
  });

  it("useSimulation surfaces the calculation API error instead of discarding it", () => {
    expect(useSimulationSource).toContain("serverErrorMessage");
    expect(useSimulationSource).toMatch(/errBody\.error/);
    // The pre-fix behaviour: an unconditional reset that hid the 400/429 reason.
    expect(useSimulationSource).not.toMatch(/knownTickersRef\.current = currentTickersKey;\s*\n\s*setError\(null\);/);
  });
});

describe("screener selection is operable from the keyboard", () => {
  const screenerSource = readFileSync(
    resolve(process.cwd(), "src/components/ScreenerPage.tsx"),
    "utf8",
  );

  it("calls preventDefault in every checkbox keydown so the native click cannot double-toggle", () => {
    const keydownBlocks = screenerSource.match(
      /onKeyDown=\{\(e\) => \{\s*\n\s*if \(e\.key === "Enter" \|\| e\.key === " "\) \{\s*\n([\s\S]{0,400}?)handleToggleSelect/g,
    );
    expect(keydownBlocks).not.toBeNull();
    expect(keydownBlocks!.length).toBeGreaterThanOrEqual(2);
    for (const block of keydownBlocks!) {
      expect(block).toContain("e.preventDefault()");
      expect(block).toContain("e.stopPropagation()");
    }
  });
});
