import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensurePasswordTable,
  resetPasswordTableEnsured,
  getPasswordTableProvisionFailedAt,
  PROVISION_RETRY_INTERVAL_MS,
  getYahooCrumb,
  resetYahooCrumbCache,
  getYahooCrumbNegativeCacheUntil,
  YAHOO_CRUMB_NEGATIVE_CACHE_MS,
  fetchLiveStockFundamentals,
  STOCK_FUNDAMENTALS_TIMEOUT_BUDGET_MS,
  type Env,
} from "../../worker/internal";

type Decision =
  | { kind: "all"; results: unknown[] }
  | { kind: "run"; changes?: number }
  | { kind: "throw"; error: Error };

type Router = (sql: string, params: unknown[]) => Decision | undefined;

function defaultDecision(sql: string): Decision {
  if (sql.includes("FROM sqlite_master")) {
    return {
      kind: "all",
      results: [],
    };
  }
  if (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) {
    return { kind: "all", results: [] };
  }
  return { kind: "run" };
}

function createMockDb(router: Router = () => undefined) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const decide = (sql: string, params: unknown[]): Decision => {
    executed.push({ sql, params });
    return router(sql, params) ?? defaultDecision(sql);
  };
  const makeStatement = (sql: string) => {
    let params: unknown[] = [];
    const execAll = async () => {
      const decision = decide(sql, params);
      if (decision.kind === "throw") throw decision.error;
      return {
        results: decision.kind === "all" ? decision.results : [],
        success: true,
      };
    };
    const execRun = async () => {
      const decision = decide(sql, params);
      if (decision.kind === "throw") throw decision.error;
      return {
        success: true,
        meta: { changes: decision.kind === "run" ? (decision.changes ?? 1) : 1 },
      };
    };
    const statement = {
      bind: (...args: unknown[]) => {
        params = args;
        return statement;
      },
      all: execAll,
      run: execRun,
    };
    return statement;
  };
  const db = {
    prepare: (sql: string) => makeStatement(sql),
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true })),
  };
  return { db: db as unknown as Env["DB"], executed };
}

function createMockEnv(db: Env["DB"]): Env {
  return {
    ASSETS: { fetch: async () => new Response(null) } as unknown as Env["ASSETS"],
    DB: db,
  };
}

describe("ISSUE-4: ensurePasswordTable Isolate Global Fault Latch Cooldown Recovery", () => {
  beforeEach(() => {
    resetPasswordTableEnsured();
    vi.useRealTimers();
  });

  afterEach(() => {
    resetPasswordTableEnsured();
    vi.restoreAllMocks();
  });

  it("exports PROVISION_RETRY_INTERVAL_MS as 30,000 ms", () => {
    expect(PROVISION_RETRY_INTERVAL_MS).toBe(30_000);
  });

  it("cooldowns retry on failure and allows retry after interval expires", async () => {
    let failDdl = true;
    const { db, executed } = createMockDb((sql) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS access_passwords") && failDdl) {
        return { kind: "throw", error: new Error("D1_SCHEMA_WRITE_FAILED") };
      }
      return undefined;
    });
    const env = createMockEnv(db);

    const baseTime = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(baseTime);

    // First attempt fails and sets failure timestamp
    await ensurePasswordTable(env);
    expect(getPasswordTableProvisionFailedAt()).toBe(baseTime);
    const initialDdlCount = executed.length;
    expect(initialDdlCount).toBeGreaterThan(0);

    // Second attempt within cooldown (10s later): should be skipped
    vi.spyOn(Date, "now").mockReturnValue(baseTime + 10_000);
    await ensurePasswordTable(env);
    expect(executed.length).toBe(initialDdlCount);

    // Third attempt after cooldown expires (31s later): should retry
    vi.spyOn(Date, "now").mockReturnValue(baseTime + 31_000);
    failDdl = false; // D1 recovers
    await ensurePasswordTable(env);

    expect(executed.length).toBeGreaterThan(initialDdlCount);
    // After successful provisioning, failed timestamp is cleared to 0
    expect(getPasswordTableProvisionFailedAt()).toBe(0);

    // Subsequent call succeeds immediately without re-executing DDL
    const afterSuccessCount = executed.length;
    await ensurePasswordTable(env);
    expect(executed.length).toBe(afterSuccessCount);
  });

  it("resets failed timestamp when resetPasswordTableEnsured is called", async () => {
    const { db } = createMockDb((sql) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS access_passwords")) {
        return { kind: "throw", error: new Error("D1_SCHEMA_FAILED") };
      }
      return undefined;
    });
    const env = createMockEnv(db);

    await ensurePasswordTable(env);
    expect(getPasswordTableProvisionFailedAt()).toBeGreaterThan(0);

    resetPasswordTableEnsured();
    expect(getPasswordTableProvisionFailedAt()).toBe(0);
  });
});

