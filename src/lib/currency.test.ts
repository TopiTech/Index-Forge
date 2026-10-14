import { describe, it, expect } from "vitest";
import {
  detectStockCurrency,
  getStockCurrency,
  getCurrencyMeta,
  formatStockPrice,
  formatStockChange,
  formatUsdWithJpyEstimate,
} from "./currency";

describe("Currency Utilities (Enhanced & Hardened)", () => {
  describe("detectStockCurrency", () => {
    it("correctly identifies Japanese stocks and indices as JPY", () => {
      // 4-digit code
      expect(detectStockCurrency("7203")).toBe("JPY");
      expect(detectStockCurrency("9984")).toBe("JPY");
      // Alphanumeric new code
      expect(detectStockCurrency("130A")).toBe("JPY");
      // Suffix .T
      expect(detectStockCurrency("6758.T")).toBe("JPY");
      // Prefixes
      expect(detectStockCurrency("TSE:7203")).toBe("JPY");
      expect(detectStockCurrency("TYO:7203")).toBe("JPY");
      // Benchmarks
      expect(detectStockCurrency("^N225")).toBe("JPY");
      expect(detectStockCurrency("^TOPX")).toBe("JPY");
      expect(detectStockCurrency("^TOPIXG")).toBe("JPY");
      expect(detectStockCurrency("INDEX:NKY")).toBe("JPY");
      // Currency pairs quoted in Yen
      expect(detectStockCurrency("USDJPY=X")).toBe("JPY");
      expect(detectStockCurrency("EURJPY=X")).toBe("JPY");
      expect(detectStockCurrency("GBPJPY=X")).toBe("JPY");
      expect(detectStockCurrency("FX_IDC:USDJPY")).toBe("JPY");
      expect(detectStockCurrency("FX:EURJPY")).toBe("JPY");
      // Full-width Japanese ticker code
      expect(detectStockCurrency("７２０３")).toBe("JPY");
      // Market flags
      expect(detectStockCurrency("ANY", "PRIME")).toBe("JPY");
      expect(detectStockCurrency("ANY", "STANDARD")).toBe("JPY");
      expect(detectStockCurrency("ANY", "GROWTH")).toBe("JPY");
    });

    it("correctly identifies US equities, cryptos, and US indices as USD", () => {
      expect(detectStockCurrency("AAPL")).toBe("USD");
      expect(detectStockCurrency("NVDA")).toBe("USD");
      expect(detectStockCurrency("MSFT")).toBe("USD");
      expect(detectStockCurrency("^GSPC")).toBe("USD");
      expect(detectStockCurrency("BTC-USD")).toBe("USD");
      expect(detectStockCurrency("ANY", "US")).toBe("USD");
      expect(detectStockCurrency(null)).toBe("USD");
      expect(detectStockCurrency(undefined)).toBe("USD");
      expect(detectStockCurrency("")).toBe("USD");
    });
  });

  describe("getStockCurrency backward compatibility", () => {
    it("returns '¥' for JPY assets and '$' for USD/global assets", () => {
      expect(getStockCurrency("7203")).toBe("¥");
      expect(getStockCurrency("130A")).toBe("¥");
      expect(getStockCurrency("6758.T")).toBe("¥");
      expect(getStockCurrency("TSE:7203")).toBe("¥");
      expect(getStockCurrency("^N225")).toBe("¥");
      expect(getStockCurrency("AAPL")).toBe("$");
      expect(getStockCurrency("NVDA")).toBe("$");
      expect(getStockCurrency(null)).toBe("$");
      expect(getStockCurrency("")).toBe("$");
    });
  });

  describe("getCurrencyMeta", () => {
    it("provides complete metadata bundle", () => {
      const jpyMeta = getCurrencyMeta("7203");
      expect(jpyMeta.code).toBe("JPY");
      expect(jpyMeta.symbol).toBe("¥");
      expect(jpyMeta.unit).toBe("円");
      expect(jpyMeta.isJPY).toBe(true);
      expect(jpyMeta.isUSD).toBe(false);

      const usdMeta = getCurrencyMeta("NVDA");
      expect(usdMeta.code).toBe("USD");
      expect(usdMeta.symbol).toBe("$");
      expect(usdMeta.unit).toBe("ドル");
      expect(usdMeta.isJPY).toBe(false);
      expect(usdMeta.isUSD).toBe(true);
    });
  });

  describe("formatStockPrice", () => {
    it("formats Japanese stock prices with ¥ and integer or max 2 decimals", () => {
      expect(formatStockPrice(2850, "7203")).toBe("¥2,850");
      expect(formatStockPrice(2850.5, "7203")).toBe("¥2,850.5");
      expect(formatStockPrice(2850, "7203", { showCode: true })).toBe("2,850 JPY");
      expect(formatStockPrice(2850, "7203", { showUnit: true })).toBe("2,850 円");
    });

    it("formats US stock prices with $ and exactly 2 decimals", () => {
      expect(formatStockPrice(229.28, "NVDA")).toBe("$229.28");
      expect(formatStockPrice(229, "NVDA")).toBe("$229.00");
      expect(formatStockPrice(229.28, "NVDA", { showCode: true })).toBe("229.28 USD");
      expect(formatStockPrice(229.28, "NVDA", { showUnit: true })).toBe("229.28 ドル");
    });

    it("handles zero, negative, or invalid prices safely", () => {
      expect(formatStockPrice(0, "7203")).toBe("---");
      expect(formatStockPrice(-10, "NVDA")).toBe("---");
      expect(formatStockPrice(null, "7203")).toBe("---");
      expect(formatStockPrice(NaN, "NVDA")).toBe("---");
    });
  });

  describe("formatStockChange", () => {
    it("formats signed changes properly", () => {
      expect(formatStockChange(25, "7203")).toBe("+¥25");
      expect(formatStockChange(-10, "7203")).toBe("-¥10");
      expect(formatStockChange(1.5, "NVDA")).toBe("+$1.50");
      expect(formatStockChange(-0.75, "NVDA")).toBe("-$0.75");
      expect(formatStockChange(25, "7203", { showCode: true })).toBe("+25 JPY");
      expect(formatStockChange(25, "7203", { showUnit: true })).toBe("+25 円");
      expect(formatStockChange(1.5, "NVDA", { showCode: true })).toBe("+1.50 USD");
      expect(formatStockChange(1.5, "NVDA", { showUnit: true })).toBe("+1.50 ドル");
    });
  });

  describe("formatUsdWithJpyEstimate", () => {
    it("formats USD price with estimated JPY equivalent", () => {
      expect(formatUsdWithJpyEstimate(229.28, 155)).toBe("$229.28 (約35,538円)");
      expect(formatUsdWithJpyEstimate(100, 150)).toBe("$100.00 (約15,000円)");
      expect(formatUsdWithJpyEstimate(null)).toBe("---");
    });
  });
});
