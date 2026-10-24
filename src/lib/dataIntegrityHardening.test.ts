import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getIndexOwnerToken,
  isIndexOwner,
  saveIndexOwnerToken,
} from "./ownership";
import {
  fetchStockFundamentals,
  getStockFundamentals,
  sanitizeStockFundamentals,
} from "./marketDataService";

const STORAGE_KEY = "custom_index_owners";

function makeStorage(initial: Record<string, string> = {}) {
  const backing = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (backing.has(key) ? (backing.get(key) as string) : null),
    setItem: (key: string, value: string) => void backing.set(key, value),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => void backing.clear(),
  };
}

describe("owner token round trip for every legal index id", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The Worker's index id rule is `^[A-Za-z0-9._-]+$`, so these three ids are
  // legal. The read path used to drop them, so the creator of such an index
  // silently lost the ownership rights to it.
  it.each(["constructor", "prototype", "__proto__"])(
    "round-trips the owner token of the index id %s",
    (indexId) => {
      saveIndexOwnerToken(indexId, "token-a");
      expect(getIndexOwnerToken(indexId)).toBe("token-a");
      expect(isIndexOwner(indexId)).toBe(true);
    },
  );

  it("does not let an index id reach Object.prototype", () => {
    saveIndexOwnerToken("__proto__", "token-a");
    // The store must stay an ordinary own property, not a prototype write.
    expect(({} as Record<string, unknown>).token).toBeUndefined();
    expect(Object.getPrototypeOf({} as object)).toBe(Object.prototype);
    const raw = (globalThis as { localStorage: Storage }).localStorage.getItem(STORAGE_KEY);
    expect(raw).toContain("__proto__");
    // A second, unrelated index id must not resolve to the token either.
    expect(getIndexOwnerToken("toString")).toBeNull();
  });

  it("keeps the owner token of other ids intact", () => {
    saveIndexOwnerToken("idx-1", "token-a");
    saveIndexOwnerToken("constructor", "token-b");
    expect(getIndexOwnerToken("idx-1")).toBe("token-a");
    expect(getIndexOwnerToken("constructor")).toBe("token-b");
  });
});

describe("historicalFinances are numeric before they reach the UI", () => {
  const baseline = getStockFundamentals("7203");

  it("keeps a complete row unchanged", () => {
    const result = sanitizeStockFundamentals(
      {
        ticker: "7203",
        price: 3000,
        historicalFinances: [
          { fiscalYear: "2024/3", revenue: 100, operatingIncome: 20, netIncome: 15, eps: 5, dps: 2 },
        ],
      },
      baseline,
      "7203",
    );
    expect(result.historicalFinances).toEqual([
      { fiscalYear: "2024/3", revenue: 100, operatingIncome: 20, netIncome: 15, eps: 5, dps: 2 },
    ]);
  });

  it("repairs a missing figure from the baseline row of the same fiscal year", () => {
    const baseRow = baseline.historicalFinances[0];
    const result = sanitizeStockFundamentals(
      {
        ticker: "7203",
        price: 3000,
        historicalFinances: [
          { fiscalYear: baseRow.fiscalYear, revenue: null, operatingIncome: 20, netIncome: 15, eps: 5, dps: 2 },
        ],
      },
      baseline,
      "7203",
    );
    expect(result.historicalFinances[0].revenue).toBe(baseRow.revenue);
    expect(Number.isFinite(result.historicalFinances[0].revenue)).toBe(true);
  });

  it("drops a row that cannot be repaired instead of crashing the render", () => {
    const result = sanitizeStockFundamentals(
      {
        ticker: "7203",
        price: 3000,
        historicalFinances: [
          // No baseline row exists for this fiscal year, so the missing
          // figures cannot be repaired.
          { fiscalYear: "2099/3", revenue: null },
          { fiscalYear: "2098/3", revenue: "not a number" },
        ],
      },
      baseline,
      "7203",
    );
    expect(result.historicalFinances).toEqual([]);
  });

  it("never yields a non-finite numeric field", () => {
    const result = sanitizeStockFundamentals(
      {
        ticker: "7203",
        price: 3000,
        historicalFinances: [
          { fiscalYear: "2099/3", revenue: undefined, operatingIncome: undefined },
          { fiscalYear: "not-a-year", revenue: 1, operatingIncome: 1, netIncome: 1, eps: 1, dps: 1 },
          null,
          "nonsense",
        ],
      },
      baseline,
      "7203",
    );
    for (const row of result.historicalFinances) {
      for (const value of [row.revenue, row.operatingIncome, row.netIncome, row.eps, row.dps]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("falls back to the baseline when the payload carries no rows at all", () => {
    const result = sanitizeStockFundamentals({ ticker: "7203", price: 3000 }, baseline, "7203");
    expect(result.historicalFinances).toEqual(baseline.historicalFinances);
  });

  it("keeps the fiscal rows renderable as the UI does it", () => {
    // The detail page calls `f.revenue.toLocaleString()`. A row that survived
    // sanitization must therefore never contain null/undefined.
    const result = sanitizeStockFundamentals(
      {
        ticker: "7203",
        price: 3000,
        historicalFinances: [{ fiscalYear: "2099/3", revenue: null }],
      },
      baseline,
      "7203",
    );
    for (const row of result.historicalFinances) {
      expect(() => row.revenue.toLocaleString()).not.toThrow();
    }
  });
});

describe("a non-positive price is not accepted as a live quote", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back to the baseline instead of caching a zero price", async () => {
    // The fetch path is only taken in a browser-like environment.
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticker: "7203", price: 0, change: 0, changePercent: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStockFundamentals("7203");
    const baseline = getStockFundamentals("7203");

    // The screener path already rejected a non-positive price. Accepting it
    // here made the two endpoints of the same Worker disagree and cached a
    // ¥0 quote that was then rendered as the live price.
    expect(result.price).not.toBe(0);
    expect(result.price).toBe(baseline.price);
    expect(result.isDemoData).toBe(true);
  });

  it("accepts a positive price as a live quote", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticker: "9984", price: 9999, change: 10, changePercent: 0.1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStockFundamentals("9984");
    expect(result.price).toBe(9999);
    expect(result.isDemoData).toBeUndefined();
  });
});
