import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDividendEvaluation } from "../components/StockDetailPage";
import {
  fetchLiveMarketCalendarAsync,
  fetchLiveStockFundamentals,
  resetYahooCrumbCache,
} from "../../worker/internal";
import { getStockFundamentals } from "./marketDataService";
import fs from "node:fs";
import path from "node:path";

describe("User Requested Calendar & Financials Fixes Tests", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("1. Calendar Macro Real Data & Official Schedule Verification", () => {
    it("promotes macro events to official (not fallback) when live market calendar fetch succeeds", async () => {
      // Mock Yahoo Finance quote response with macro rates (^IRX, ^TNX) and live earnings
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
            return new Response("test-crumb-token", { status: 200 });
          }
          if (url.includes("/v7/finance/quote")) {
            return new Response(
              JSON.stringify({
                quoteResponse: {
                  result: [
                    {
                      symbol: "^IRX",
                      regularMarketPrice: 4.85,
                    },
                    {
                      symbol: "^TNX",
                      regularMarketPrice: 4.25,
                    },
                    {
                      symbol: "7203.T",
                      displayName: "トヨタ自動車",
                      regularMarketPrice: 2900,
                      earningsTimestamp: Math.floor(Date.now() / 1000) + 86400 * 5,
                    },
                  ],
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({}), { status: 200 });
        }),
      );

      const refDate = new Date(2026, 9, 12);
      const events = await fetchLiveMarketCalendarAsync(undefined, refDate);
      expect(events.length).toBeGreaterThan(0);

      // Verify that NO macro event is left as "fallback" (参考値)
      const macros = events.filter((e) => e.type === "MACRO");
      expect(macros.length).toBeGreaterThan(0);
      for (const m of macros) {
        expect(m.source).not.toBe("fallback");
      }

      // FOMC event: 日程は公定日程 (official)。前回値は 3ヶ月 T-Bill からの
      // 参考推計であり、値はフィールド単位の来歴で estimated と明示される。
      const fomc = macros.find((m) => m.id.startsWith("macro-fomc"));
      expect(fomc).toBeDefined();
      expect(fomc?.source).toBe("official");
      expect(fomc?.previous).toContain("4.75% - 5.00%");
      expect(fomc?.previous).toContain("参考推計");
      expect(fomc?.fieldProvenance?.previous).toBe("estimated");

      // BOJ, Jobs, CPI must be marked as 'official' (公定日程), NOT fallback
      const boj = macros.find((m) => m.id.startsWith("macro-boj"));
      expect(boj).toBeDefined();
      expect(boj?.source).toBe("official");
      // N-3: 日程の昇格でも指標値の静的デフォルトは実データに洗浄されない
      expect(boj?.fieldProvenance?.previous).toBe("reference");
      expect(boj?.fieldProvenance?.forecast).toBe("reference");

      const jobs = macros.find((m) => m.id.startsWith("macro-jobs"));
      expect(jobs).toBeDefined();
      expect(jobs?.source).toBe("official");

      const cpi = macros.find((m) => m.id.startsWith("macro-cpi"));
      expect(cpi).toBeDefined();
      expect(cpi?.source).toBe("official");

      const jpCpi = macros.find((m) => m.id.startsWith("macro-jp-cpi"));
      expect(jpCpi).toBeDefined();
      expect(jpCpi?.source).toBe("official");
    });
  });

  describe("2. Financial Highlights & Dividend Accuracy Verification", () => {
    it("correctly evaluates dividend when dps > 0 even if company forecast dividendYield is missing or 0", () => {
      // Stock with trailing dps 100 JPY but undisclosed forecast (yield 0 or null)
      const eval1 = getDividendEvaluation(0, 100, "JPY", false);
      expect(eval1).not.toContain("無配");
      expect(eval1).toContain("1株配当: 100 円");

      const eval2 = getDividendEvaluation(null, 2.5, "USD", false);
      expect(eval2).not.toContain("無配");
      expect(eval2).toContain("1株配当: $2.50");

      // Truly zero-dividend stocks must be evaluated as 無配
      const zeroEval = getDividendEvaluation(0, 0, "JPY", false);
      expect(zeroEval).toContain("無配");
    });

    it("preserves historical finances dps from baseline anchor in fetchLiveStockFundamentals", async () => {
      // When Yahoo returns quoteSummary with incomeStatementHistory, past years must preserve
      // historical dividend amounts rather than copying current year dps to all past years
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.startsWith("https://fc.yahoo.com")) {
            return new Response("", {
              status: 200,
              headers: { "set-cookie": "A1=test-cookie" },
            });
          }
          if (url.includes("/v1/test/getcrumb")) {
            return new Response("test-crumb-token", { status: 200 });
          }
          if (url.includes("/v10/finance/quoteSummary/7203.T")) {
            return new Response(
              JSON.stringify({
                quoteSummary: {
                  result: [
                    {
                      price: { regularMarketPrice: { raw: 2950 } },
                      summaryDetail: {
                        dividendYield: { raw: 0.034 },
                        dividendRate: { raw: 100 },
                      },
                      incomeStatementHistory: {
                        incomeStatementHistory: [
                          {
                            endDate: { fmt: "2024-03-31" },
                            totalRevenue: { raw: 45095300000000 },
                            operatingIncome: { raw: 5352900000000 },
                            netIncome: { raw: 4944900000000 },
                            dilutedEPS: { raw: 365.9 },
                          },
                          {
                            endDate: { fmt: "2023-03-31" },
                            totalRevenue: { raw: 37154200000000 },
                            operatingIncome: { raw: 2725000000000 },
                            netIncome: { raw: 2451300000000 },
                            dilutedEPS: { raw: 179.5 },
                          },
                          {
                            endDate: { fmt: "2022-03-31" },
                            totalRevenue: { raw: 31379500000000 },
                            operatingIncome: { raw: 2995600000000 },
                            netIncome: { raw: 2850100000000 },
                            dilutedEPS: { raw: 205.2 },
                          },
                        ],
                      },
                    },
                  ],
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({}), { status: 200 });
        }),
      );

      const toyota = await fetchLiveStockFundamentals("7203");
      expect(toyota.ticker).toBe("7203");
      expect(toyota.historicalFinances).toBeDefined();
      expect(toyota.historicalFinances.length).toBe(3);

      // Verify that past years adopt the accurate historical dps defined in baseline anchor
      // (2022: 52, 2023: 60, 2024: 90)
      const h2022 = toyota.historicalFinances.find((h) => h.fiscalYear.includes("2022"));
      const h2023 = toyota.historicalFinances.find((h) => h.fiscalYear.includes("2023"));
      expect(h2022).toBeDefined();
      expect(h2022?.dps).toBe(52);
      expect(h2023).toBeDefined();
      expect(h2023?.dps).toBe(60);
    });

    it("ensures baseline anchor 7203 and 8035 have accurate distinct historical dividends", () => {
      const toyota = getStockFundamentals("7203");
      const dpsValues = toyota.historicalFinances.map((h) => h.dps);
      // Historical dps values must not be all identical
      expect(new Set(dpsValues).size).toBeGreaterThan(1);
      expect(dpsValues).toContain(52);
      expect(dpsValues).toContain(60);
      expect(dpsValues).toContain(90);
    });
  });

  describe("3. Responsive Design CSS Verification", () => {
    it("defines financials-table-container with horizontal scroll and sticky first column", () => {
      const cssPath = path.resolve(__dirname, "../index.css");
      const cssContent = fs.readFileSync(cssPath, "utf-8");

      expect(cssContent).toContain(".financials-table-container");
      expect(cssContent).toContain(".financials-table-container th:first-child");
      expect(cssContent).toContain(".financials-table-container td:first-child");
      expect(cssContent).toContain("position: sticky");
      expect(cssContent).toContain("left: 0");
    });

    it("defines mobile media queries for stock fundamentals grid and calendar filter bar", () => {
      const cssPath = path.resolve(__dirname, "../index.css");
      const cssContent = fs.readFileSync(cssPath, "utf-8");

      expect(cssContent).toContain(".stock-fundamentals-grid");
      expect(cssContent).toContain(".calendar-filter-bar");
      expect(cssContent).toContain("@media (max-width: 768px)");
      expect(cssContent).toContain("@media (max-width: 480px)");
    });
  });
});
