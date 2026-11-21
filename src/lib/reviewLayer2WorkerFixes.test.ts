import { afterEach, describe, expect, it, vi } from "vitest";
import {
  budgetedTimeoutMs,
  fetchLiveStockFundamentals,
  getYahooCrumb,
  isTseStockIdentifier,
  resetYahooCrumbCache,
} from "../../worker/internal";
import { createStubWorkerEnv } from "../test-helpers/env";

afterEach(() => {
  resetYahooCrumbCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BUG-03: budgetedTimeoutMs and zero-budget AbortSignal guards", () => {
  it("computes remaining budget or 0 once deadline has elapsed", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    expect(budgetedTimeoutMs(5000, undefined)).toBe(5000);
    expect(budgetedTimeoutMs(5000, 18_000)).toBe(5000);
    expect(budgetedTimeoutMs(5000, 11_200)).toBe(1200);
    expect(budgetedTimeoutMs(5000, 10_000)).toBe(0);
    expect(budgetedTimeoutMs(5000, 9_500)).toBe(0);
  });

  it("never calls AbortSignal.timeout(0) when budget runs out between fc.yahoo and getcrumb", async () => {
    resetYahooCrumbCache();
    let nowMs = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn(async () => {
      // Simulate fc.yahoo consuming the entire remaining deadline.
      nowMs = 1050;
      return new Response("", {
        status: 302,
        headers: { "set-cookie": "A3=abc; Path=/" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const crumb = await getYahooCrumb(true, 1050);
    expect(crumb).toBeNull();
    // Only fc.yahoo ran (while budget was 50ms); getcrumb was skipped at 0ms.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(timeoutSpy.mock.calls.every((args) => Number(args[0]) > 0)).toBe(true);
  });

  it("skips upstream summary/chart/quote fetches when timeoutBudgetMs is exhausted (0)", async () => {
    const env = createStubWorkerEnv();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLiveStockFundamentals("AAPL", env, 0);
    expect(result.ticker).toBe("AAPL");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
  });
});

describe("BUG-02: Worker TSE identifier classification", () => {
  it("recognizes numeric, .T, TSE:, and TYO: tickers consistently", () => {
    expect(isTseStockIdentifier("7203")).toBe(true);
    expect(isTseStockIdentifier("6758.T")).toBe(true);
    expect(isTseStockIdentifier("TSE:7203")).toBe(true);
    expect(isTseStockIdentifier("tyo:9984")).toBe(true);
    expect(isTseStockIdentifier("AAPL")).toBe(false);
    expect(isTseStockIdentifier("FANUC", "6954.T")).toBe(true);
  });

  it("assigns PRIME/JPY defaults rather than US defaults for TSE: prefixed tickers on fallback", async () => {
    const env = createStubWorkerEnv();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLiveStockFundamentals("TSE:9999", env, 1000);
    expect(result.market).toBe("PRIME");
    expect(result.sector).toBe("その他");
    expect(result.price).toBe(1000);
    // Must never trigger SEC EDGAR lookup for a TSE:-prefixed ticker.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("data.sec.gov"))).toBe(true);
  });
});
