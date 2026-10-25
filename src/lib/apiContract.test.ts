import { describe, expect, it } from "vitest";
import {
  MAX_BASE_VALUE,
  MAX_BASKET_ITEMS,
  MAX_INDEX_ID_LENGTH,
  MAX_OWNER_TOKEN_LENGTH,
  MAX_TICKER_LENGTH,
  clampBaseValue,
  isValidBaseValue,
  isValidIndexId,
  isValidSortOrder,
  isValidTicker,
  isValidWeight,
  readJsonBody,
  validateBasketItems,
} from "./apiContract";
import { deserializeIndexFromJson } from "./indexSerialization";

describe("apiContract: ticker rule", () => {
  it("accepts every ticker shape the Worker supports", () => {
    for (const ticker of ["AAPL", "7203", "^N225", "USDJPY=X", "BRK_A", "7203.T", "BTC-USD"]) {
      expect(isValidTicker(ticker)).toBe(true);
    }
  });

  it("rejects empty, over-long and out-of-charset tickers", () => {
    expect(isValidTicker("")).toBe(false);
    expect(isValidTicker("A".repeat(MAX_TICKER_LENGTH + 1))).toBe(false);
    expect(isValidTicker("A".repeat(MAX_TICKER_LENGTH))).toBe(true);
    expect(isValidTicker("TICKER@SYM")).toBe(false);
    expect(isValidTicker("TICKER!SYM")).toBe(false);
    expect(isValidTicker("TICKER#SYM")).toBe(false);
    expect(isValidTicker("TICKER$SYM")).toBe(false);
    expect(isValidTicker("AAPL; DROP TABLE indices;")).toBe(false);
    expect(isValidTicker("<script>alert(1)</script>")).toBe(false);
  });
});

describe("apiContract: index id rule", () => {
  it("accepts the ids the Worker allows, including the prototype names", () => {
    // `constructor` and `prototype` are legal index ids under the Worker's
    // rule, so the ownership store has to be able to round-trip them.
    expect(isValidIndexId("constructor")).toBe(true);
    expect(isValidIndexId("prototype")).toBe(true);
    expect(isValidIndexId("custom-1")).toBe(true);
  });

  it("rejects ids outside the charset or the length limit", () => {
    expect(isValidIndexId("")).toBe(false);
    expect(isValidIndexId("a".repeat(MAX_INDEX_ID_LENGTH + 1))).toBe(false);
    expect(isValidIndexId("a".repeat(MAX_INDEX_ID_LENGTH))).toBe(true);
    expect(isValidIndexId("has space")).toBe(false);
    expect(isValidIndexId("has/slash")).toBe(false);
  });
});

describe("apiContract: numeric rules", () => {
  it("bounds the base value exactly like the Worker", () => {
    expect(isValidBaseValue(1000)).toBe(true);
    expect(isValidBaseValue(MAX_BASE_VALUE)).toBe(true);
    expect(isValidBaseValue(MAX_BASE_VALUE + 1)).toBe(false);
    expect(isValidBaseValue(0)).toBe(false);
    expect(isValidBaseValue(-1)).toBe(false);
    expect(isValidBaseValue(Number.NaN)).toBe(false);
    expect(isValidBaseValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidBaseValue("1000")).toBe(false);
  });

  it("clamps an out-of-range base value into the contract instead of failing", () => {
    expect(clampBaseValue(5_000_000)).toBe(MAX_BASE_VALUE);
    expect(clampBaseValue(500)).toBe(500);
    expect(clampBaseValue(0)).toBe(1000);
    expect(clampBaseValue(Number.NaN)).toBe(1000);
  });

  it("bounds the weight and the sort order", () => {
    expect(isValidWeight(0.01)).toBe(true);
    expect(isValidWeight(100)).toBe(true);
    expect(isValidWeight(0)).toBe(false);
    expect(isValidWeight(101)).toBe(false);
    expect(isValidWeight(Number.NaN)).toBe(false);
    expect(isValidWeight("50")).toBe(false);

    expect(isValidSortOrder(0)).toBe(true);
    expect(isValidSortOrder(9999)).toBe(true);
    expect(isValidSortOrder(10000)).toBe(false);
    expect(isValidSortOrder(-1)).toBe(false);
    expect(isValidSortOrder(null)).toBe(false);
  });
});

