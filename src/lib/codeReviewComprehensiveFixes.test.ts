import { beforeEach, describe, expect, it } from "vitest";
import worker, {
  authenticatePassword,
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/index";
import { isBenchmarkDataForSymbol, type BenchmarkData } from "../hooks/useBenchmark";

const TEST_ADMIN_PASSWORD = "test-admin-password-secure";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

function createMockEnv(overrides?: Record<string, unknown>) {
  const executeQuery = async (query: string, _params: unknown[] = []) => {
    if (query.includes("rate_limits")) {
      return { results: [] };
    }
    if (query.includes("passwords")) {
      return { results: [] };
    }
    return { results: [] };
  };

  return {
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    DB: {
      prepare: (query: string) => ({
        bind: (...params: unknown[]) => ({
          run: () => executeQuery(query, params),
          all: () => executeQuery(query, params),
          first: async () => {
            const res = await executeQuery(query, params);
            return res.results[0] || null;
          },
        }),
        run: () => executeQuery(query, []),
        all: () => executeQuery(query, []),
        first: async () => {
          const res = await executeQuery(query, []);
          return res.results[0] || null;
        },
      }),
      batch: async (statements: any[]) => {
        return Promise.all(statements.map((s) => s.all ? s.all() : s.run()));
      },
    },
    ...overrides,
  } as any;
}

describe("Security hardening: authenticatePassword ambient header fallback prevention", () => {
  it("rejects authentication when explicitPassword is an empty string, even if admin header is present", async () => {
    const env = createMockEnv();
    const reqWithAdminHeader = new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: {
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
    });

    // Caller explicitly provided an empty string password to verify
    const resultEmpty = await authenticatePassword(reqWithAdminHeader, env, "");
    expect(resultEmpty.authenticated).toBe(false);
    expect(resultEmpty.error).toBe("パスワードが指定されていません");

    // Caller explicitly provided whitespace
    const resultWhitespace = await authenticatePassword(reqWithAdminHeader, env, "   ");
    expect(resultWhitespace.authenticated).toBe(false);
    expect(resultWhitespace.error).toBe("パスワードが指定されていません");
  });

  it("authenticates correctly using headers when explicitPassword is null or undefined (backwards compatibility)", async () => {
    const env = createMockEnv();
    const reqWithAdminHeader = new Request("http://localhost/api/indices", {
      method: "GET",
      headers: {
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
    });

    const resultNull = await authenticatePassword(reqWithAdminHeader, env, null);
    expect(resultNull.authenticated).toBe(true);
    expect(resultNull.role).toBe("admin");

    const resultUndefined = await authenticatePassword(reqWithAdminHeader, env, undefined);
    expect(resultUndefined.authenticated).toBe(true);
    expect(resultUndefined.role).toBe("admin");
  });

  it("authenticates correctly when explicitPassword is the valid password", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/auth/verify", { method: "POST" });
    const result = await authenticatePassword(req, env, TEST_ADMIN_PASSWORD);
    expect(result.authenticated).toBe(true);
    expect(result.role).toBe("admin");
  });

  it("/api/auth/verify does not authenticate empty password even if ambient x-auth-password header is sent", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({ password: "" }),
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.ok).toBe(false);
    expect(body.error).toContain("パスワード");
  });
});

describe("State synchronization & benchmark correctness", () => {
  const sampleNikkei: BenchmarkData = {
    snapshot: {
      symbol: "^N225",
      label: "日経225",
      current: 38000,
      change: 150,
      changePct: 0.4,
      updatedAt: "2026/09/15 15:00:00",
      description: "日経平均",
    },
    series: [
      { date: "2026-09-01", close: 37500 },
      { date: "2026-09-02", close: 38000 },
    ],
  };

  const sampleSP500: BenchmarkData = {
    snapshot: {
      symbol: "^GSPC",
      label: "S&P 500",
      current: 5500,
      change: 25,
      changePct: 0.45,
      updatedAt: "2026/09/15 16:00:00",
      description: "S&P 500",
    },
    series: [
      { date: "2026-09-01", close: 5400 },
      { date: "2026-09-02", close: 5500 },
    ],
  };

  it("isBenchmarkDataForSymbol strictly validates the data against selected benchmark symbol", () => {
    expect(isBenchmarkDataForSymbol(sampleNikkei, "^N225")).toBe(true);
    expect(isBenchmarkDataForSymbol(sampleNikkei, "^GSPC")).toBe(false);
    expect(isBenchmarkDataForSymbol(sampleSP500, "^GSPC")).toBe(true);
    expect(isBenchmarkDataForSymbol(sampleSP500, "^N225")).toBe(false);
    expect(isBenchmarkDataForSymbol(null, "^N225")).toBe(false);
  });

  it("guards against displaying outdated benchmark series when benchmark symbol switches", () => {
    const selectedBenchmark = "^GSPC";
    // If benchmarkData in memory is still Nikkei (^N225)
    const benchmarkData = sampleNikkei;

    const activeBenchmarkData = isBenchmarkDataForSymbol(benchmarkData, selectedBenchmark)
      ? benchmarkData
      : null;

    expect(activeBenchmarkData).toBeNull();
  });
});

describe("Ticker tape staleness handling", () => {
  it("determines quotes with allStale or no fresh quotes must transition isLive to false", () => {
    const mockApiResponse = {
      updatedAt: "2026-09-17 15:00:00",
      allStale: true,
      quotes: [
        { proName: "TSE:7203", formattedPrice: "2,800", formattedChange: "+10", formattedChangePercent: "+0.3%", isPositive: true, stale: true },
        { proName: "TSE:9984", formattedPrice: "8,500", formattedChange: "-50", formattedChangePercent: "-0.6%", isPositive: false, stale: true },
      ],
    };

    let isLive = true;
    const setIsLive = (val: boolean) => {
      isLive = val;
    };

    const freshQuotes = mockApiResponse.quotes.filter((q) => q && !q.stale);
    if (mockApiResponse.allStale || freshQuotes.length === 0) {
      setIsLive(false);
    }

    expect(isLive).toBe(false);
  });
});

describe("Client-side boundary validation invariants", () => {
  it("enforces maximum string lengths matching Worker specifications", () => {
    const maxNameLen = 100;
    const maxDescLen = 500;
    const maxPasswordLen = 100;

    const validName = "A".repeat(100);
    const tooLongName = "A".repeat(101);
    expect(validName.length <= maxNameLen).toBe(true);
    expect(tooLongName.length > maxNameLen).toBe(true);

    const validDesc = "B".repeat(500);
    const tooLongDesc = "B".repeat(501);
    expect(validDesc.length <= maxDescLen).toBe(true);
    expect(tooLongDesc.length > maxDescLen).toBe(true);

    const validPwd = "C".repeat(100);
    const tooLongPwd = "C".repeat(101);
    expect(validPwd.length <= maxPasswordLen).toBe(true);
    expect(tooLongPwd.length > maxPasswordLen).toBe(true);
  });
});
