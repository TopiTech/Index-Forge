/**
 * Factory for the quote fixtures used by the test suite.
 *
 * `StockQuoteFundamentals` carries a large number of required fields. Writing
 * them out inline in every test made the fixtures drift away from the real
 * contract and buried the fields a test actually cares about. The factory
 * provides a complete, valid baseline so a test only states its overrides.
 */
import type { StockQuoteFundamentals } from "../lib/marketDataService";

export function createStockQuote(
  overrides: Partial<StockQuoteFundamentals> = {},
): StockQuoteFundamentals {
  return {
    ticker: "7203",
    name: "トヨタ自動車",
    theme: "自動車",
    sector: "自動車",
    market: "PRIME",
    price: 2850,
    change: 15,
    changePercent: 0.53,
    volume: 12_000_000,
    previousClose: 2835,
    dayHigh: 2870,
    dayLow: 2830,
    yearHigh: 3200,
    yearLow: 2400,
    marketCap: 48_000_000,
    per: 10.2,
    pbr: 1.1,
    dividendYield: 2.4,
    roe: 11.2,
    equityRatio: 45,
    eps: 279.4,
    dps: 68.4,
    sparkline: [2800, 2820, 2810, 2835, 2850],
    technicalSignal: "NEUTRAL",
    historicalFinances: [],
    ...overrides,
  };
}
