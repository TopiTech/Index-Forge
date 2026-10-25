/**
 * Canonical ticker normalization shared by every layer.
 *
 * Three spellings of this rule used to coexist (`indexEngine.normalizeTicker`,
 * the first half of `toYahooSymbol`, and a private copy in `navigation.ts`),
 * so a full-width ticker could be accepted by one form and refused by another.
 * This module is the single home: it has no imports, so both the Worker bundle
 * (via `src/lib`) and the browser can use it.
 */

/**
 * Base normalization: trim, convert full-width characters to half-width, and
 * upper-case. This is the form the API contract (`isValidTicker`) judges.
 */
export function normalizeTicker(ticker?: string | null): string {
  if (typeof ticker !== "string") return "";
  return ticker
    .trim()
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase();
}

/**
 * Normalize a ticker to the form used by Yahoo Finance.
 * Japanese Tokyo exchange tickers (start with a digit) map to Tokyo Exchange (.T).
 * US/global tickers (e.g. AAPL) and index/forex symbols (^N225, USDJPY=X) remain as-is.
 */
export function toYahooSymbol(ticker: string): string {
  const normalized = normalizeTicker(ticker);
  if (!normalized) return "";
  let symbol = normalized;
  if (symbol.startsWith("TSE:") || symbol.startsWith("TYO:")) {
    symbol = symbol.substring(4).trim();
  }
  if (symbol.includes(".") || symbol.startsWith("^") || symbol.endsWith("=X")) {
    return symbol;
  }
  if (/^\d/.test(symbol)) {
    return `${symbol}.T`;
  }
  return symbol;
}
