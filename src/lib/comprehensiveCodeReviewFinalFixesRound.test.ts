import { describe, it, expect } from "vitest";
import {
  formatStockChange,
  formatStockPrice,
  formatUsdWithJpyEstimate,
  detectStockCurrency,
} from "./currency";
import {
  getDividendEvaluation,
  getRoeEvaluation,
  getPbrEvaluation,
  getMarketCapEvaluation,
} from "../components/StockDetailPage";
import { formatTickerPrice, formatTickerChange } from "../../worker/internal";

describe("Comprehensive Code Review Final Fixes Verification Suite", () => {
  describe("1. Currency and Stock Change Formatting", () => {
    it("formats 0 and near-zero changes neutrally without a misleading + sign for JPY", () => {
      expect(formatStockChange(0, "7203")).toBe("¥0");
      expect(formatStockChange(0.001, "7203")).toBe("¥0");
      expect(formatStockChange(-0.001, "7203")).toBe("¥0");
      expect(formatStockChange(0, "7203", { showCode: true })).toBe("0 JPY");
      expect(formatStockChange(0, "7203", { showUnit: true })).toBe("0 円");
    });

    it("formats 0 and near-zero changes neutrally without a misleading + sign for USD", () => {
      expect(formatStockChange(0, "AAPL")).toBe("$0.00");
      expect(formatStockChange(0.001, "NVDA")).toBe("$0.00");
      expect(formatStockChange(-0.001, "MSFT")).toBe("$0.00");
      expect(formatStockChange(0, "AAPL", { showCode: true })).toBe("0.00 USD");
      expect(formatStockChange(0, "AAPL", { showUnit: true })).toBe("0.00 ドル");
    });

    it("formats positive and negative changes with explicit signs", () => {
      expect(formatStockChange(35, "7203")).toBe("+¥35");
      expect(formatStockChange(-15, "7203")).toBe("-¥15");
      expect(formatStockChange(2.5, "AAPL")).toBe("+$2.50");
      expect(formatStockChange(-1.75, "AAPL")).toBe("-$1.75");
    });

    it("formatStockPrice accurately formats JPY and USD quotes", () => {
      expect(formatStockPrice(2850, "7203")).toBe("¥2,850");
      expect(formatStockPrice(182.5, "AAPL")).toBe("$182.50");
      expect(formatStockPrice(null, "7203")).toBe("---");
    });

    it("formatUsdWithJpyEstimate converts dynamically with custom or default USD/JPY rate", () => {
      expect(formatUsdWithJpyEstimate(100, 155)).toBe("$100.00 (約15,500円)");
      expect(formatUsdWithJpyEstimate(200, 150)).toBe("$200.00 (約30,000円)");
      expect(formatUsdWithJpyEstimate(null)).toBe("---");
      expect(formatUsdWithJpyEstimate(0)).toBe("---");
    });
  });

  describe("2. StockDetailPage Fundamental KPI Evaluations", () => {
    it("getDividendEvaluation outputs Japanese financial convention notation", () => {
      // JPY stock with regular dividend
      expect(getDividendEvaluation(2.5, 50, "JPY", false)).toBe("1株配当: 50 円");
      // JPY stock with high dividend
      expect(getDividendEvaluation(4.2, 120, "JPY", false)).toBe("1株配当: 120 円 (高配当水準)");
      // US stock with dollar dividend
      expect(getDividendEvaluation(1.8, 1.25, "USD", false)).toBe("1株配当: $1.25");
      // Zero dividend or zero yield
      expect(getDividendEvaluation(0, 0, "JPY", false)).toBe("無配・内部留保/成長投資重視");
      expect(getDividendEvaluation(0, null, "USD", false)).toBe("無配・内部留保/成長投資重視");
      expect(getDividendEvaluation(null, 0, "JPY", false)).toBe("無配・内部留保/成長投資重視");
      // Macro asset
      expect(getDividendEvaluation(2.5, 50, "JPY", true)).toBe("1株配当: --");
    });

    it("getRoeEvaluation accurately handles high, medium, zero, and negative values", () => {
      expect(getRoeEvaluation(18.5, false)).toBe("極めて高い資本効率 (>15%)");
      expect(getRoeEvaluation(9.2, false)).toBe("資本効率良好 (目安: 8%以上)");
      expect(getRoeEvaluation(4.5, false)).toBe("標準水準 (8%未満)");
      expect(getRoeEvaluation(0, false)).toBe("収益性要改善 (低水準)");
      expect(getRoeEvaluation(-5.0, false)).toBe("収益性要改善 (低水準)");
      expect(getRoeEvaluation(null, false)).toBe("指数・マクロ指標対象外");
      expect(getRoeEvaluation(12, true)).toBe("指数・マクロ指標対象外");
    });

    it("getPbrEvaluation accurately classifies valuations", () => {
      expect(getPbrEvaluation(0.85, false)).toBe("割安 (解散価値1倍割れ)");
      expect(getPbrEvaluation(1.8, false)).toBe("適正〜標準水準 (1.0〜2.5倍)");
      expect(getPbrEvaluation(3.5, false)).toBe("成長期待水準 (2.5〜5.0倍)");
      expect(getPbrEvaluation(6.2, false)).toBe("高PBR・成長期待水準 (>5.0倍)");
      expect(getPbrEvaluation(0, false)).toBe("指数・マクロ指標対象外");
      expect(getPbrEvaluation(null, false)).toBe("指数・マクロ指標対象外");
      expect(getPbrEvaluation(1.2, true)).toBe("指数・マクロ指標対象外");
    });

    it("getMarketCapEvaluation classifies US and Japanese market capitalization tiers", () => {
      expect(getMarketCapEvaluation(250000, "US", false)).toBe("米国メガキャップ (1,000億ドル超)");
      expect(getMarketCapEvaluation(15000, "US", false)).toBe("米国大型優良株 (100億ドル超)");
      expect(getMarketCapEvaluation(500, "US", false)).toBe("米国市場上場株");
      expect(getMarketCapEvaluation(120000, "PRIME", false)).toBe("超大型優良株 (時価総額10兆円超)");
      expect(getMarketCapEvaluation(15000, "PRIME", false)).toBe("大型優良株 (時価総額1兆円超)");
      expect(getMarketCapEvaluation(2500, "PRIME", false)).toBe("中型株 (時価総額1,000億円超)");
      expect(getMarketCapEvaluation(500, "GROWTH", false)).toBe("東証グロース市場");
      expect(getMarketCapEvaluation(500, "STANDARD", false)).toBe("東証スタンダード市場");
      expect(getMarketCapEvaluation(500, "PRIME", true)).toBe("指数・マクロ資産");
    });
  });

  describe("3. Calendar and Market Currency Detection", () => {
    it("distinguishes US and Japanese events using detectStockCurrency", () => {
      // US equities
      expect(detectStockCurrency("AAPL")).toBe("USD");
      expect(detectStockCurrency("NVDA")).toBe("USD");
      expect(detectStockCurrency("MSFT")).toBe("USD");
      expect(detectStockCurrency("GOOGL")).toBe("USD");

      // Japanese equities
      expect(detectStockCurrency("7203")).toBe("JPY");
      expect(detectStockCurrency("6758")).toBe("JPY");
      expect(detectStockCurrency("9984")).toBe("JPY");
      expect(detectStockCurrency("8306")).toBe("JPY");

      // Market overrides
      expect(detectStockCurrency(undefined, "US")).toBe("USD");
      expect(detectStockCurrency(undefined, "PRIME")).toBe("JPY");
    });
  });

  describe("4. Worker Price & Change Formatting Functions", () => {
    it("formatTickerPrice safely formats finite prices and guards non-finite values", () => {
      expect(formatTickerPrice(1234.56)).toBe("1,234.56");
      expect(formatTickerPrice(100)).toBe("100.00");
      expect(formatTickerPrice(0)).toBe("0.00");
      expect(formatTickerPrice(Number.NaN)).toBe("0.00");
      expect(formatTickerPrice(Number.POSITIVE_INFINITY)).toBe("0.00");
      expect(formatTickerPrice(-10)).toBe("0.00");
    });

    it("formatTickerChange formats zero change neutrally", () => {
      expect(formatTickerChange(0)).toBe("0.00");
      expect(formatTickerChange(0.001)).toBe("0.00");
      expect(formatTickerChange(-0.001)).toBe("0.00");
      expect(formatTickerChange(12.34)).toBe("+12.34");
      expect(formatTickerChange(-5.67)).toBe("-5.67");
    });
  });

  describe("5. Worker /api/sync-prices Ticker Regex Validation", () => {
    it("validates tickers including underscores, dots, carats, equal signs, and hyphens", () => {
      const regex = /^[A-Za-z0-9.^=_-]+$/;
      expect(regex.test("7203")).toBe(true);
      expect(regex.test("AAPL")).toBe(true);
      expect(regex.test("^N225")).toBe(true);
      expect(regex.test("^GSPC")).toBe(true);
      expect(regex.test("USDJPY=X")).toBe(true);
      expect(regex.test("BTC-USD")).toBe(true);
      expect(regex.test("7203.T")).toBe(true);
      expect(regex.test("CUSTOM_INDEX_1")).toBe(true);
      expect(regex.test("MY_STOCK")).toBe(true);

      // Rejects malicious/invalid inputs
      expect(regex.test("7203; DROP TABLE users;")).toBe(false);
      expect(regex.test("<script>alert(1)</script>")).toBe(false);
      expect(regex.test("STOCK 123")).toBe(false);
      expect(regex.test("")).toBe(false);
    });
  });
});
