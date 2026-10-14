/**
 * Currency utilities for IndexForge.
 * Robust detection and formatting for Japanese Yen (JPY) and US Dollar (USD).
 */

export type CurrencyCode = "JPY" | "USD";

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: "¥" | "$";
  unit: "円" | "ドル";
  isJPY: boolean;
  isUSD: boolean;
}

/**
 * Detect currency code based on stock ticker and optional market tag.
 * Japanese Tokyo exchange tickers (digits, 130A-style, .T, TSE: prefix),
 * Japanese indices (^N225, ^TOPX), and USDJPY exchange rate use "JPY".
 * US/global equities (AAPL, NVDA), US indices (^GSPC), and USD cryptos use "USD".
 */
export function detectStockCurrency(
  ticker?: string | null,
  market?: string | null,
): CurrencyCode {
  if (market === "US") return "USD";
  if (
    market === "PRIME" ||
    market === "STANDARD" ||
    market === "GROWTH" ||
    market === "ETF" ||
    market === "REIT" ||
    market === "PRO" ||
    market === "TSE" ||
    market === "JP"
  ) {
    return "JPY";
  }

  const rawTrimmed = typeof ticker === "string" ? ticker.trim() : "";
  if (!rawTrimmed) return "USD";
  const trimmed = rawTrimmed
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase();

  // Japanese benchmarks and currency pairs quoted in JPY (USD/JPY, EUR/JPY, GBP/JPY, etc.)
  if (
    trimmed === "^N225" ||
    trimmed === "^TOPX" ||
    trimmed === "^TOPIXG" ||
    trimmed === "INDEX:NKY" ||
    trimmed === "TSE:TOPIX" ||
    trimmed === "TSE:2516" ||
    trimmed.endsWith("JPY=X") ||
    trimmed.endsWith("/JPY") ||
    trimmed.startsWith("FX_IDC:USDJPY") ||
    trimmed.startsWith("FX:USDJPY") ||
    trimmed.startsWith("FX:EURJPY") ||
    trimmed.startsWith("FX:GBPJPY") ||
    (trimmed.startsWith("FX") && trimmed.includes("JPY"))
  ) {
    return "JPY";
  }

  // Japanese ticker patterns:
  // - Starts with a digit: "7203", "9984", "130A"
  // - Suffix ".T": "6758.T"
  // - Prefix "TSE:" or "TYO:": "TSE:7203", "TYO:7203"
  if (
    /^\d/.test(trimmed) ||
    trimmed.endsWith(".T") ||
    trimmed.startsWith("TSE:") ||
    trimmed.startsWith("TYO:")
  ) {
    return "JPY";
  }

  return "USD";
}

/**
 * Detect currency symbol based on stock ticker (backward-compatible).
 * Returns "¥" for Japanese assets, "$" for US/global assets.
 */
export function getStockCurrency(ticker?: string | null, market?: string | null): string {
  // Defensive guard for non-string, null, or empty ticker if market not explicitly specified
  if (typeof ticker !== "string" && !market) {
    return "$";
  }
  const trimmed = typeof ticker === "string" ? ticker.trim() : "";
  if (!trimmed && !market) {
    return "$";
  }
  return detectStockCurrency(ticker, market) === "JPY" ? "¥" : "$";
}

/**
 * Get full metadata for currency formatting.
 */
export function getCurrencyMeta(
  ticker?: string | null,
  market?: string | null,
): CurrencyMeta {
  const code = detectStockCurrency(ticker, market);
  const isJPY = code === "JPY";
  return {
    code,
    symbol: isJPY ? "¥" : "$",
    unit: isJPY ? "円" : "ドル",
    isJPY,
    isUSD: !isJPY,
  };
}

export interface FormatPriceOptions {
  market?: string | null;
  /** Format with code suffix, e.g. "2,850 JPY" or "229.28 USD" */
  showCode?: boolean;
  /** Format with Japanese unit suffix, e.g. "2,850 円" or "229.28 ドル" */
  showUnit?: boolean;
}

/**
 * Format a stock price with currency prefix/suffix and proper decimal places.
 * Japanese stocks: rounded to integer unless it has fractional part, e.g. "¥2,850".
 * US/global stocks: 2 decimals, e.g. "$182.50".
 */
export function formatStockPrice(
  price?: number | null,
  ticker?: string | null,
  options?: FormatPriceOptions,
): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return "---";
  const meta = getCurrencyMeta(ticker, options?.market);

  if (options?.showCode) {
    if (meta.isJPY) {
      return `${price.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} JPY`;
    }
    return `${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  }

  if (options?.showUnit) {
    if (meta.isJPY) {
      return `${price.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} 円`;
    }
    return `${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ドル`;
  }

  if (meta.isJPY) {
    return `¥${price.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format stock price change with currency symbol and +/- sign.
 * Japanese stocks: e.g. "+¥25", "-¥10".
 * US/global stocks: e.g. "+$1.50", "-$0.75".
 */
export function formatStockChange(
  change?: number | null,
  ticker?: string | null,
  options?: FormatPriceOptions,
): string {
  if (typeof change !== "number" || !Number.isFinite(change)) return "---";
  const meta = getCurrencyMeta(ticker, options?.market);
  const sign = change >= 0 ? "+" : "-";
  const abs = Math.abs(change);

  if (options?.showCode) {
    if (meta.isJPY) {
      return `${sign}${abs.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} JPY`;
    }
    return `${sign}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  }

  if (options?.showUnit) {
    if (meta.isJPY) {
      return `${sign}${abs.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} 円`;
    }
    return `${sign}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ドル`;
  }

  if (meta.isJPY) {
    return `${sign}¥${abs.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;
  }
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a US dollar price with estimated Japanese Yen conversion.
 * e.g. "$229.28 (約35,538円)"
 */
export function formatUsdWithJpyEstimate(
  usdPrice?: number | null,
  usdJpyRate: number = 155,
): string {
  if (typeof usdPrice !== "number" || !Number.isFinite(usdPrice) || usdPrice <= 0) return "---";
  const formattedUsd = `$${usdPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rate = Number.isFinite(usdJpyRate) && usdJpyRate > 0 ? usdJpyRate : 155;
  const estimatedJpy = Math.round(usdPrice * rate);
  return `${formattedUsd} (約${estimatedJpy.toLocaleString("ja-JP")}円)`;
}

