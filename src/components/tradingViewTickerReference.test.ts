import { describe, expect, it } from "vitest";
import { TICKER_SYMBOLS } from "./TradingViewTickerTape";
import {
  TICKER_MAPPINGS,
  formatTickerPrice,
  formatTickerChange,
  formatTickerChangePercent,
} from "../../worker/index";

/**
 * Tests for TradingViewTickerTape real-time quotes and fallback consistency.
 */
describe("TradingViewTickerTape live quotes and fallback consistency", () => {
  it("ships fallback prices for every symbol to prevent layout shifts", () => {
    expect(TICKER_SYMBOLS.length).toBeGreaterThan(0);
    for (const item of TICKER_SYMBOLS) {
      expect(typeof item.defaultPrice).toBe("string");
      expect(item.defaultPrice.length).toBeGreaterThan(0);
      expect(typeof item.defaultChangePercent).toBe("string");
    }
  });

  it("keeps change flags consistent with the displayed sign", () => {
    for (const item of TICKER_SYMBOLS) {
      const positiveChange = item.defaultChange.trim().startsWith("+");
      expect(item.isPositive).toBe(positiveChange);
    }
  });

  it("matches TICKER_MAPPINGS symbols with front-end TICKER_SYMBOLS", () => {
    expect(TICKER_MAPPINGS.length).toBe(TICKER_SYMBOLS.length);
    for (let i = 0; i < TICKER_SYMBOLS.length; i++) {
      expect(TICKER_MAPPINGS[i].proName).toBe(TICKER_SYMBOLS[i].proName);
      expect(TICKER_MAPPINGS[i].symbol.length).toBeGreaterThan(0);
    }
  });

  it("correctly formats ticker prices with two decimal places and commas", () => {
    expect(formatTickerPrice(38980.5)).toBe("38,980.50");
    expect(formatTickerPrice(155.2)).toBe("155.20");
    expect(formatTickerPrice(71.45)).toBe("71.45");
  });

  it("correctly formats ticker price changes with signs", () => {
    expect(formatTickerChange(145.2)).toBe("+145.20");
    expect(formatTickerChange(-8.4)).toBe("-8.40");
    expect(formatTickerChange(0)).toBe("0.00");
  });

  it("correctly formats ticker percentage changes with %", () => {
    expect(formatTickerChangePercent(0.37)).toBe("+0.37%");
    expect(formatTickerChangePercent(-0.31)).toBe("-0.31%");
    expect(formatTickerChangePercent(0)).toBe("0.00%");
  });
});
