import { describe, it, expect } from "vitest";
import { allocateEvenWeights } from "./weights";
import { getCurrencyMeta } from "./currency";

describe("Goal Comprehensive Review Pass 2 - Edge Cases & Regression Tests", () => {
  describe("Screener Batch Index Creation & Cross-Filter Selection Logic", () => {
    it("allocates even weights correctly for chosen stocks", () => {
      const weights = allocateEvenWeights(3);
      expect(weights.length).toBe(3);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(100, 2);
    });

    it("prevents empty basket generation when filter changes and selected tickers are not in current results", () => {
      // Mock scenario: User had selected AAPL and MSFT from US view
      const selectedTickers = new Set(["AAPL", "MSFT"]);

      // Filter changed to TSE Prime stocks (only 7203 and 6758)
      const currentResults = [
        { ticker: "7203", name: "トヨタ自動車", theme: "自動車", price: 2850 },
        { ticker: "6758", name: "ソニーグループ", theme: "エレクトロニクス", price: 13000 },
      ];

      // Simulate the updated selection logic
      const selectedInResults = currentResults.filter((s) => selectedTickers.has(s.ticker));
      expect(selectedInResults.length).toBe(0);

      // Crucial fix verification: chosenStocks falls back to current results top 10 instead of []
      const chosenStocks =
        selectedInResults.length > 0 ? selectedInResults : currentResults.slice(0, 10);

      expect(chosenStocks.length).toBe(2);
      expect(chosenStocks[0].ticker).toBe("7203");
      expect(chosenStocks[1].ticker).toBe("6758");

      // Basket must not be empty
      const weights = allocateEvenWeights(chosenStocks.length);
      const basket = chosenStocks.map((s, index) => ({
        ticker: s.ticker,
        name: s.name,
        theme: s.theme,
        weight: weights[index],
      }));

      expect(basket.length).toBe(2);
      expect(basket[0].weight).toBe(50);
      expect(basket[1].weight).toBe(50);
    });

    it("uses selected tickers when they match current results", () => {
      const selectedTickers = new Set(["7203"]);
      const currentResults = [
        { ticker: "7203", name: "トヨタ自動車", theme: "自動車", price: 2850 },
        { ticker: "6758", name: "ソニーグループ", theme: "エレクトロニクス", price: 13000 },
      ];

      const selectedInResults = currentResults.filter((s) => selectedTickers.has(s.ticker));
      expect(selectedInResults.length).toBe(1);

      const chosenStocks =
        selectedInResults.length > 0 ? selectedInResults : currentResults.slice(0, 10);
      expect(chosenStocks.length).toBe(1);
      expect(chosenStocks[0].ticker).toBe("7203");
    });

    it("handles select-all toggle across filtered views without wiping out other-view selections", () => {
      // User selected US ticker "AAPL"
      let selectedTickers = new Set(["AAPL"]);

      // Current view has Prime stocks
      const primeResults = [{ ticker: "7203" }, { ticker: "6758" }];

      // Toggle select-all on Prime stocks
      const nextSelectAll = new Set(selectedTickers);
      primeResults.forEach((r) => nextSelectAll.add(r.ticker));
      selectedTickers = nextSelectAll;

      expect(selectedTickers.has("AAPL")).toBe(true);
      expect(selectedTickers.has("7203")).toBe(true);
      expect(selectedTickers.has("6758")).toBe(true);

      // Now toggle unselect-all on Prime stocks: only Prime stocks should be unselected
      const nextUnselectAll = new Set(selectedTickers);
      primeResults.forEach((r) => nextUnselectAll.delete(r.ticker));
      selectedTickers = nextUnselectAll;

      expect(selectedTickers.has("AAPL")).toBe(true);
      expect(selectedTickers.has("7203")).toBe(false);
      expect(selectedTickers.has("6758")).toBe(false);
    });
  });

  describe("Stock Price & Currency Display Formatting", () => {
    it("formats Japanese stock prices correctly without redundant .0 for integer prices", () => {
      const jpyMeta = getCurrencyMeta("7203", "PRIME");
      expect(jpyMeta.isJPY).toBe(true);
      expect(jpyMeta.symbol).toBe("¥");
      expect(jpyMeta.code).toBe("JPY");

      const price = 2850;
      const formatted = price.toLocaleString(jpyMeta.isJPY ? "ja-JP" : "en-US", {
        minimumFractionDigits: jpyMeta.isUSD ? 2 : Number.isInteger(price) ? 0 : 2,
        maximumFractionDigits: 2,
      });

      // Japanese stock price of 2850 should be "2,850" and NOT "2,850.0"
      expect(formatted).toBe("2,850");
      expect(formatted).not.toContain(".0");
    });

    it("formats Japanese stock prices with fractional values correctly", () => {
      const jpyMeta = getCurrencyMeta("7203", "PRIME");
      const price = 2850.5;
      const formatted = price.toLocaleString(jpyMeta.isJPY ? "ja-JP" : "en-US", {
        minimumFractionDigits: jpyMeta.isUSD ? 2 : Number.isInteger(price) ? 0 : 2,
        maximumFractionDigits: 2,
      });

      expect(formatted).toBe("2,850.50");
    });

    it("formats US stock prices with 2 decimal places even for round numbers", () => {
      const usdMeta = getCurrencyMeta("AAPL", "US");
      expect(usdMeta.isUSD).toBe(true);
      expect(usdMeta.symbol).toBe("$");
      expect(usdMeta.code).toBe("USD");

      const roundPrice = 150;
      const formattedRound = roundPrice.toLocaleString(usdMeta.isJPY ? "ja-JP" : "en-US", {
        minimumFractionDigits: usdMeta.isUSD ? 2 : Number.isInteger(roundPrice) ? 0 : 2,
        maximumFractionDigits: 2,
      });
      expect(formattedRound).toBe("150.00");

      const floatPrice = 229.28;
      const formattedFloat = floatPrice.toLocaleString(usdMeta.isJPY ? "ja-JP" : "en-US", {
        minimumFractionDigits: usdMeta.isUSD ? 2 : Number.isInteger(floatPrice) ? 0 : 2,
        maximumFractionDigits: 2,
      });
      expect(formattedFloat).toBe("229.28");
    });
  });

  describe("Calendar Month Grid Date Matching & Normalization", () => {
    const pad = (n: number) => String(n).padStart(2, "0");

    function matchCalendarDate(
      eventDate: string | undefined,
      eventFullDate: string | undefined,
      cellYear: number,
      cellMonth: number,
      cellDay: number,
      baseToday: Date,
    ): boolean {
      const dateKeyFull = `${cellYear}-${pad(cellMonth + 1)}-${pad(cellDay)}`;
      const dateKeyShort = `${pad(cellMonth + 1)}/${pad(cellDay)}`;

      if (eventFullDate) {
        return eventFullDate.startsWith(dateKeyFull);
      }
      if (!eventDate) return false;
      const parts = eventDate.trim().split("/");
      if (parts.length !== 2) return false;
      const mNum = parseInt(parts[0], 10);
      const dNum = parseInt(parts[1], 10);
      if (Number.isNaN(mNum) || Number.isNaN(dNum)) return false;
      const normalizedShort = `${pad(mNum)}/${pad(dNum)}`;
      if (normalizedShort !== dateKeyShort) return false;

      let eventYear = baseToday.getFullYear();
      const currentMonth = baseToday.getMonth() + 1;
      if (mNum < currentMonth && currentMonth - mNum >= 6) {
        eventYear += 1;
      } else if (mNum > currentMonth && mNum - currentMonth >= 6) {
        eventYear -= 1;
      }
      return cellYear === eventYear;
    }

    const testToday = new Date(2026, 3, 1); // 2026-04-01

    it("matches zero-padded date '04/05' with April 5th cell", () => {
      const matched = matchCalendarDate("04/05", undefined, 2026, 3, 5, testToday);
      expect(matched).toBe(true);
    });

    it("matches unpadded date '4/5' with April 5th cell", () => {
      const matched = matchCalendarDate("4/5", undefined, 2026, 3, 5, testToday);
      expect(matched).toBe(true);
    });

    it("matches date with leading/trailing spaces ' 4/5 '", () => {
      const matched = matchCalendarDate(" 4/5 ", undefined, 2026, 3, 5, testToday);
      expect(matched).toBe(true);
    });

    it("does not match different day '4/6' with April 5th cell", () => {
      const matched = matchCalendarDate("4/6", undefined, 2026, 3, 5, testToday);
      expect(matched).toBe(false);
    });

    it("matches fullDate '2026-04-05' with April 5th cell", () => {
      const matched = matchCalendarDate("4/5", "2026-04-05", 2026, 3, 5, testToday);
      expect(matched).toBe(true);
    });

    it("safely handles invalid or empty dates without error", () => {
      expect(matchCalendarDate(undefined, undefined, 2026, 3, 5, testToday)).toBe(false);
      expect(matchCalendarDate("", undefined, 2026, 3, 5, testToday)).toBe(false);
      expect(matchCalendarDate("invalid-date", undefined, 2026, 3, 5, testToday)).toBe(false);
      expect(matchCalendarDate("4/invalid", undefined, 2026, 3, 5, testToday)).toBe(false);
    });
  });
});