describe("ISSUE-5: Yahoo Crumb Negative Cache", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
    vi.useRealTimers();
  });

  afterEach(() => {
    resetYahooCrumbCache();
    vi.restoreAllMocks();
  });

  it("exports YAHOO_CRUMB_NEGATIVE_CACHE_MS as 30,000 ms", () => {
    expect(YAHOO_CRUMB_NEGATIVE_CACHE_MS).toBe(30_000);
  });

  it("sets negative cache on failure and skips external network fetch during cooldown", async () => {
    let fetchCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return new Response("Not Found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const baseTime = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(baseTime);

    // First attempt fails and sets negative cache
    const result1 = await getYahooCrumb();
    expect(result1).toBeNull();
    // A single getYahooCrumb attempt makes up to 3 fetch calls (fc.yahoo.com, query2 getcrumb, query1 getcrumb)
    expect(fetchCount).toBe(3);
    expect(getYahooCrumbNegativeCacheUntil()).toBe(baseTime + YAHOO_CRUMB_NEGATIVE_CACHE_MS);

    // Second attempt within cooldown (15s later): should immediately return null without calling fetch
    vi.spyOn(Date, "now").mockReturnValue(baseTime + 15_000);
    const result2 = await getYahooCrumb();
    expect(result2).toBeNull();
    expect(fetchCount).toBe(3); // Unchanged: negative cache prevented network calls

    // With forceRefresh = true: bypasses negative cache and attempts fetch
    const resultForced = await getYahooCrumb(true);
    expect(resultForced).toBeNull();
    expect(fetchCount).toBe(6);
    // Negative cache was re-extended from baseTime + 15_000 to baseTime + 45_000
    expect(getYahooCrumbNegativeCacheUntil()).toBe(baseTime + 15_000 + YAHOO_CRUMB_NEGATIVE_CACHE_MS);

    // Still within new negative cache window (30s after start, i.e. 45s deadline not reached): skipped
    vi.spyOn(Date, "now").mockReturnValue(baseTime + 30_000);
    const resultStillCached = await getYahooCrumb();
    expect(resultStillCached).toBeNull();
    expect(fetchCount).toBe(6);

    // After new negative cache window expires (50s after start): attempts fetch again
    vi.spyOn(Date, "now").mockReturnValue(baseTime + 50_000);
    const result3 = await getYahooCrumb();
    expect(result3).toBeNull();
    expect(fetchCount).toBe(9);
  });

  it("clears negative cache and caches crumb on success", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("fc.yahoo.com")) {
        const headers = new Headers();
        headers.set("set-cookie", "A3=d=AQABB; Path=/; Domain=.yahoo.com");
        return new Response(null, { status: 302, headers });
      }
      if (urlStr.includes("getcrumb")) {
        return new Response("valid_crumb_12345", { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const baseTime = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(baseTime);

    const auth = await getYahooCrumb();
    expect(auth).toEqual({
      crumb: "valid_crumb_12345",
      cookie: "A3=d=AQABB",
    });
    expect(getYahooCrumbNegativeCacheUntil()).toBe(0);

    // Subsequent call within expiry returns cached result without fetch
    const callsBefore = fetchMock.mock.calls.length;
    const cached = await getYahooCrumb();
    expect(cached).toEqual(auth);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("clears negative cache on resetYahooCrumbCache", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network down"));
    vi.stubGlobal("fetch", fetchMock);

    await getYahooCrumb();
    expect(getYahooCrumbNegativeCacheUntil()).toBeGreaterThan(0);

    resetYahooCrumbCache();
    expect(getYahooCrumbNegativeCacheUntil()).toBe(0);
  });
});

describe("ISSUE-6: fetchLiveStockFundamentals Overall Timeout Budget", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
    vi.useRealTimers();
  });

  afterEach(() => {
    resetYahooCrumbCache();
    vi.restoreAllMocks();
  });

  it("exports STOCK_FUNDAMENTALS_TIMEOUT_BUDGET_MS as 6500 ms", () => {
    expect(STOCK_FUNDAMENTALS_TIMEOUT_BUDGET_MS).toBe(6500);
  });

  it("skips external network calls and safely falls back to baseline when budget is zero", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Call with 0ms budget (deadline is immediately reached)
    const result = await fetchLiveStockFundamentals("7203", undefined, 0);

    // Network fetch was never invoked because budget was already exhausted
    expect(fetchMock).not.toHaveBeenCalled();
    // Safely returned baseline fundamentals without errors
    expect(result.ticker).toBe("7203");
    expect(typeof result.name).toBe("string");
    expect(result.price).toBeGreaterThan(0);
  });

  it("early-skips secondary fallbacks when budget is exhausted during request", async () => {
    const fetchedUrls: string[] = [];
    const baseTime = 1_700_000_000_000;
    let currentTime = baseTime;

    vi.spyOn(Date, "now").mockImplementation(() => currentTime);

    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      fetchedUrls.push(url);
      // Simulate slow first request that exhausts the deadline budget
      currentTime += 7000;
      return new Response("Service Unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLiveStockFundamentals("AAPL", undefined, 6500);

    // Initial fetch was executed, but because it took 7000ms, deadline (6500ms) was passed.
    // Therefore, Tier 2, Tier 3 (SEC EDGAR), and secondary quote endpoints were skipped.
    const secEdgarCalls = fetchedUrls.filter((u) => u.includes("sec.gov"));
    const altQuoteCalls = fetchedUrls.filter((u) => u.includes("query1.finance.yahoo.com/v7/finance/quote"));
    expect(secEdgarCalls.length).toBe(0);
    expect(altQuoteCalls.length).toBe(0);

    // Safe response returned
    expect(result.ticker).toBe("AAPL");
    expect(result.name).toBe("Apple");
    expect(result.price).toBeGreaterThan(0);
  });
});
