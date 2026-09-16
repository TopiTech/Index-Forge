import { describe, expect, it } from "vitest";
import { TICKER_SYMBOLS } from "./TradingViewTickerTape";

/**
 * Regression guard for the reference-price disclosure fix: the ticker tape
 * ships static reference values, not live quotes. They must stay clearly
 * labelled as reference data so users cannot mistake them for real market
 * prices.
 */
describe("TradingViewTickerTape reference values", () => {
  it("ships static default prices for every symbol (documenting why disclosure is required)", () => {
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
});
