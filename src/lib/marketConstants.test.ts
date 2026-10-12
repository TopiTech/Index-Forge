import { describe, it, expect } from "vitest";
import {
  BASELINE_ASSET_QUOTES,
  DEFAULT_USD_JPY_RATE,
  DEFAULT_SECTOR_DEFINITIONS,
  FALLBACK_MARKET_NEWS_TEMPLATES,
} from "../data/marketConstants";

describe("marketConstants", () => {
  it("defines all major global market asset categories", () => {
    expect(BASELINE_ASSET_QUOTES.length).toBeGreaterThanOrEqual(10);
    const categories = new Set(BASELINE_ASSET_QUOTES.map((a) => a.category));
    expect(categories.has("INDEX")).toBe(true);
    expect(categories.has("FX")).toBe(true);
    expect(categories.has("COMMODITY")).toBe(true);
    expect(categories.has("BOND")).toBe(true);
    expect(categories.has("CRYPTO")).toBe(true);
  });

  it("has valid non-zero finite baseline prices and tickers", () => {
    for (const asset of BASELINE_ASSET_QUOTES) {
      expect(asset.symbol.length).toBeGreaterThan(0);
      expect(asset.querySymbol.length).toBeGreaterThan(0);
      expect(asset.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(asset.baselinePrice)).toBe(true);
      expect(asset.baselinePrice).toBeGreaterThan(0);
      expect(Number.isFinite(asset.baselineChange)).toBe(true);
      expect(Number.isFinite(asset.baselineChangePercent)).toBe(true);
    }
  });

  it("contains major benchmark indices and realistic default FX rate", () => {
    const symbols = BASELINE_ASSET_QUOTES.map((a) => a.symbol);
    expect(symbols).toContain("^N225");
    expect(symbols).toContain("^TOPX");
    expect(symbols).toContain("^GSPC");
    expect(symbols).toContain("USDJPY=X");
    expect(DEFAULT_USD_JPY_RATE).toBeGreaterThan(100);
    expect(DEFAULT_USD_JPY_RATE).toBeLessThan(250);
  });

  it("defines comprehensive sector definitions with representative tickers", () => {
    expect(DEFAULT_SECTOR_DEFINITIONS.length).toBe(10);
    for (const sec of DEFAULT_SECTOR_DEFINITIONS) {
      expect(sec.name.length).toBeGreaterThan(0);
      expect(sec.tickers.length).toBeGreaterThanOrEqual(2);
      expect(sec.market).toBe("TSE");
    }
  });

  it("provides well-structured fallback news templates", () => {
    expect(FALLBACK_MARKET_NEWS_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const news of FALLBACK_MARKET_NEWS_TEMPLATES) {
      expect(news.id).toMatch(/^news-/);
      expect(news.title.length).toBeGreaterThan(10);
      expect(news.source.length).toBeGreaterThan(0);
    }
  });
});
