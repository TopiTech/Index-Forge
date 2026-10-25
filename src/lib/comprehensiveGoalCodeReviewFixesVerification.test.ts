import { describe, it, expect, vi } from "vitest";
import { calculateStockDetails, roundSafe } from "./analytics";
import {
  calculatePortfolioSummary,
  type PortfolioPosition,
  type PortfolioLiveQuote,
} from "./portfolioStorage";
import {
  computePendingMigrations,
  type DatabaseProbeResult,
} from "../../scripts/apply-migrations.mjs";
import { releaseResponse, fetchWithNetworkMark } from "./apiContract";

describe("Comprehensive Goal Code Review Fixes Verification", () => {
  describe("Unit 1: calculateStockDetails & roundSafe Resilience", () => {
    it("roundSafe normalizes -0 to 0 and handles non-finite values with fallback", () => {
      expect(roundSafe(-0.0001, 2)).toBe(0);
      expect(Object.is(roundSafe(-0.0001, 2), -0)).toBe(false);
      expect(roundSafe(NaN, 2, 0)).toBe(0);
      expect(roundSafe(Infinity, 2, 99)).toBe(99);
      expect(roundSafe(-Infinity, 2, 0)).toBe(0);
      expect(roundSafe(12.3456, 2)).toBe(12.35);
    });

    it("calculateStockDetails prevents NaN and -0 propagation when stock prices or weights are corrupted", () => {
      const basket = [
        { ticker: "NAN_CORP", name: "Corrupted Co", weight: NaN, theme: "Tech" },
        { ticker: "ZERO_CORP", name: "Zero Co", weight: 0, theme: "Finance" },
      ];
      const stockUniverse = [
        {
          ticker: "NAN_CORP",
          name: "Corrupted Co",
          theme: "Tech",
          sector: "Tech",
          latestPrice: NaN,
          series: [],
        },
        {
          ticker: "ZERO_CORP",
          name: "Zero Co",
          theme: "Finance",
          sector: "Finance",
          latestPrice: 0,
          series: [],
        },
      ];

      const details = calculateStockDetails(basket, stockUniverse, NaN, []);

      expect(details).toHaveLength(2);
      for (const d of details) {
        expect(Number.isFinite(d.change)).toBe(true);
        expect(Number.isFinite(d.changePct)).toBe(true);
        expect(Number.isFinite(d.contributionPt)).toBe(true);
        expect(Number.isFinite(d.contributionPct)).toBe(true);
        expect(Object.is(d.change, -0)).toBe(false);
        expect(Object.is(d.changePct, -0)).toBe(false);
        expect(Object.is(d.contributionPt, -0)).toBe(false);
        expect(Object.is(d.contributionPct, -0)).toBe(false);
        expect(d.change).toBe(0);
        expect(d.changePct).toBe(0);
        expect(d.contributionPt).toBe(0);
        expect(d.contributionPct).toBe(0);
      }
    });
  });

  describe("Unit 2: Portfolio Options Object & Total Market Value Guard", () => {
    it("calculatePortfolioSummary accepts options object and produces equivalent outputs to positional arguments", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-1",
          ticker: "7203",
          name: "Toyota",
          shares: 100,
          averageCost: 2000,
        },
        {
          id: "pos-2",
          ticker: "AAPL",
          name: "Apple",
          shares: 10,
          averageCost: 150,
        },
      ];
      const liveQuotes = new Map<string, PortfolioLiveQuote>([
        ["7203", { price: 2500, change: 10, dps: 50, name: "Toyota" }],
        ["AAPL", { price: 200, change: 5, dps: 1, name: "Apple" }],
      ]);

      const fromPositional = calculatePortfolioSummary(positions, liveQuotes, 155);
      const fromOptions = calculatePortfolioSummary(positions, {
        liveQuotes,
        usdJpyRate: 155,
      });

      expect(fromOptions.totalMarketValue).toBe(fromPositional.totalMarketValue);
      expect(fromOptions.totalCost).toBe(fromPositional.totalCost);
      expect(fromOptions.totalProfit).toBe(fromPositional.totalProfit);
      expect(fromOptions.totalProfitPercent).toBe(fromPositional.totalProfitPercent);
      expect(fromOptions.positions[1].fxRate).toBe(155);
    });

    it("handles zero total market value safely with 0% position weights", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "zero-pos",
          ticker: "ZERO",
          name: "Zero Co",
          shares: 0,
          averageCost: 0,
        },
      ];
      const summary = calculatePortfolioSummary(positions);
      expect(summary.totalMarketValue).toBe(0);
      expect(summary.positions[0].weightPercent).toBe(0);
    });
  });

  describe("Unit 3: apply-migrations owner_token_issued_at prerequisite", () => {
    it("recognizes missing owner_token_issued_at column when indices table already has owner_token_hash", () => {
      const probe: DatabaseProbeResult = {
        tables: new Set(["indices"]),
        indexes: new Set(),
        columns: new Map([
          ["indices", new Set(["id", "name", "owner_token_hash"])],
        ]),
      };

      const pending = computePendingMigrations(probe);
      const stepNames = pending
        .filter((s) => s.type === "column" && s.table === "indices")
        .map((s) => s.name);

      expect(stepNames).toContain("owner_token_issued_at");
      expect(stepNames).not.toContain("owner_token_hash");
    });
  });

  describe("Unit 4: releaseResponse Safety", () => {
    it("releaseResponse is a safe no-op on raw responses without failing", () => {
      const rawRes = new Response(JSON.stringify({ ok: true }));
      expect(() => releaseResponse(rawRes)).not.toThrow();
    });

    it("releaseResponse cleans up lifecycle resources on early return", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 304 })),
      );
      try {
        const res = await fetchWithNetworkMark("http://localhost/api/mock-test", {
          timeoutMs: 1000,
        });
        expect(res.status).toBe(304);
        expect(() => releaseResponse(res)).not.toThrow();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
