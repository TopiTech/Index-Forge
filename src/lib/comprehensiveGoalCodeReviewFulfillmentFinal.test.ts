import { describe, it, expect } from "vitest";
import {
  convertPortfolioToCustomIndexBasket,
  type PortfolioPosition,
} from "./portfolioStorage";
import { getEventDayOfWeek } from "../components/CalendarPage";
import { allocateIntegerWeights } from "./weights";

describe("Comprehensive Goal Code Review Fulfillment Final Test Suite", () => {
  describe("convertPortfolioToCustomIndexBasket resilient fallbacks", () => {
    it("handles positions with empty, whitespace, or missing themes and names safely", () => {
      const customPositions: PortfolioPosition[] = [
        {
          id: "pos-1",
          ticker: "7203",
          name: "  ", // whitespace only
          shares: 100,
          averageCost: 2000,
          currentPrice: 2500,
        },
        {
          id: "pos-2",
          ticker: "6758",
          name: "ソニーグループ",
          shares: 50,
          averageCost: 10000,
          currentPrice: 12000,
        },
        {
          id: "pos-3",
          ticker: "AAPL",
          name: "",
          shares: 20,
          averageCost: 150,
          currentPrice: 180,
        },
        {
          id: "pos-4",
          ticker: "CUSTOM99",
          name: "  ",
          shares: 10,
          averageCost: 100,
          currentPrice: 110,
        },
      ];

      const basket = convertPortfolioToCustomIndexBasket(customPositions, 150);

      expect(basket).toHaveLength(4);

      // Verify every item meets the Worker /api/calculate strict contract
      for (const item of basket) {
        // Ticker: non-empty, <= 20 chars, alphanumeric/dot/hyphen
        expect(typeof item.ticker).toBe("string");
        expect(item.ticker.trim().length).toBeGreaterThan(0);
        expect(item.ticker.trim().length).toBeLessThanOrEqual(20);
        expect(/^[A-Za-z0-9.-]+$/.test(item.ticker)).toBe(true);

        // Name: non-empty, <= 100 chars
        expect(typeof item.name).toBe("string");
        expect(item.name.trim().length).toBeGreaterThan(0);
        expect(item.name.trim().length).toBeLessThanOrEqual(100);

        // Theme: non-empty, <= 100 chars
        expect(typeof item.theme).toBe("string");
        expect(item.theme.trim().length).toBeGreaterThan(0);
        expect(item.theme.trim().length).toBeLessThanOrEqual(100);

        // Weight: finite number between 1 and 100
        expect(typeof item.weight).toBe("number");
        expect(Number.isFinite(item.weight)).toBe(true);
        expect(item.weight).toBeGreaterThanOrEqual(1);
        expect(item.weight).toBeLessThanOrEqual(100);
      }

      // Sum of weights must equal exactly 100
      const totalWeight = basket.reduce((acc, item) => acc + item.weight, 0);
      expect(totalWeight).toBe(100);

      // Check specific fallbacks
      const pos1Item = basket.find((b) => b.ticker === "7203");
      expect(pos1Item).toBeDefined();
      expect(pos1Item?.name).toBe("トヨタ自動車"); // resolved from fundamentals
      expect(pos1Item?.theme).toBeTruthy(); // non-empty valid theme

      const pos4Item = basket.find((b) => b.ticker === "CUSTOM99");
      expect(pos4Item).toBeDefined();
      expect(pos4Item?.name.trim().length).toBeGreaterThan(0);
      expect(pos4Item?.theme.trim().length).toBeGreaterThan(0);
    });

    it("returns empty array when positions are empty", () => {
      const basket = convertPortfolioToCustomIndexBasket([]);
      expect(basket).toEqual([]);
    });

    it("deduplicates tickers and combines market values accurately", () => {
      const multiLotPositions: PortfolioPosition[] = [
        {
          id: "lot-1",
          ticker: "7203",
          name: "トヨタ自動車 (第1ロット)",
          shares: 100,
          averageCost: 2000,
          currentPrice: 2500,
        },
        {
          id: "lot-2",
          ticker: "7203",
          name: "トヨタ自動車 (第2ロット)",
          shares: 200,
          averageCost: 2200,
          currentPrice: 2500,
        },
      ];

      const basket = convertPortfolioToCustomIndexBasket(multiLotPositions);
      expect(basket).toHaveLength(1);
      expect(basket[0].ticker).toBe("7203");
      expect(basket[0].weight).toBe(100);
    });
  });

  describe("CalendarPage.getEventDayOfWeek resilient date parsing", () => {
    it("parses standard YYYY-MM-DD fullDate correctly", () => {
      // 2026-10-12 is Monday (月)
      expect(getEventDayOfWeek("10/12", "2026-10-12")).toBe("月");
      // 2026-10-14 is Wednesday (水)
      expect(getEventDayOfWeek("10/14", "2026-10-14")).toBe("水");
      // 2026-10-18 is Sunday (日)
      expect(getEventDayOfWeek("10/18", "2026-10-18")).toBe("日");
    });

    it("parses slash-formatted YYYY/MM/DD fullDate correctly", () => {
      expect(getEventDayOfWeek("10/12", "2026/10/12")).toBe("月");
      expect(getEventDayOfWeek("10/16", "2026/10/16")).toBe("金");
    });

    it("parses ISO datetime string fullDate correctly", () => {
      expect(getEventDayOfWeek("10/12", "2026-10-12T09:00:00Z")).toBe("月");
    });

    it("falls back to dateStr MM/DD when fullDate is absent or invalid", () => {
      const res = getEventDayOfWeek("10/12");
      expect(typeof res).toBe("string");
      expect(["日", "月", "火", "水", "木", "金", "土"]).toContain(res);
    });

    it("returns empty string on completely invalid date inputs without crashing", () => {
      expect(getEventDayOfWeek("invalid-date")).toBe("");
      expect(getEventDayOfWeek("", "invalid-full-date")).toBe("");
      expect(getEventDayOfWeek("99/99")).toBe("");
    });
  });

  describe("allocateIntegerWeights contract invariant preservation", () => {
    it("always produces exactly total units and never 0 for any constituent", () => {
      const testCases = [
        [100, 200, 300],
        [1, 1, 1],
        [0, 0, 0],
        [1000000, 1, 1],
        [50, 50],
        [10, 20, 30, 40, 50, 60, 70],
      ];

      for (const values of testCases) {
        const weights = allocateIntegerWeights(values, 100);
        expect(weights).toHaveLength(values.length);
        const sum = weights.reduce((a, b) => a + b, 0);
        expect(sum).toBe(100);
        for (const w of weights) {
          expect(w).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(w)).toBe(true);
        }
      }
    });
  });
});
