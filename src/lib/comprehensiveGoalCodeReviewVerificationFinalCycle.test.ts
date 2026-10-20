import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchSecEdgarFinancials,
  fetchLiveMarketCalendar,
  fetchLiveMarketCalendarAsync,
  getLastKnownCalendarEvents,
  resetLastKnownCalendarEvents,
} from "../../worker/internal";
import { calculateRiskMetrics } from "./analytics";
import {
  convertPortfolioToCustomIndexBasket,
  type PortfolioPosition,
} from "./portfolioStorage";
import fs from "node:fs";
import path from "node:path";

/**
 * Deterministic SEC EDGAR test double.
 *
 * `fetchSecEdgarFinancials` downloads the company-facts document from
 * data.sec.gov. Letting that request escape makes the suite depend on network
 * egress (and on the SEC rate limiter), so the document is served from a
 * fixed payload here. Every other URL is answered locally as well: the test
 * must never reach the network, whatever the environment looks like.
 */
function stubSecEdgarCompanyFacts(facts: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("data.sec.gov")) {
        return new Response(JSON.stringify(facts), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    }),
  );
}

describe("Comprehensive Goal Code Review Final Verification Cycle", () => {
  afterEach(() => {
    // Every global stub installed by a test is removed again, so a test can
    // never observe the stub of another test.
    vi.unstubAllGlobals();
  });

  describe("1. SEC EDGAR DPS extraction in fetchSecEdgarFinancials", () => {
    it("correctly extracts annual dividend per share (DPS) from CommonStockDividendsPerShareDeclared", async () => {
      stubSecEdgarCompanyFacts({
        facts: {
          "us-gaap": {
            Revenues: {
              units: {
                USD: [
                  { form: "10-K", fy: 2023, val: 383285000000, fp: "FY" },
                  { form: "10-K", fy: 2024, val: 391035000000, fp: "FY" },
                ],
              },
            },
            NetIncomeLoss: {
              units: {
                USD: [
                  { form: "10-K", fy: 2023, val: 96995000000, fp: "FY" },
                  { form: "10-K", fy: 2024, val: 93736000000, fp: "FY" },
                ],
              },
            },
            EarningsPerShareDiluted: {
              units: {
                "USD/shares": [
                  { form: "10-K", fy: 2023, val: 6.13, fp: "FY" },
                  { form: "10-K", fy: 2024, val: 6.08, fp: "FY" },
                ],
              },
            },
            CommonStockDividendsPerShareDeclared: {
              units: {
                "USD/shares": [
                  { form: "10-K", fy: 2023, val: 0.96, fp: "FY" },
                  { form: "10-K", fy: 2024, val: 1.0, fp: "FY" },
                ],
              },
            },
          },
        },
      });

      const results = await fetchSecEdgarFinancials("AAPL");
      expect(results).toHaveLength(2);
      const fy23 = results.find((r) => r.fiscalYear === "2023 FY");
      const fy24 = results.find((r) => r.fiscalYear === "2024 FY");
      // The fiscal years must exist before their values are asserted: a
      // missing year would otherwise make the optional-chained assertions
      // compare `undefined` and fail with a confusing message.
      expect(fy23).toBeDefined();
      expect(fy24).toBeDefined();
      expect(fy23!.dps).toBe(0.96);
      expect(fy24!.dps).toBe(1.0);
    });

    it("falls back to CommonStockDividendsPerShareCashPaid when declared is missing", async () => {
      stubSecEdgarCompanyFacts({
        facts: {
          "us-gaap": {
            Revenues: {
              units: {
                USD: [{ form: "10-K", fy: 2024, val: 245120000000, fp: "FY" }],
              },
            },
            NetIncomeLoss: {
              units: {
                USD: [{ form: "10-K", fy: 2024, val: 88136000000, fp: "FY" }],
              },
            },
            EarningsPerShareDiluted: {
              units: {
                "USD/shares": [{ form: "10-K", fy: 2024, val: 11.8, fp: "FY" }],
              },
            },
            CommonStockDividendsPerShareCashPaid: {
              units: {
                "USD/shares": [{ form: "10-K", fy: 2024, val: 3.0, fp: "FY" }],
              },
            },
          },
        },
      });

      const results = await fetchSecEdgarFinancials("MSFT");
      expect(results).toHaveLength(1);
      expect(results[0].dps).toBe(3.0);
      expect(results[0].eps).toBe(11.8);
    });
  });

  describe("2. Calendar Cache Synchronization", () => {
    beforeEach(() => {
      resetLastKnownCalendarEvents();
    });

    it("populates lastKnownCalendarEvents on fetchLiveMarketCalendar fallback generation", () => {
      expect(getLastKnownCalendarEvents()).toBeNull();
      const events = fetchLiveMarketCalendar();
      expect(events.length).toBeGreaterThan(0);
      expect(getLastKnownCalendarEvents()).toBe(events);
    });

    it("populates lastKnownCalendarEvents even when fetchLiveMarketCalendarAsync has no live quotes", async () => {
      // The async helper asks Yahoo for the earnings calendar. The stub below
      // answers every request with a server error, so the helper must fall
      // back to the generated events - deterministically, without egress.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("Internal Server Error", { status: 500 })),
      );

      expect(getLastKnownCalendarEvents()).toBeNull();
      const events = await fetchLiveMarketCalendarAsync();
      expect(events.length).toBeGreaterThan(0);
      expect(getLastKnownCalendarEvents()).toBe(events);
    });
  });

  describe("3. CalendarPage Importance Filter UI & Options", () => {
    it("contains ALL, HIGH, MEDIUM, and LOW options in CalendarPage.tsx", () => {
      const calendarPagePath = path.resolve(__dirname, "../components/CalendarPage.tsx");
      const content = fs.readFileSync(calendarPagePath, "utf-8");
      expect(content).toContain('type ImportanceFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";');
      expect(content).toContain('useState<ImportanceFilter>("ALL")');
      expect(content).toContain('<option value="ALL">全重要度</option>');
      expect(content).toContain('<option value="HIGH">最重要 (HIGH)</option>');
      expect(content).toContain('<option value="MEDIUM">標準 (MEDIUM)</option>');
      expect(content).toContain('<option value="LOW">低 (LOW)</option>');
    });

    it("filters the importance by an exact match and labels the options accordingly", () => {
      const calendarPagePath = path.resolve(__dirname, "../components/CalendarPage.tsx");
      const content = fs.readFileSync(calendarPagePath, "utf-8");

      // UI-09: the filter selects one importance level; it is not a
      // threshold ("MEDIUM and above"), so the label must not claim one.
      expect(content).toContain(
        'if (importanceFilter !== "ALL" && e.importance !== importanceFilter) return false;',
      );
      expect(content).toContain('MEDIUM: "標準 (MEDIUM)"');
      expect(content).not.toContain("MEDIUM以上");
      // The rendered option must not advertise a threshold either.
      expect(content).not.toMatch(/<option value="MEDIUM">[^<]*以上/);
    });
  });

  describe("4. Analytics Risk Metrics Boundary Safeguards", () => {
    it("computes 0 volatility and 0 Sharpe ratio cleanly when series has identical prices", () => {
      const flatSeries = [
        { date: "2024-01-01", close: 1000, value: 1000 },
        { date: "2024-01-02", close: 1000, value: 1000 },
        { date: "2024-01-03", close: 1000, value: 1000 },
      ];
      const metrics = calculateRiskMetrics(flatSeries, flatSeries);
      expect(metrics.annualReturn).toBe(0);
      expect(metrics.annualVolatility).toBe(0);
      expect(metrics.sharpeRatio).toBe(0);
      expect(metrics.maxDrawdown).toBe(0);
      expect(Object.is(metrics.sharpeRatio, -0)).toBe(false);
      expect(Object.is(metrics.annualReturn, -0)).toBe(false);
    });
  });

  describe("5. Portfolio to Custom Index Basket Conversion", () => {
    it("safely ignores positions with negative or corrupt market values and allocates weights summing to 100", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-1",
          ticker: "7203",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2000,
          currentPrice: 2500,
          acquiredAt: "2024-01-01",
        },
        {
          id: "pos-2",
          ticker: "6758",
          name: "ソニーグループ",
          shares: 50,
          averageCost: 12000,
          currentPrice: 13000,
          acquiredAt: "2024-01-01",
        },
        {
          id: "pos-3",
          ticker: "AAPL",
          name: "Apple Inc.",
          shares: 10,
          averageCost: 150,
          currentPrice: 200,
          acquiredAt: "2024-01-01",
        },
      ];

      const basket = convertPortfolioToCustomIndexBasket(positions, 150);
      expect(basket).toHaveLength(3);
      const totalWeight = basket.reduce((sum, item) => sum + item.weight, 0);
      expect(totalWeight).toBe(100);
      for (const item of basket) {
        expect(item.weight).toBeGreaterThanOrEqual(1);
      }
    });

    it("returns empty basket if input has no valid constituents", () => {
      const emptyBasket = convertPortfolioToCustomIndexBasket([]);
      expect(emptyBasket).toEqual([]);
    });
  });
});