describe("apiContract: basket validation", () => {
  const validItem = { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 40 };

  it("accepts a well-formed basket and normalises the ticker", () => {
    const result = validateBasketItems([{ ...validItem, ticker: " 7203.t " }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basket).toEqual([
      { ticker: "7203.T", name: "トヨタ", theme: "自動車", weight: 40 },
    ]);
  });

  it("rejects an invalid ticker with the Worker's message", () => {
    const result = validateBasketItems([{ ...validItem, ticker: "TICKER@SYM" }]);
    expect(result).toEqual({ ok: false, error: "Invalid basket item: ticker" });
  });

  it("rejects a duplicate ticker", () => {
    const result = validateBasketItems([validItem, { ...validItem, ticker: "7203" }]);
    expect(result).toEqual({ ok: false, error: "Duplicate ticker in basket: 7203" });
  });

  it("rejects a missing or over-long name", () => {
    expect(validateBasketItems([{ ...validItem, name: "" }])).toEqual({
      ok: false,
      error: "Invalid basket item: name",
    });
    expect(validateBasketItems([{ ...validItem, name: "x".repeat(101) }])).toEqual({
      ok: false,
      error: "Invalid basket item: name",
    });
  });

  it("rejects an out-of-range weight", () => {
    expect(validateBasketItems([{ ...validItem, weight: 0 }])).toEqual({
      ok: false,
      error: "Invalid basket item: weight must be > 0 and <= 100",
    });
    expect(validateBasketItems([{ ...validItem, weight: 101 }])).toEqual({
      ok: false,
      error: "Invalid basket item: weight must be > 0 and <= 100",
    });
  });

  it("requires a theme only when the caller asks for it", () => {
    const withoutTheme = { ticker: "7203", name: "トヨタ", weight: 40 };

    const lenient = validateBasketItems([withoutTheme]);
    expect(lenient.ok).toBe(true);
    if (lenient.ok) expect(lenient.basket[0].theme).toBe("カスタム");

    const strict = validateBasketItems([withoutTheme], { requireTheme: true });
    expect(strict).toEqual({ ok: false, error: "Invalid basket item: theme" });
  });

  it("rejects a non-object entry", () => {
    expect(validateBasketItems(["7203"])).toEqual({ ok: false, error: "Invalid basket item" });
    expect(validateBasketItems([null])).toEqual({ ok: false, error: "Invalid basket item" });
  });
});

describe("apiContract: the imported index stays inside the Worker's contract", () => {
  const buildJson = (baseValue: number, basketSize = 1) =>
    JSON.stringify({
      version: 1,
      name: "Import Test",
      baseValue,
      basket: Array.from({ length: basketSize }, (_, i) => ({
        ticker: `T${i}`,
        name: `Stock ${i}`,
        theme: "Tech",
        weight: 100 / basketSize,
      })),
    });

  it("clamps a base value the Worker would reject", () => {
    const result = deserializeIndexFromJson(buildJson(5_000_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The Worker answers 400 for anything above 1,000,000, so an imported
    // index that kept the raw value could never be calculated or saved again.
    expect(result.data.baseValue).toBe(MAX_BASE_VALUE);
    expect(isValidBaseValue(result.data.baseValue)).toBe(true);
  });

  it("keeps a base value inside the contract untouched", () => {
    const result = deserializeIndexFromJson(buildJson(2500));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.baseValue).toBe(2500);
  });

  it("truncates a basket that is larger than the Worker accepts", () => {
    const result = deserializeIndexFromJson(buildJson(1000, MAX_BASKET_ITEMS + 25));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.basket.length).toBe(MAX_BASKET_ITEMS);
  });
});

describe("apiContract: the owner token length is stated once", () => {
  it("matches the length the Worker accepts", () => {
    expect(MAX_OWNER_TOKEN_LENGTH).toBe(256);
  });
});

describe("apiContract: readJsonBody", () => {
  it("returns the parsed JSON for a well-formed body", async () => {
    const res = new Response(JSON.stringify({ ok: true, series: [1, 2, 3] }), {
      headers: { "content-type": "application/json" },
    });
    const data = await readJsonBody<{ ok?: boolean; series?: unknown }>(res);
    expect(data).toEqual({ ok: true, series: [1, 2, 3] });
  });

  it("returns null for an HTML error page served with HTTP 200", async () => {
    const res = new Response("<html><body>502 Bad Gateway</body></html>", {
      headers: { "content-type": "text/html" },
    });
    expect(await readJsonBody(res)).toBeNull();
  });

  it("returns null for an empty body", async () => {
    expect(await readJsonBody(new Response(""))).toBeNull();
  });
});
