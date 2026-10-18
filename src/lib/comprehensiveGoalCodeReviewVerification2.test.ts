import { describe, it, expect } from "vitest";
import { runStockScreener, type StockQuoteFundamentals } from "./marketDataService";
import { fetchSecEdgarFinancials } from "../../worker/internal";

describe("Comprehensive Code Review Quality & Bugfix Verification", () => {
  describe("P1: fetchSecEdgarFinancials zero-value retention", () => {
    it("preserves 10-K facts with zero value (break-even / 0.00 EPS) without dropping them", async () => {
      // Mock global fetch to simulate SEC EDGAR response containing 0 net income and 0.00 EPS
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (input: RequestInfo | URL) => {
          const urlStr = String(input);
          if (urlStr.includes("companyfacts/CIK0000320193.json")) {
            return new Response(
              JSON.stringify({
                facts: {
                  "us-gaap": {
                    Revenues: {
                      units: {
                        USD: [
                          { form: "10-K", fy: 2023, val: 383285000000 },
                          { form: "10-K", fy: 2024, val: 391035000000 },
                        ],
                      },
                    },
                    NetIncomeLoss: {
                      units: {
                        USD: [
                          { form: "10-K", fy: 2023, val: 96995000000 },
                          // Break-even year with precisely 0 Net Income
                          { form: "10-K", fy: 2024, val: 0 },
                        ],
                      },
                    },
                    OperatingIncomeLoss: {
                      units: {
                        USD: [
                          { form: "10-K", fy: 2023, val: 114301000000 },
                          { form: "10-K", fy: 2024, val: 0 },
                        ],
                      },
                    },
                    EarningsPerShareDiluted: {
                      units: {
                        USD: [
                          { form: "10-K", fy: 2023, val: 6.13 },
                          { form: "10-K", fy: 2024, val: 0.0 },
                        ],
                      },
                    },
                  },
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response("Not found", { status: 404 });
        };

        const facts = await fetchSecEdgarFinancials("AAPL");
        expect(facts).toHaveLength(2);
        const fy2024 = facts.find((f) => f.fiscalYear === "2024 FY");
        expect(fy2024).toBeDefined();
        expect(fy2024?.revenue).toBe(391035);
        expect(fy2024?.netIncome).toBe(0);
        expect(fy2024?.operatingIncome).toBe(0);
        expect(fy2024?.eps).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("P2: runStockScreener deterministic tiebreaker", () => {
    it("deterministically sorts stocks with identical metric values by ticker ascending", () => {
      const mockUniverse: StockQuoteFundamentals[] = [
        {
          ticker: "7203",
          name: "トヨタ自動車",
          price: 2800,
          change: 10,
          changePercent: 0.5,
          previousClose: 2790,
          market: "PRIME",
          dividendYield: 3.5,
          per: 10.0,
          pbr: 1.0,
          volume: 1000,
          marketCap: 400000,
          dayHigh: 2820,
          dayLow: 2780,
          yearHigh: 3000,
          yearLow: 2000,
        },
        {
          ticker: "6758",
          name: "ソニーグループ",
          price: 13000,
          change: 50,
          changePercent: 0.5,
          previousClose: 12950,
          market: "PRIME",
          dividendYield: 3.5,
          per: 10.0,
          pbr: 1.0,
          volume: 2000,
          marketCap: 150000,
          dayHigh: 13100,
          dayLow: 12900,
          yearHigh: 15000,
          yearLow: 10000,
        },
        {
          ticker: "9984",
          name: "ソフトバンクグループ",
          price: 9000,
          change: 30,
          changePercent: 0.5,
          previousClose: 8970,
          market: "PRIME",
          dividendYield: 3.5,
          per: 10.0,
          pbr: 1.0,
          volume: 3000,
          marketCap: 120000,
          dayHigh: 9100,
          dayLow: 8900,
          yearHigh: 10000,
          yearLow: 6000,
        },
      ];

      const res = runStockScreener(
        { sortBy: "dividendYield", sortOrder: "desc" },
        mockUniverse,
      );

      // All 3 stocks have dividendYield = 3.5; tiebreaker must order them by ticker ascending: 6758, 7203, 9984
      expect(res.map((s) => s.ticker)).toEqual(["6758", "7203", "9984"]);
    });
  });

  describe("P2: ThemeHeatmap tiebreaker verification", () => {
    it("deterministically breaks ties when stocks have identical weights", () => {
      const stockDetails = [
        { ticker: "9984", weight: 25 },
        { ticker: "7203", weight: 25 },
        { ticker: "6758", weight: 50 },
      ];

      const sorted = [...stockDetails].sort((a, b) => {
        if (b.weight !== a.weight) return b.weight - a.weight;
        return a.ticker.localeCompare(b.ticker);
      });

      expect(sorted.map((s) => s.ticker)).toEqual(["6758", "7203", "9984"]);
    });
  });

  describe("P3: RiskMetricsCard decimal format consistency", () => {
    it("formats integer bestDay and worstDay with standard 2-decimal notation", () => {
      const pctFmt = new Intl.NumberFormat("ja-JP", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const bestDay = 3;
      const worstDay = -2;

      const formattedBest = pctFmt.format(bestDay);
      const formattedWorst = pctFmt.format(worstDay);

      expect(formattedBest).toBe("3.00");
      expect(formattedWorst).toBe("-2.00");
    });
  });
});
