import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  AUTH_SERVICE_UNAVAILABLE_MESSAGE,
  ADMIN_SESSION_HEADER,
  MAX_SYNC_TICKERS_PER_REQUEST,
  clearMemoryRateLimits,
  fetchLiveMarketCalendarAsync,
  fetchLiveScreenerUniverse,
  fetchLiveStockFundamentals,
  fetchSecEdgarFinancials,
  resetYahooCrumbCache,
  verifyAdminSecretCodeDetailed,
  verifyTurnstileToken,
  type Env,
} from "../../worker/internal";
// These new contracts are deliberately imported from the implementation module:
// `worker/internal.ts` is the published test surface and is outside this task's
// ownership, so this suite does not extend it.
import {
  INVALID_TICKER_VALUE_MESSAGE,
  LOGOUT_RATE_LIMIT_MAX,
  MARKET_CALENDAR_TIMEOUT_BUDGET_MS,
} from "../../worker/internal-impl";
import type { StockQuoteFundamentals } from "../../src/lib/marketDataService";

const REF_DATE = new Date("2026-11-19T00:00:00Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface StubStatement {
  bind: (...params: unknown[]) => StubStatement;
  all: () => Promise<{ results: unknown[]; success: boolean }>;
  run: () => Promise<{ success: boolean; meta: { changes: number } }>;
  first: () => Promise<unknown>;
}

function createDb(onRun?: (sql: string) => void): Env["DB"] {
  const makeStatement = (sql: string): StubStatement => {
    const stmt = {} as StubStatement;
    stmt.bind = () => stmt;
    stmt.all = async () => ({ results: [], success: true });
    stmt.run = async () => {
      onRun?.(sql);
      return { success: true, meta: { changes: 1 } };
    };
    stmt.first = async () => null;
    return stmt;
  };
  return {
    prepare: (sql: string) => makeStatement(sql),
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true })),
  } as unknown as Env["DB"];
}

function createEnv(db: Env["DB"], overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response(null, { status: 200 }) } as unknown as Env["ASSETS"],
    DB: db,
    ...overrides,
  };
}

