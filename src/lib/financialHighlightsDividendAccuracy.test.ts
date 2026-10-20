import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { getStockFundamentals } from "./marketDataService";
import {
  fetchLiveStockFundamentals,
  fetchLiveScreenerUniverse,
  resetYahooCrumbCache,
} from "../../worker/internal";

/**
 * Deterministic Yahoo Finance test double.
 *
 * The screener universe and the fundamentals helper both talk to Yahoo. A
 * test that lets those requests escape silently asserts whatever the network
 * happened to answer (or the fallback path when there is no egress), so every
 * Yahoo URL is answered from a fixed table here. The stub reports "no live
 * data", which is exactly the situation the dividend guard has to survive.
 */
function stubYahooFinanceWithoutLiveData(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
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
    }),
  );
}

describe("Financial Highlights Dividend Accuracy Tests", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
    stubYahooFinanceWithoutLiveData();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("guarantees 0 dps and 0% yield for zero-dividend stocks in getStockFundamentals", () => {
    // 6723 (Renesas Electronics) is a known zero-dividend stock in anchors
    const renesas = getStockFundamentals("6723");
    expect(renesas.dividendYield).toBe(0.0);
    expect(renesas.dps).toBe(0.0);
    expect(renesas.historicalFinances).toBeDefined();
    expect(renesas.historicalFinances.length).toBeGreaterThan(0);

    // All years in historical finances must have dps === 0
    for (const h of renesas.historicalFinances) {
      expect(h.dps).toBe(0);
    }

    // TSLA is also a zero-dividend US stock
    const tsla = getStockFundamentals("TSLA");
    expect(tsla.dividendYield).toBe(0.0);
    expect(tsla.dps).toBe(0.0);
    expect(tsla.historicalFinances.length).toBeGreaterThan(0);
    for (const h of tsla.historicalFinances) {
      expect(h.dps).toBe(0);
    }

    // AMZN is also a zero-dividend US stock
    const amzn = getStockFundamentals("AMZN");
    expect(amzn.dividendYield).toBe(0.0);
    expect(amzn.dps).toBe(0.0);
    expect(amzn.historicalFinances.length).toBeGreaterThan(0);
    for (const h of amzn.historicalFinances) {
      expect(h.dps).toBe(0);
    }
  });

  it("never produces fake fallback 50 dps for zero dividend stocks in screener universe", async () => {
    const universe = await fetchLiveScreenerUniverse();

    // The universe is built from the popular-stock presets, so the two
    // zero-dividend US stocks must be present. A missing entry would silently
    // skip every dividend assertion below, so its absence is a failure.
    const tsla = universe.find((s) => s.ticker === "TSLA");
    expect(tsla).toBeDefined();
    expect(tsla!.dividendYield).toBe(0);
    expect(tsla!.dps).toBe(0);
    expect(tsla!.historicalFinances.length).toBeGreaterThan(0);
    for (const h of tsla!.historicalFinances) {
      expect(h.dps).toBe(0);
    }

    const amzn = universe.find((s) => s.ticker === "AMZN");
    expect(amzn).toBeDefined();
    expect(amzn!.dividendYield).toBe(0);
    expect(amzn!.dps).toBe(0);
    expect(amzn!.historicalFinances.length).toBeGreaterThan(0);
    for (const h of amzn!.historicalFinances) {
      expect(h.dps).toBe(0);
    }
  });

  it("ensures live fundamentals handle 0 dividendYield by forcing dps to 0", async () => {
    // Fetch live fundamentals for TSLA (guaranteed zero dividend). With no
    // Yahoo quote available the anchor is served, and the guard under test is
    // that a 0% yield can never be paired with a non-zero dps.
    const liveTsla = await fetchLiveStockFundamentals("TSLA");
    expect(liveTsla.ticker).toBe("TSLA");
    expect(liveTsla.dividendYield).toBe(0);
    expect(liveTsla.dps).toBe(0);
    expect(liveTsla.historicalFinances.length).toBeGreaterThan(0);
    for (const h of liveTsla.historicalFinances) {
      expect(h.dps).toBe(0);
    }
  });

  it("preserves cent-level decimal precision for US stocks in historical finances", () => {
    const nvda = getStockFundamentals("NVDA");
    expect(nvda.market).toBe("US");
    expect(nvda.historicalFinances.length).toBeGreaterThan(0);
    // Historical finances should keep decimals like 0.16 and 0.20, not rounded to 0
    expect(nvda.historicalFinances[0].dps).toBe(0.16);
    expect(nvda.historicalFinances[nvda.historicalFinances.length - 1].dps).toBe(0.20);

    const msft = getStockFundamentals("MSFT");
    expect(msft.market).toBe("US");
    expect(msft.dps).toBe(3.3);
    expect(msft.historicalFinances.length).toBeGreaterThanOrEqual(4);
    expect(msft.historicalFinances[0].dps).toBe(2.48);
    expect(msft.historicalFinances[1].dps).toBe(2.72);
    expect(msft.historicalFinances[2].dps).toBe(3.00);
    expect(msft.historicalFinances[3].dps).toBe(3.30);
  });
});
