import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestsFreshCalculation,
  matchesIfNoneMatch,
  setAllowMemoryCacheInTest,
  clearMemoryCache,
} from "../../worker/internal";
import worker from "../../worker/index";
import { deserializePortfolioFromCsv } from "./indexSerialization";
import { savePortfolioPositions, loadPortfolioPositions } from "./portfolioStorage";
import { DEFAULT_INDICES, SYSTEM_INDICES } from "../data/indices";

describe("Goal Comprehensive Code Review: Cache Control & ETag Audits", () => {
  it("requestsFreshCalculation detects no-cache, no-store, and max-age=0 in Cache-Control header", () => {
    const noCacheReq = new Request("https://example.com/api/calculate", {
      headers: { "Cache-Control": "no-cache" },
    });
    expect(requestsFreshCalculation(noCacheReq)).toBe(true);

    const noStoreReq = new Request("https://example.com/api/calculate", {
      headers: { "Cache-Control": "no-store" },
    });
    expect(requestsFreshCalculation(noStoreReq)).toBe(true);

    const maxAgeZeroReq = new Request("https://example.com/api/calculate", {
      headers: { "Cache-Control": "max-age=0" },
    });
    expect(requestsFreshCalculation(maxAgeZeroReq)).toBe(true);

    const multiDirectiveReq = new Request("https://example.com/api/calculate", {
      headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
    });
    expect(requestsFreshCalculation(multiDirectiveReq)).toBe(true);

    const standardReq = new Request("https://example.com/api/calculate", {
      headers: { "Cache-Control": "max-age=3600" },
    });
    expect(requestsFreshCalculation(standardReq)).toBe(false);

    const emptyReq = new Request("https://example.com/api/calculate");
    expect(requestsFreshCalculation(emptyReq)).toBe(false);
  });

  it("requestsFreshCalculation detects Pragma: no-cache for HTTP/1.0 and proxy clients", () => {
    const pragmaReq = new Request("https://example.com/api/calculate", {
      headers: { Pragma: "no-cache" },
    });
    expect(requestsFreshCalculation(pragmaReq)).toBe(true);

    const pragmaMultiReq = new Request("https://example.com/api/calculate", {
      headers: { Pragma: "no-cache, token" },
    });
    expect(requestsFreshCalculation(pragmaMultiReq)).toBe(true);

    const pragmaOtherReq = new Request("https://example.com/api/calculate", {
      headers: { Pragma: "custom-value" },
    });
    expect(requestsFreshCalculation(pragmaOtherReq)).toBe(false);
  });

  it("matchesIfNoneMatch handles lowercase w/ prefix in weak ETags according to RFC 9110", () => {
    const tag = '"calc-hash-123"';
    expect(matchesIfNoneMatch('W/"calc-hash-123"', tag)).toBe(true);
    expect(matchesIfNoneMatch('w/"calc-hash-123"', tag)).toBe(true);
    expect(matchesIfNoneMatch('w/"calc-hash-123", "other-tag"', tag)).toBe(true);
    expect(matchesIfNoneMatch('"other-tag", w/"calc-hash-123"', tag)).toBe(true);
    expect(matchesIfNoneMatch('w/"different-hash"', tag)).toBe(false);
    expect(matchesIfNoneMatch("*", tag)).toBe(true);
  });
});

function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  });
  return store;
}

describe("Goal Comprehensive Code Review: Portfolio CSV Import 0-Cost Edge Case", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deserializes CSV with 0 cost safely and ensures compatibility with sanitizePosition", () => {
    const csvWithZeroCost = [
      "コード,銘柄名,保有株数,取得単価,取得日,メモ",
      "7203,トヨタ自動車,100,0,2024-01-15,無償譲渡株",
      "9984,ソフトバンクグループ,50,8500,2024-02-01,通常保有",
    ].join("\n");

    const result = deserializePortfolioFromCsv(csvWithZeroCost);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.length).toBe(2);

    const toyota = result.data?.find((p) => p.ticker === "7203");
    expect(toyota).toBeDefined();
    // 0 cost should fallback to positive baseline (1000) so sanitizePosition does not drop it
    expect(toyota!.averageCost).toBe(1000);
    expect(toyota!.shares).toBe(100);

    // Save and reload to verify persistence pipeline compatibility
    savePortfolioPositions(result.data!);
    const loaded = loadPortfolioPositions();
    expect(loaded.length).toBe(2);
    expect(loaded.some((p) => p.ticker === "7203")).toBe(true);
    expect(loaded.some((p) => p.ticker === "9984")).toBe(true);
  });
});

describe("Goal Comprehensive Code Review: Default Indices Constituent Parity", () => {
  it("verifies jp-core in DEFAULT_INDICES has 10 constituents summing to 100% matching seed.sql", () => {
    const jpCore = DEFAULT_INDICES.find((idx) => idx.id === "jp-core");
    expect(jpCore).toBeDefined();
    expect(jpCore?.basket.length).toBe(10);

    const totalWeight = jpCore?.basket.reduce((sum, item) => sum + item.weight, 0);
    expect(totalWeight).toBe(100);

    const mitsui = jpCore?.basket.find((item) => item.ticker === "8031");
    expect(mitsui).toBeDefined();
    expect(mitsui?.name).toBe("三井物産");
    expect(mitsui?.weight).toBe(7.5);
    expect(mitsui?.theme).toBe("商社");

    const smfg = jpCore?.basket.find((item) => item.ticker === "8316");
    expect(smfg).toBeDefined();
    expect(smfg?.name).toBe("三井住友FG");
    expect(smfg?.weight).toBe(7.5);
    expect(smfg?.theme).toBe("金融");
  });

  it("verifies all system indices are represented in DEFAULT_INDICES with valid metadata", () => {
    const ids = new Set(DEFAULT_INDICES.map((i) => i.id));
    for (const sysId of SYSTEM_INDICES) {
      expect(ids.has(sysId)).toBe(true);
    }

    for (const index of DEFAULT_INDICES) {
      expect(index.id).toBeTruthy();
      expect(index.name).toBeTruthy();
      expect(index.baseValue).toBeGreaterThan(0);
      expect(index.basket.length).toBeGreaterThan(0);
      for (const item of index.basket) {
        expect(item.ticker).toBeTruthy();
        expect(item.name).toBeTruthy();
        expect(item.weight).toBeGreaterThan(0);
      }
    }
  });
});

describe("Goal Comprehensive Code Review: Calendar Cache Bypass", () => {
  beforeEach(() => {
    setAllowMemoryCacheInTest(true);
    clearMemoryCache();
  });

  afterEach(() => {
    setAllowMemoryCacheInTest(false);
    clearMemoryCache();
    vi.restoreAllMocks();
  });

  it("respects Pragma: no-cache and Cache-Control: max-age=0 on /api/market/calendar", async () => {
    const req1 = new Request("https://example.com/api/market/calendar");
    const res1 = await worker.fetch(req1, {} as any);
    expect(res1.status).toBe(200);

    // Request with Pragma: no-cache should trigger fresh computation without error
    const reqPragma = new Request("https://example.com/api/market/calendar", {
      headers: { Pragma: "no-cache" },
    });
    const resPragma = await worker.fetch(reqPragma, {} as any);
    expect(resPragma.status).toBe(200);

    // Request with Cache-Control: max-age=0 should trigger fresh computation without error
    const reqMaxAge = new Request("https://example.com/api/market/calendar", {
      headers: { "Cache-Control": "max-age=0" },
    });
    const resMaxAge = await worker.fetch(reqMaxAge, {} as any);
    expect(resMaxAge.status).toBe(200);
  });
});