/** Answer only the Yahoo crumb handshake; every other URL is handled by the caller. */
function crumbFetch(
  onOther: (url: string) => Promise<Response> | Response,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
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
    return onOther(url);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const previousStock: StockQuoteFundamentals = {
  ticker: "7203",
  name: "トヨタ自動車",
  theme: "自動車",
  sector: "輸送用機器",
  market: "PRIME",
  price: 1000,
  change: 1,
  changePercent: 0.1,
  volume: 7_654_321,
  previousClose: 999,
  dayHigh: 1010,
  dayLow: 990,
  yearHigh: 1800,
  yearLow: 800,
  marketCap: 999_999,
  per: 88,
  pbr: 7,
  dividendYield: 9,
  roe: 33,
  equityRatio: 71,
  eps: 44,
  dps: 99,
  technicalSignal: "BUY",
  historicalFinances: [],
};

function prevWithLiveMetrics(): StockQuoteFundamentals {
  return { ...previousStock };
}

describe("W1: one shared deadline for the live market calendar", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exports an 8000ms overall budget", () => {
    expect(MARKET_CALENDAR_TIMEOUT_BUDGET_MS).toBe(8000);
  });

  it("stops the quoteSummary completion loop at the deadline and still returns fallback events", async () => {
    let currentTime = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    let summaryCalls = 0;

    crumbFetch((url) => {
      if (url.includes("biquote.io")) return jsonResponse([]);
      if (url.includes("/v7/finance/quote")) {
        // The batch itself consumes most of the shared budget.
        currentTime += 5000;
        return jsonResponse({ quoteResponse: { result: [] } });
      }
      if (url.includes("/v10/finance/quoteSummary/")) {
        summaryCalls += 1;
        // The first completion exhausts the remaining budget.
        currentTime += 4000;
        return jsonResponse({ quoteSummary: { result: [] } });
      }
      return jsonResponse({});
    });

    const events = await fetchLiveMarketCalendarAsync(undefined, REF_DATE, 8000);

    expect(summaryCalls).toBe(1);
    expect(events.length).toBeGreaterThan(0);
  });

  it("skips every external call when the budget is already spent but returns the fallback calendar", async () => {
    const fetchSpy = crumbFetch(() => jsonResponse({}));

    const events = await fetchLiveMarketCalendarAsync(undefined, REF_DATE, 0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("W2: fundamentals deadline reaches crumb and SEC", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not start the crumb fallback request after the caller budget is exhausted", async () => {
    let currentTime = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://fc.yahoo.com")) {
        // The first crumb leg burns the entire 1000ms caller budget.
        currentTime += 2000;
        return new Response("", { status: 200 });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchLiveStockFundamentals("AAPL", undefined, 1000);

    const crumbCalls = fetchSpy.mock.calls.filter(([input]) =>
      String(input).includes("/v1/test/getcrumb"),
    );
    expect(crumbCalls).toHaveLength(0);
    expect(result.ticker).toBe("AAPL");
  });

  it("SEC helper skips the network when its deadline has passed", async () => {
    const fetchSpy = crumbFetch(() => jsonResponse({}));
    fetchSpy.mockClear();

    const finances = await fetchSecEdgarFinancials("AAPL", Date.now());

    expect(finances).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still supports the historical one-argument SEC call", async () => {
    const fetchSpy = crumbFetch(() =>
      jsonResponse({
        facts: {
          "us-gaap": {
            Revenues: {
              units: {
                USD: [{ form: "10-K", fy: 2025, val: 1_000_000_000, fp: "FY" }],
              },
            },
          },
        },
      }),
    );

    const finances = await fetchSecEdgarFinancials("AAPL");

    expect(finances.length).toBe(1);
    expect(finances[0]?.revenue).toBe(1000);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("W3/W5: live screener provenance", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports missing live fields as explicit zeros instead of price-derived placeholders", async () => {
    crumbFetch((url) => {
      if (url.includes("/v7/finance/quote")) {
        return jsonResponse({
          quoteResponse: { result: [{ symbol: "7203.T", regularMarketPrice: 3000 }] },
        });
      }
      return jsonResponse({});
    });

    const universe = await fetchLiveScreenerUniverse([prevWithLiveMetrics()]);
    const toyota = universe.find((item) => item.ticker === "7203");
    expect(toyota).toBeDefined();

    // The only real field in this quote is the price. Everything else must be
    // the contract's explicit missing value, never a live-price fabrication.
    expect(toyota!.price).toBe(3000);
    expect(toyota!.volume).toBe(0);
    expect(toyota!.previousClose).toBe(0);
    expect(toyota!.dayHigh).toBe(0);
    expect(toyota!.dayLow).toBe(0);
    expect(toyota!.yearHigh).toBe(0);
    expect(toyota!.yearLow).toBe(0);
    expect(toyota!.marketCap).toBe(0);

    // No valuation field may be inherited from the previous snapshot either.
    expect(toyota!.per).toBeNull();
    expect(toyota!.pbr).toBeNull();
    expect(toyota!.dividendYield).toBeNull();
    expect(toyota!.dps).toBeNull();
    expect(toyota!.eps).toBeNull();
    expect(toyota!.roe).toBeNull();
    expect(toyota!.equityRatio).toBeNull();
  });

  it("uses only current-quote valuation inputs and never the previous roe/equity", async () => {
    crumbFetch((url) => {
      if (url.includes("/v7/finance/quote")) {
        return jsonResponse({
          quoteResponse: {
            result: [
              {
                symbol: "7203.T",
                regularMarketPrice: 2000,
                forwardPE: 12.5,
                priceToBook: 1.5,
                dividendYield: 2,
                epsTrailingTwelveMonths: 160,
              },
            ],
          },
        });
      }
      return jsonResponse({});
    });

    const universe = await fetchLiveScreenerUniverse([prevWithLiveMetrics()]);
    const toyota = universe.find((item) => item.ticker === "7203");
    expect(toyota).toBeDefined();
    expect(toyota!.per).toBe(12.5);
    expect(toyota!.pbr).toBe(1.5);
    expect(toyota!.dividendYield).toBe(2);
    expect(toyota!.eps).toBe(160);
    // Neither field is published by the quote endpoint and both were present
    // in the previous row: carrying them over would relabel stale data live.
    expect(toyota!.roe).toBeNull();
    expect(toyota!.equityRatio).toBeNull();
  });

  it("marks a reused previous snapshot as stale when this run got no quote", async () => {
    crumbFetch((url) => {
      if (url.includes("/v7/finance/quote")) {
        return jsonResponse({ quoteResponse: { result: [] } });
      }
      return jsonResponse({});
    });

    const universe = await fetchLiveScreenerUniverse([prevWithLiveMetrics()]);
    const toyota = universe.find((item) => item.ticker === "7203");
    expect(toyota?.isDemoData).toBe(true);
  });
});

describe("W4: logout write budget without changing the idempotent response", () => {
  beforeEach(() => {
    clearMemoryRateLimits();
  });

  afterEach(() => {
    clearMemoryRateLimits();
    vi.unstubAllGlobals();
  });

  it("allows 30 revocation writes per IP, then skips the DELETE but keeps {ok:true}", async () => {
    let deleteCount = 0;
    const env = createEnv(
      createDb((sql) => {
        if (sql.includes("DELETE FROM admin_sessions")) deleteCount += 1;
      }),
    );

    for (let i = 0; i < LOGOUT_RATE_LIMIT_MAX + 1; i += 1) {
      const response = await worker.fetch(
        new Request("https://example.com/api/auth/logout", {
          method: "POST",
          headers: {
            "cf-connecting-ip": "198.51.100.44",
            [ADMIN_SESSION_HEADER]: "a-session-token",
          },
        }),
        env,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }

    expect(deleteCount).toBe(LOGOUT_RATE_LIMIT_MAX);
  });

  it("tracks the logout budget per IP", async () => {
    let deleteCount = 0;
    const env = createEnv(
      createDb((sql) => {
        if (sql.includes("DELETE FROM admin_sessions")) deleteCount += 1;
      }),
    );
    const requestFor = (ip: string) =>
      new Request("https://example.com/api/auth/logout", {
        method: "POST",
        headers: {
          "cf-connecting-ip": ip,
          [ADMIN_SESSION_HEADER]: "a-session-token",
        },
      });

    for (let i = 0; i < LOGOUT_RATE_LIMIT_MAX; i += 1) {
      await worker.fetch(requestFor("198.51.100.45"), env);
    }
    await worker.fetch(requestFor("198.51.100.46"), env);

    expect(deleteCount).toBe(LOGOUT_RATE_LIMIT_MAX + 1);
  });
});

describe("W6: Turnstile outages are 503 infrastructure failures", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks a siteverify network failure as unavailable with a real secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("siteverify offline");
      }),
    );

    const result = await verifyTurnstileToken("real-secret-key", "token", undefined, false);

    expect(result.success).toBe(false);
    expect(result.unavailable).toBe(true);
  });

  it("marks a siteverify 5xx as unavailable with a real secret", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 503 })));

    const result = await verifyTurnstileToken("real-secret-key", "token", undefined, false);

    expect(result.success).toBe(false);
    expect(result.unavailable).toBe(true);
  });

  it("keeps the test-key mock-token conveniences unchanged", async () => {
    const fetchSpy = vi.fn(async () => new Response("oops", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyTurnstileToken(undefined, "dummy-turnstile-token", undefined, true);

    expect(result).toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("admin-login answers 503 with the shared service-unavailable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("siteverify offline");
      }),
    );
    const env = createEnv(createDb(), { TURNSTILE_SECRET_KEY: "real-secret-key" });
    const request = new Request("https://indexforge.example.com/api/auth/admin-login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.9",
      },
      body: JSON.stringify({
        password: "password",
        secretCode: "secret",
        turnstileToken: "token",
      }),
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: AUTH_SERVICE_UNAVAILABLE_MESSAGE,
    });
  });
});

