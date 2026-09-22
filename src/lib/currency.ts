/**
 * Detect currency symbol based on stock ticker.
 * Japanese Tokyo exchange tickers (start with a digit) use "¥".
 * US/global tickers (e.g. AAPL, NVDA) use "$".
 */
export function getStockCurrency(ticker: string): string {
  const trimmed = ticker.trim();
  if (/^\d/.test(trimmed)) {
    return "¥";
  }
  return "$";
}

/**
 * Format a stock price with currency prefix and proper decimal places.
 * Japanese stocks: rounded to integer unless it has fractional part, e.g. "¥2,850".
 * US/global stocks: 2 decimals, e.g. "$182.50".
 */
export function formatStockPrice(price: number, ticker: string): string {
  if (!Number.isFinite(price) || price <= 0) return "---";
  const currency = getStockCurrency(ticker);
  if (currency === "¥") {
    return `¥${price.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format stock price change with currency symbol and +/- sign.
 * Japanese stocks: e.g. "+¥25", "-¥10".
 * US/global stocks: e.g. "+$1.50", "-$0.75".
 */
export function formatStockChange(change: number, ticker: string): string {
  if (!Number.isFinite(change)) return "---";
  const currency = getStockCurrency(ticker);
  const sign = change >= 0 ? "+" : "-";
  const abs = Math.abs(change);
  if (currency === "¥") {
    return `${sign}¥${abs.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;
  }
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
