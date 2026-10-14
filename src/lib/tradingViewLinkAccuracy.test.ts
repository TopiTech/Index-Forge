import { describe, it, expect } from "vitest";
import { resolveTradingViewSymbol, getTradingViewWebUrl } from "./tradingView";

describe("TradingView Link Accuracy & Symbol Resolution (404 Prevention)", () => {
  describe("Major Market Indices Link Accuracy", () => {
    it("generates correct, working TradingView symbol and URL for 日経平均 (Nikkei 225)", () => {
      const res = resolveTradingViewSymbol("^N225", false);
      expect(res.symbol).toBe("INDEX:NKY");
      expect(res.isSupported).toBe(true);

      const url = getTradingViewWebUrl("^N225");
      expect(url).toBe("https://jp.tradingview.com/symbols/TVC-NI225/");
      expect(url).not.toContain("TSE-^");
      expect(url).not.toContain("404");
    });

    it("generates correct, working TradingView symbol and URL for TOPIX (東証株価指数)", () => {
      const res = resolveTradingViewSymbol("^TOPX", false);
      expect(res.symbol).toBe("TSE:TOPIX");
      expect(res.isSupported).toBe(true);

      const url = getTradingViewWebUrl("^TOPX");
      expect(url).toBe("https://jp.tradingview.com/symbols/TSE-TOPIX/");
      expect(url).not.toContain("TSE-^");
    });

    it("generates correct TradingView URL for 東証グロース250 (^TOPIXG)", () => {
      const res = resolveTradingViewSymbol("^TOPIXG", false);
      expect(res.symbol).toBe("TSE:2516");
      expect(res.isSupported).toBe(true);

      const url = getTradingViewWebUrl("^TOPIXG");
      expect(url).toBe("https://jp.tradingview.com/symbols/TSE-2516/");
    });

    it("generates correct TradingView URLs for US Market Indices (S&P 500, NASDAQ, Dow)", () => {
      expect(getTradingViewWebUrl("^GSPC", "US")).toBe(
        "https://jp.tradingview.com/symbols/FOREXCOM-SPXUSD/",
      );
      expect(getTradingViewWebUrl("^IXIC", "US")).toBe(
        "https://jp.tradingview.com/symbols/NASDAQ-IXIC/",
      );
      expect(getTradingViewWebUrl("^DJI", "US")).toBe(
        "https://jp.tradingview.com/symbols/FOREXCOM-DJI/",
      );
    });
  });

  describe("Forex and Crypto Pairs", () => {
    it("resolves currencies and cryptos without TSE- prefix corruption", () => {
      expect(getTradingViewWebUrl("USDJPY=X")).toBe(
        "https://jp.tradingview.com/symbols/FX-USDJPY/",
      );
      expect(getTradingViewWebUrl("EURUSD=X")).toBe(
        "https://jp.tradingview.com/symbols/FX-EURUSD/",
      );
      expect(getTradingViewWebUrl("BTC-USD")).toBe(
        "https://jp.tradingview.com/symbols/COINBASE-BTCUSD/",
      );
    });

    it("handles colon-prefixed symbols from ticker tape", () => {
      expect(getTradingViewWebUrl("INDEX:NKY")).toBe(
        "https://jp.tradingview.com/symbols/INDEX-NKY/",
      );
      expect(getTradingViewWebUrl("FX:USDJPY")).toBe(
        "https://jp.tradingview.com/symbols/FX-USDJPY/",
      );
      expect(getTradingViewWebUrl("FOREXCOM:SPXUSD")).toBe(
        "https://jp.tradingview.com/symbols/FOREXCOM-SPXUSD/",
      );
    });
  });

  describe("Equities (Japanese and US Stocks)", () => {
    it("formats Japanese stock tickers with TSE- prefix and strips .T suffix", () => {
      expect(getTradingViewWebUrl("7203", "PRIME")).toBe(
        "https://jp.tradingview.com/symbols/TSE-7203/",
      );
      expect(getTradingViewWebUrl("7203.T", "PRIME")).toBe(
        "https://jp.tradingview.com/symbols/TSE-7203/",
      );
      expect(getTradingViewWebUrl("6758", "PRIME")).toBe(
        "https://jp.tradingview.com/symbols/TSE-6758/",
      );
      expect(getTradingViewWebUrl("130A", "GROWTH")).toBe(
        "https://jp.tradingview.com/symbols/TSE-130A/",
      );
    });

    it("formats US stock tickers directly without exchange prefix", () => {
      expect(getTradingViewWebUrl("AAPL", "US")).toBe(
        "https://jp.tradingview.com/symbols/AAPL/",
      );
      expect(getTradingViewWebUrl("NVDA", "US")).toBe(
        "https://jp.tradingview.com/symbols/NVDA/",
      );
      expect(getTradingViewWebUrl("MSFT", "US")).toBe(
        "https://jp.tradingview.com/symbols/MSFT/",
      );
    });
  });
});