describe("W7: sync-prices rejects oversized input before normalization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the cap error even when every ticker is invalid", async () => {
    const env = createEnv(createDb());
    const request = new Request("https://indexforge.example.com/api/sync-prices", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: JSON.stringify({
        tickers: Array.from({ length: MAX_SYNC_TICKERS_PER_REQUEST + 1 }, () => "<invalid>"),
      }),
    });

    const response = await worker.fetch(request, env);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain(`最大${MAX_SYNC_TICKERS_PER_REQUEST}件`);
    expect(body.error).not.toBe(INVALID_TICKER_VALUE_MESSAGE);
  });
});

describe("N1: production Turnstile config never advertises the test key", () => {
  it("reports unavailable on a production host when no site key is configured", async () => {
    const env = createEnv(createDb());
    const request = new Request("https://indexforge.example.com/api/auth/turnstile-config");

    const response = await worker.fetch(request, env);
    const body = (await response.json()) as { siteKey?: string; unavailable?: boolean };

    expect(response.status).toBe(200);
    expect(body.siteKey).toBe("");
    expect(body.unavailable).toBe(true);
  });

  it("keeps the test key on a local host", async () => {
    const env = createEnv(createDb());
    const request = new Request("http://localhost/api/auth/turnstile-config");

    const response = await worker.fetch(request, env);
    const body = (await response.json()) as { siteKey?: string; unavailable?: boolean };

    expect(body.siteKey).toBeTruthy();
    expect(body.unavailable).toBeUndefined();
  });
});

describe("I6: a missing ADMIN_SECRET_CODE is reported as unconfigured, not a wrong code", () => {
  it("returns an actionable unavailable result outside local/test contexts", async () => {
    const env = createEnv(createDb());

    const result = await verifyAdminSecretCodeDetailed(env, "any-code", false);

    expect(result.valid).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.error).toContain("ADMIN_SECRET_CODE");
  });
});

describe("L6: Worker fundamentals keep the market category for macro assets", () => {
  it("does not label indices, FX or crypto as US equities", async () => {
    const [index, fx, crypto] = await Promise.all([
      fetchLiveStockFundamentals("^N225", undefined, 0),
      fetchLiveStockFundamentals("USDJPY=X", undefined, 0),
      fetchLiveStockFundamentals("BTC-USD", undefined, 0),
    ]);

    expect(index.market).toBe("INDEX");
    expect(fx.market).toBe("FX");
    expect(crypto.market).toBe("CRYPTO");
  });
});
