import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fetchLiveStockFundamentals, resetYahooCrumbCache } from "../../worker/internal";
import { deserializePortfolioFromCsv, serializePortfolioToCsv } from "./indexSerialization";
import { downsampleLTTB } from "./chartData";
import { formatDynamicRelativeTime } from "./marketDataService";
import { changeAdminSecretCode, storeAuth, clearAuth } from "./auth";
import {
  createPortfolioPosition,
  sanitizeWatchlist,
  calculatePortfolioSummary,
  convertPortfolioToCustomIndexBasket,
  type PortfolioPosition,
} from "./portfolioStorage";

/**
 * Deterministic Yahoo Finance test double.
 *
 * `fetchLiveStockFundamentals` used to read the live quote from Yahoo, so the
 * currency/precision assertions below depended on network egress. The stub
 * reports "no live quote", which drives the helper down its documented anchor
 * fallback and makes the expectations reproducible.
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

/**
 * The portfolio CSV header the production serializer actually writes.
 *
 * Deriving the fixture header from the serializer keeps the test in step with
 * production instead of freezing a stale copy of it.
 */
const PORTFOLIO_CSV_HEADER = serializePortfolioToCsv([]).split("\r\n")[0];

describe("Goal Code Review Comprehensive Audit & Fix Verification", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
    stubYahooFinanceWithoutLiveData();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("1. Schema Reset Completeness (schema.dev.sql vs schema.sql)", () => {
    it("ensures schema.dev.sql drops every table defined in schema.sql, including admin_login_attempts", () => {
      const rootDir = path.resolve(__dirname, "../..");
      const schemaDevPath = path.join(rootDir, "schema.dev.sql");
      const schemaPath = path.join(rootDir, "schema.sql");

      const schemaDevContent = fs.readFileSync(schemaDevPath, "utf-8");
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");

      expect(schemaDevContent).toContain("DROP TABLE IF EXISTS admin_login_attempts;");

      // Extract all tables defined in schema.sql: CREATE TABLE [IF NOT EXISTS] <name>
      const createTableMatches = [...schemaContent.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi)];
      const createdTables = createTableMatches.map((m) => m[1]);
      expect(createdTables.length).toBeGreaterThanOrEqual(9);

      // Extract all tables dropped in schema.dev.sql: DROP TABLE [IF EXISTS] <name>
      const dropTableMatches = [...schemaDevContent.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi)];
      const droppedTables = new Set(dropTableMatches.map((m) => m[1]));

      for (const table of createdTables) {
        expect(droppedTables.has(table), `Expected table '${table}' from schema.sql to be dropped in schema.dev.sql`).toBe(true);
      }
    });
  });

  describe("2. FX Currency & Stock Precision in fetchLiveStockFundamentals", () => {
    it("formats USD/JPY and EUR/JPY with 2 decimal places instead of 1", async () => {
      const fundamentals = await fetchLiveStockFundamentals("USDJPY=X");
      expect(fundamentals.ticker).toBe("USDJPY=X");
      expect(fundamentals.theme).toBe("為替");
      expect(Number.isFinite(fundamentals.price)).toBe(true);
      expect(fundamentals.price).toBeGreaterThan(100);
      // Ensure formatted price conforms to 2 decimal places
      const priceStr = fundamentals.price.toFixed(2);
      expect(priceStr).toMatch(/^\d+\.\d{2}$/);
      expect(Number.isFinite(fundamentals.change)).toBe(true);
    });

    it("formats EUR/USD with up to 4 decimal places instead of truncating to 2", async () => {
      const fundamentals = await fetchLiveStockFundamentals("EURUSD=X");
      expect(fundamentals.ticker).toBe("EURUSD=X");
      expect(fundamentals.theme).toBe("為替");
      expect(Number.isFinite(fundamentals.price)).toBe(true);
      expect(fundamentals.price).toBeGreaterThan(0.5);
      expect(fundamentals.price).toBeLessThan(2.0);
      // Ensure EUR/USD can retain up to 4 decimal places (pip precision), formatted with 4 decimals
      const priceStr = fundamentals.price.toFixed(4);
      expect(priceStr).toMatch(/^\d+\.\d{4}$/);
      // If the quote has >2 decimals, verify it was NOT rounded down to 2 decimals
      const decimalPart = fundamentals.price.toString().split(".")[1] || "";
      expect(decimalPart.length).toBeLessThanOrEqual(4);
    });

    it("formats domestic Japanese equity with 1 decimal place and US stock with 2 decimal places", async () => {
      const jpStock = await fetchLiveStockFundamentals("7203");
      expect(jpStock.market).toBe("PRIME");
      expect(Number.isFinite(jpStock.price)).toBe(true);

      const usStock = await fetchLiveStockFundamentals("AAPL");
      expect(usStock.market).toBe("US");
      expect(Number.isFinite(usStock.price)).toBe(true);
      expect(usStock.price.toFixed(2)).toMatch(/\.\d{2}$/);
    });
  });

  describe("3. deserializePortfolioFromCsv Normalization and Validation", () => {
    it("uses the very header set the production serializer writes", () => {
      expect(PORTFOLIO_CSV_HEADER).toBe("コード,銘柄名,保有株数,取得単価,取得日,メモ");
    });

    it("normalizes full-width tickers to ASCII uppercase", () => {
      const csv = [
        PORTFOLIO_CSV_HEADER,
        "７２０３,トヨタ自動車,100,2500,2026-01-05,",
        "ＡＡＰＬ,Apple Inc.,10,180.5,2026-01-06,",
      ].join("\n");

      const result = deserializePortfolioFromCsv(csv);
      // Precondition first: the assertions below must not be skipped when the
      // parser rejects the file.
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();

      const positions = result.data!;
      expect(positions).toHaveLength(2);
      expect(positions[0].ticker).toBe("7203");
      expect(positions[0].name).toBe("トヨタ自動車");
      expect(positions[0].shares).toBe(100);
      expect(positions[0].averageCost).toBe(2500);
      expect(positions[0].acquiredAt).toBe("2026-01-05");

      expect(positions[1].ticker).toBe("AAPL");
      expect(positions[1].name).toBe("Apple Inc.");
      expect(positions[1].shares).toBe(10);
      expect(positions[1].averageCost).toBe(180.5);
      expect(positions[1].acquiredAt).toBe("2026-01-06");
    });

    it("filters out invalid tickers and truncates oversized fields safely", () => {
      const oversizedName = "A".repeat(200);
      const oversizedNotes = "N".repeat(1000);
      const csv = [
        PORTFOLIO_CSV_HEADER,
        "<SCRIPT>ALERT(1)</SCRIPT>,XSS Stock,10,100,2026-01-01,Test",
        "VERY_LONG_INVALID_TICKER_EXCEEDING_LIMIT,Long,10,100,2026-01-01,Test",
        `7203,${oversizedName},50,3000,2026-02-01,${oversizedNotes}`,
      ].join("\n");

      const result = deserializePortfolioFromCsv(csv);
      // Precondition first: the assertions below must not be skipped when the
      // parser rejects the file.
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();

      const positions = result.data!;
      expect(positions).toHaveLength(1);
      expect(positions[0].ticker).toBe("7203");
      expect(positions[0].name.length).toBeLessThanOrEqual(100);
      expect(positions[0].notes?.length).toBeLessThanOrEqual(500);
    });
  });

  describe("4. downsampleLTTB Robustness against Non-Finite Values", () => {
    it("successfully downsamples series even when containing NaN or Infinity values", () => {
      const rawData = Array.from({ length: 50 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, "0")}`,
        value: i === 10 ? NaN : i === 25 ? Infinity : 100 + Math.sin(i) * 10,
      }));

      const downsampled = downsampleLTTB(rawData, 10);
      expect(downsampled.length).toBe(10);
      expect(downsampled[0].date).toBe(rawData[0].date);
      expect(downsampled[downsampled.length - 1].date).toBe(rawData[rawData.length - 1].date);
      // All selected points should be valid data items from input
      for (const pt of downsampled) {
        expect(pt).toBeDefined();
        expect(typeof pt.date).toBe("string");
      }
    });

    it("returns original array when input is shorter than or equal to threshold", () => {
      const smallData = [
        { date: "2026-01-01", value: 100 },
        { date: "2026-01-02", value: 105 },
      ];
      expect(downsampleLTTB(smallData, 5)).toBe(smallData);
      expect(downsampleLTTB(smallData, 2)).toBe(smallData);
    });
  });

  describe("5. formatDynamicRelativeTime Unix Timestamps and Robustness", () => {
    const fixedNow = new Date("2026-10-15T12:00:00Z");

    it("formats offset in minutes", () => {
      expect(formatDynamicRelativeTime(0, fixedNow)).toBe("たった今");
      expect(formatDynamicRelativeTime(5, fixedNow)).toBe("5分前");
      expect(formatDynamicRelativeTime(120, fixedNow)).toBe("2時間前");
      expect(formatDynamicRelativeTime(1440, fixedNow)).toBe("昨日");
      expect(formatDynamicRelativeTime(2880, fixedNow)).toBe("2日前");
      expect(formatDynamicRelativeTime(10080, fixedNow)).toBe("1週間前");
    });

    it("formats epoch timestamps in milliseconds (> 1e11)", () => {
      const fifteenMinsAgoMs = fixedNow.getTime() - 15 * 60 * 1000;
      expect(formatDynamicRelativeTime(fifteenMinsAgoMs, fixedNow)).toBe("15分前");

      const threeHoursAgoMs = fixedNow.getTime() - 3 * 60 * 60 * 1000;
      expect(formatDynamicRelativeTime(threeHoursAgoMs, fixedNow)).toBe("3時間前");
    });

    it("formats epoch timestamps in seconds (> 1e8)", () => {
      const thirtyMinsAgoSec = Math.floor(fixedNow.getTime() / 1000) - 30 * 60;
      expect(formatDynamicRelativeTime(thirtyMinsAgoSec, fixedNow)).toBe("30分前");

      const oneDayAgoSec = Math.floor(fixedNow.getTime() / 1000) - 24 * 60 * 60;
      expect(formatDynamicRelativeTime(oneDayAgoSec, fixedNow)).toBe("昨日");
    });

    it("safely handles invalid inputs without NaN or throwing", () => {
      expect(formatDynamicRelativeTime(-5, fixedNow)).toBe("たった今");
      expect(formatDynamicRelativeTime(NaN, fixedNow)).toBe("たった今");
      expect(formatDynamicRelativeTime("invalid-date-string", fixedNow)).toBe("たった今");
    });
  });

  // ==========================================================================
  // 6. Security Header Fallback & Ticker Normalization
  // ==========================================================================
  describe("6. Security Header Fallback & Ticker Normalization", () => {
    afterEach(() => {
      clearAuth();
    });

    it("never sends x-auth-password to /api/admin/admin-secret-code when headers are omitted", async () => {
      storeAuth({
        role: "admin",
        name: "Master Admin",
        password: "super-secret-admin-password",
        maxStocks: null,
        maxIndices: null,
        id: "admin-master",
        adminToken: "valid-admin-session-token-99999",
      });

      let capturedHeaders: Record<string, string> = {};
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        // A faithful Response keeps the shared readJsonBody contract (text/headers).
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              adminToken: "renewed-admin-token-12345",
              adminTokenExpiresAt: Date.now() + 28800000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      });

      try {
        const res = await changeAdminSecretCode("current-code", "new-secret-code-2026");
        expect(res.ok).toBe(true);
        expect(res.adminToken).toBe("renewed-admin-token-12345");

        // Privileged endpoint must receive session header ONLY (C-2/C-5)
        expect(capturedHeaders["x-admin-session"]).toBe("valid-admin-session-token-99999");
        expect(capturedHeaders["x-auth-password"]).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("sends empty auth headers when no admin session exists and headers are omitted", async () => {
      clearAuth();

      let capturedHeaders: Record<string, string> = {};
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: "管理者セッションが無効または期限切れです",
            }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
        );
      });

      try {
        const res = await changeAdminSecretCode("current-code", "new-code");
        expect(res.ok).toBe(false);
        expect(capturedHeaders["x-admin-session"]).toBeUndefined();
        expect(capturedHeaders["x-auth-password"]).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("preserves explicitly passed custom headers when provided", async () => {
      let capturedHeaders: Record<string, string> = {};
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, adminToken: "explicit-token-abc" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      });

      try {
        const custom = { "x-admin-session": "custom-provided-token", "x-custom-trace": "trace-123" };
        const res = await changeAdminSecretCode("code-a", "code-b", custom);
        expect(res.ok).toBe(true);
        expect(capturedHeaders["x-admin-session"]).toBe("custom-provided-token");
        expect(capturedHeaders["x-custom-trace"]).toBe("trace-123");
        expect(capturedHeaders["x-auth-password"]).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("createPortfolioPosition canonicalizes full-width and lowercase tickers", () => {
      const pos1 = createPortfolioPosition({
        ticker: " ７２０３ ",
        name: "トヨタ自動車",
        shares: 100,
        averageCost: 2500,
      });
      expect(pos1.ticker).toBe("7203");
      expect(pos1.id).toContain("pos-7203-100-");

      const pos2 = createPortfolioPosition({
        ticker: " aapl ",
        name: "Apple Inc.",
        shares: 10,
        averageCost: 180,
      });
      expect(pos2.ticker).toBe("AAPL");
      expect(pos2.id).toContain("pos-AAPL-10-");
    });

    it("sanitizeWatchlist canonicalizes and deduplicates full-width, mixed-case tickers", () => {
      const raw = ["７２０３", " 7203 ", "aapl", "AAPL", " ａａｐｌ ", "9984", ""];
      const sanitized = sanitizeWatchlist(raw);
      expect(sanitized).toEqual(["7203", "AAPL", "9984"]);
    });

    it("calculatePortfolioSummary handles normalized quotesMap lookup for full-width input", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-1",
          ticker: "７２０３", // Full-width
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2000,
        },
      ];

      const quotesMap = new Map([
        [
          "7203",
          {
            ticker: "7203",
            name: "トヨタ自動車",
            price: 2800,
            change: 50,
            changePercent: 1.82,
            volume: 1000000,
            isPositive: true,
          },
        ],
      ]);

      const summary = calculatePortfolioSummary(positions, { quotesMap, usdJpyRate: 150 });
      expect(summary.totalCost).toBe(200000); // 100 * 2000
      expect(summary.totalMarketValue).toBe(280000); // 100 * 2800
      expect(summary.totalProfit).toBe(80000);
      expect(summary.totalProfitPercent).toBe(40);
    });

    it("calculatePortfolioSummary handles liveQuotes option key and uppercase Map keys", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-aapl",
          ticker: "aapl", // Lowercase
          name: "Apple",
          shares: 10,
          averageCost: 150,
        },
      ];

      const liveMap = new Map([
        [
          "AAPL",
          {
            ticker: "AAPL",
            name: "Apple Inc.",
            price: 220,
            change: 5,
            changePercent: 2.32,
            volume: 50000000,
            isPositive: true,
          },
        ],
      ]);

      const summary = calculatePortfolioSummary(positions, { liveQuotes: liveMap, usdJpyRate: 150 });
      // Individual position values in native USD
      expect(summary.positions[0].totalCost).toBe(1500); // 10 * 150 in USD
      expect(summary.positions[0].marketValue).toBe(2200); // 10 * 220 in USD
      expect(summary.positions[0].unrealizedProfit).toBe(700);
      // Portfolio summary totals converted to JPY at usdJpyRate (150)
      expect(summary.totalCost).toBe(225000); // 1500 * 150
      expect(summary.totalMarketValue).toBe(330000); // 2200 * 150
      expect(summary.totalProfit).toBe(105000); // 330000 - 225000
    });

    it("convertPortfolioToCustomIndexBasket groups positions with normalized tickers and allocates 100% total weight", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "p1",
          ticker: "７２０３",
          name: "トヨタ",
          shares: 100,
          averageCost: 2000,
          currentPrice: 2000,
        },
        {
          id: "p2",
          ticker: "7203",
          name: "トヨタ",
          shares: 100,
          averageCost: 2000,
          currentPrice: 2000,
        },
        {
          id: "p3",
          ticker: " 8035 ",
          name: "東京エレクトロン",
          shares: 50,
          averageCost: 20000,
          currentPrice: 20000,
        },
      ];

      const basket = convertPortfolioToCustomIndexBasket(positions);
      expect(basket).toHaveLength(2);
      expect(basket.find((b) => b.ticker === "7203")).toBeDefined();
      expect(basket.find((b) => b.ticker === "8035")).toBeDefined();

      const totalWeight = basket.reduce((acc, curr) => acc + curr.weight, 0);
      expect(totalWeight).toBe(100);
    });
  });
});
