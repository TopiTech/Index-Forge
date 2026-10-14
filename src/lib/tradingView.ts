/**
 * TradingView Integration & Symbol / URL Resolver
 *
 * Provides canonical, 404-free TradingView symbol mapping and web link generation
 * for market indices, FX, commodities, crypto, and Tokyo / US equities.
 */

export interface TradingViewResolution {
  symbol: string | null;
  isSupported: boolean;
}

/**
 * Explicit symbol mapping for TradingView widget embeds.
 */
const SPECIAL_EMBED_MAP: Record<string, string> = {
  "^GSPC": "FOREXCOM:SPXUSD",
  "^IXIC": "NASDAQ:IXIC",
  "^DJI": "FOREXCOM:DJI",
  "^N225": "INDEX:NKY",
  "^TOPX": "TSE:TOPIX",
  "^TOPIXG": "TSE:2516",
  "USDJPY=X": "FX:USDJPY",
  "EURUSD=X": "FX:EURUSD",
  "EURJPY=X": "FX:EURJPY",
  "GBPJPY=X": "FX:GBPJPY",
  "FX_IDC:USDJPY": "FX:USDJPY",
  "BTC-USD": "COINBASE:BTCUSD",
  "ETH-USD": "COINBASE:ETHUSD",
  "GC=F": "TVC:GOLD",
  "CL=F": "TVC:USOIL",
  "^TNX": "TVC:US10Y",
};

/**
 * Explicit web symbol URL slugs on jp.tradingview.com/symbols/{SLUG}/
 */
const SPECIAL_WEB_SLUGS: Record<string, string> = {
  "^N225": "TVC-NI225",
  "NI225": "TVC-NI225",
  "^TOPX": "TSE-TOPIX",
  "TOPIX": "TSE-TOPIX",
  "^TOPIXG": "TSE-2516",
  "^GSPC": "FOREXCOM-SPXUSD",
  "SPX": "FOREXCOM-SPXUSD",
  "^IXIC": "NASDAQ-IXIC",
  "^DJI": "FOREXCOM-DJI",
  "USDJPY=X": "FX-USDJPY",
  "EURUSD=X": "FX-EURUSD",
  "EURJPY=X": "FX-EURJPY",
  "GBPJPY=X": "FX-GBPJPY",
  "FX_IDC:USDJPY": "FX-USDJPY",
  "BTC-USD": "COINBASE-BTCUSD",
  "ETH-USD": "COINBASE-ETHUSD",
  "GC=F": "TVC-GOLD",
  "CL=F": "TVC-USOIL",
  "^TNX": "TVC-US10Y",
};

/**
 * Map local/Yahoo style tickers to valid TradingView symbol codes for widget embeds.
 * Returns null if the symbol is known to be unsupported in TradingView embeds,
 * triggering automatic fallback to LOCAL QUANT ENGINE.
 */
export function resolveTradingViewSymbol(
  ticker: string,
  isUS = false,
): TradingViewResolution {
  if (!ticker || !ticker.trim()) return { symbol: null, isSupported: false };
  const clean = ticker.trim().toUpperCase();

  if (SPECIAL_EMBED_MAP[clean]) {
    return { symbol: SPECIAL_EMBED_MAP[clean], isSupported: true };
  }

  // Already prefixed with exchange
  if (
    clean.startsWith("NASDAQ:") ||
    clean.startsWith("NYSE:") ||
    clean.startsWith("AMEX:") ||
    clean.startsWith("CBOE:") ||
    clean.startsWith("TSE:") ||
    clean.startsWith("FOREXCOM:") ||
    clean.startsWith("FX:") ||
    clean.startsWith("INDEX:") ||
    clean.startsWith("TVC:") ||
    clean.startsWith("COINBASE:") ||
    clean.startsWith("BITSTAMP:")
  ) {
    return { symbol: clean, isSupported: true };
  }

  // Unsupported carets or FX suffixes not in SPECIAL_EMBED_MAP
  if (clean.startsWith("^") || clean.includes("=X")) {
    return { symbol: null, isSupported: false };
  }

  // Tokyo Stock Exchange (digits, 130A style)
  if (/^\d/.test(clean)) {
    const code = clean.replace(/\.T$/i, "").replace(/[^0-9A-Za-z]/g, "");
    return { symbol: `TSE:${code}`, isSupported: true };
  }

  // Standard US equities (e.g. AAPL, NVDA, MSFT)
  if (/^[A-Z]{1,6}$/.test(clean)) {
    return { symbol: clean, isSupported: true };
  }

  return { symbol: isUS ? clean : null, isSupported: isUS };
}

/**
 * Generate accurate, non-404 TradingView official web URLs:
 * https://jp.tradingview.com/symbols/{SYMBOL}/
 *
 * Handles macro indices (TOPIX, Nikkei 225, S&P 500), currencies, crypto,
 * and Tokyo (TSE-XXXX) and US equities without 404 broken links.
 */
export function getTradingViewWebUrl(ticker: string, market?: string): string {
  if (!ticker || !ticker.trim()) {
    return "https://jp.tradingview.com/";
  }

  const clean = ticker.trim().toUpperCase();

  // 1. Check special web slug mappings
  if (SPECIAL_WEB_SLUGS[clean]) {
    return `https://jp.tradingview.com/symbols/${SPECIAL_WEB_SLUGS[clean]}/`;
  }

  // 2. Colon-prefixed symbols (e.g. "TSE:7203", "INDEX:NKY", "FOREXCOM:SPXUSD") -> convert ":" to "-"
  if (clean.includes(":")) {
    const slug = clean.replace(":", "-");
    return `https://jp.tradingview.com/symbols/${slug}/`;
  }

  // 3. Tokyo Stock Exchange equities (digits like "7203", "7203.T", "130A")
  if (/^\d/.test(clean) || market === "PRIME" || market === "STANDARD" || market === "GROWTH") {
    const code = clean.replace(/\.T$/i, "").replace(/[^0-9A-Za-z]/g, "");
    return `https://jp.tradingview.com/symbols/TSE-${code}/`;
  }

  // 4. US equities
  if (market === "US" || /^[A-Z]{1,6}$/.test(clean)) {
    return `https://jp.tradingview.com/symbols/${clean}/`;
  }

  // 5. Fallback via symbol resolver
  const resolved = resolveTradingViewSymbol(clean, market === "US");
  if (resolved.symbol) {
    const slug = resolved.symbol.replace(":", "-");
    return `https://jp.tradingview.com/symbols/${slug}/`;
  }

  return `https://jp.tradingview.com/symbols/${encodeURIComponent(clean)}/`;
}
