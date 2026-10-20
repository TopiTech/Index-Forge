import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { BASELINE_ASSET_QUOTES } from "../data/marketConstants";
import { OVERVIEW_ASSET_DEFS, fetchLiveStockFundamentals } from "../../worker/internal-impl";
import { resetYahooCrumbCache } from "../../worker/internal";

/**
 * Deterministic Yahoo Finance test double.
 *
 * `fetchLiveStockFundamentals` reaches out to Yahoo for the quote, the crumb
 * and the chart. Letting those requests escape makes the suite depend on
 * network egress (and on Yahoo's rate limiter), so every Yahoo URL is
 * answered from a fixed table here. The stub deliberately reports "no live
 * data", which is the documented fallback path: the Worker must then serve
 * the baseline proxy asset.
 */
function stubYahooFinanceWithoutLiveData(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://fc.yahoo.com")) {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "A1=test-cookie; Path=/; Domain=.yahoo.com" },
      });
    }
    if (url.includes("/v1/test/getcrumb")) {
      return new Response("test-crumb", { status: 200 });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

describe("Index ETF Proxy Support (TOPIX: 1308.T, TOPIX Growth 250: 2516.T)", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps ^TOPX to 1308.T and ^TOPIXG to 2516.T in BASELINE_ASSET_QUOTES", () => {
    const topix = BASELINE_ASSET_QUOTES.find((a) => a.symbol === "^TOPX");
    expect(topix).toBeDefined();
    expect(topix!.querySymbol).toBe("1308.T");
    expect(topix!.category).toBe("INDEX");
    expect(topix!.currency).toBe("JPY");

    const growth = BASELINE_ASSET_QUOTES.find((a) => a.symbol === "^TOPIXG");
    expect(growth).toBeDefined();
    expect(growth!.querySymbol).toBe("2516.T");
    expect(growth!.category).toBe("INDEX");
    expect(growth!.currency).toBe("JPY");
  });

  it("propagates proxy querySymbols to OVERVIEW_ASSET_DEFS in worker", () => {
    const topixDef = OVERVIEW_ASSET_DEFS.find((d) => d.symbol === "^TOPX");
    expect(topixDef).toBeDefined();
    expect(topixDef!.querySymbol).toBe("1308.T");

    const growthDef = OVERVIEW_ASSET_DEFS.find((d) => d.symbol === "^TOPIXG");
    expect(growthDef).toBeDefined();
    expect(growthDef!.querySymbol).toBe("2516.T");
  });

  it("queries the 1308.T proxy symbol for ^TOPX instead of the raw index symbol", async () => {
    const fetchSpy = stubYahooFinanceWithoutLiveData();

    await fetchLiveStockFundamentals("^TOPX");

    const requestedUrls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls.length).toBeGreaterThan(0);
    expect(requestedUrls.some((url) => url.includes("1308.T"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("%5ETOPX"))).toBe(false);
  });

  it("falls back to the baseline proxy asset in fetchLiveStockFundamentals for ^TOPX when Yahoo has no live quote", async () => {
    stubYahooFinanceWithoutLiveData();
    const topix = BASELINE_ASSET_QUOTES.find((a) => a.symbol === "^TOPX")!;

    const data = await fetchLiveStockFundamentals("^TOPX");

    expect(data).toBeDefined();
    expect(data.ticker).toBe("^TOPX");
    expect(data.name).toContain("TOPIX");
    expect(data.market).toBe("PRIME");
    // No live quote was available, so the declared baseline is served.
    expect(data.price).toBe(topix.baselinePrice);
    expect(data.price).toBeGreaterThan(0);
    expect(Number.isFinite(data.change)).toBe(true);
    expect(data.change).toBe(topix.baselineChange);
  });

  it("falls back to the baseline proxy asset in fetchLiveStockFundamentals for ^TOPIXG when Yahoo has no live quote", async () => {
    stubYahooFinanceWithoutLiveData();
    const growth = BASELINE_ASSET_QUOTES.find((a) => a.symbol === "^TOPIXG")!;

    const data = await fetchLiveStockFundamentals("^TOPIXG");

    expect(data).toBeDefined();
    expect(data.ticker).toBe("^TOPIXG");
    expect(data.name).toContain("東証グロース250");
    expect(data.market).toBe("PRIME");
    expect(data.price).toBe(growth.baselinePrice);
    expect(data.price).toBeGreaterThan(0);
    expect(Number.isFinite(data.change)).toBe(true);
    expect(data.change).toBe(growth.baselineChange);
  });
});
