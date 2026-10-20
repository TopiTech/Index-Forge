/**
 * Normalize a ticker to the form used by Yahoo Finance.
 * Japanese Tokyo exchange tickers (start with a digit) map to Tokyo Exchange (.T).
 * US/global tickers (e.g. AAPL) and index/forex symbols (^N225, USDJPY=X) remain as-is.
 */
export function toYahooSymbol(ticker: string): string {
  if (typeof ticker !== "string" || !ticker.trim()) return "";
  let trimmed = ticker
    .trim()
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase();
  if (trimmed.startsWith("TSE:") || trimmed.startsWith("TYO:")) {
    trimmed = trimmed.substring(4).trim();
  }
  if (trimmed.includes(".") || trimmed.startsWith("^") || trimmed.endsWith("=X")) {
    return trimmed;
  }
  if (/^\d/.test(trimmed)) {
    return `${trimmed}.T`;
  }
  return trimmed;
}
