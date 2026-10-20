import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fetchLiveStockFundamentals, resetYahooCrumbCache } from "../../worker/internal";
import { deserializePortfolioFromCsv, serializePortfolioToCsv } from "./indexSerialization";
import { downsampleLTTB } from "./chartData";
import { formatDynamicRelativeTime } from "./marketDataService";

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
});
