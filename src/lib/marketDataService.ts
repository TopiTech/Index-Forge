/**
 * Market Data Service
 * 統合投資情報プラットフォーム向けのマーケット情報、株価、ファンダメンタルズ、スクリーナー、カレンダーの取得・管理サービス
 */

import { POPULAR_STOCKS } from "../data/popularStocks";

export interface MarketAssetQuote {
  symbol: string;
  name: string;
  category: "INDEX" | "FX" | "COMMODITY" | "CRYPTO" | "BOND";
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  sparkline?: number[];
  updatedAt: string;
}

export interface SectorPerformance {
  name: string;
  changePercent: number;
  market: "TSE" | "US";
  code?: string;
}

export interface MarketOverviewData {
  indices: MarketAssetQuote[];
  forex: MarketAssetQuote[];
  commodities: MarketAssetQuote[];
  crypto: MarketAssetQuote[];
  sectors: SectorPerformance[];
  marketBreadth: {
    gainers: number;
    losers: number;
    unchanged: number;
    sentimentScore: number; // 0: Extreme Fear, 100: Extreme Greed
  };
  news: Array<{
    id: string;
    title: string;
    source: string;
    publishedAt: string;
    url?: string;
    relatedTicker?: string;
  }>;
}

export interface StockQuoteFundamentals {
  ticker: string;
  name: string;
  theme: string;
  sector: string;
  market: "PRIME" | "STANDARD" | "GROWTH" | "US";
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  previousClose: number;
  dayHigh: number;
  dayLow: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number; // 億円または百万ドル
  per: number | null;
  pbr: number | null;
  dividendYield: number | null; // %
  roe: number | null; // %
  equityRatio: number | null; // %
  eps: number | null;
  dps: number | null;
  technicalSignal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  historicalFinances: Array<{
    fiscalYear: string;
    revenue: number;
    operatingIncome: number;
    netIncome: number;
    eps: number;
    dps: number;
  }>;
}

export interface CalendarEvent {
  id: string;
  date: string;
  type: "EARNINGS" | "MACRO";
  title: string;
  ticker?: string;
  companyName?: string;
  marketCap?: number;
  consensus?: string;
  actual?: string;
  previous?: string;
  forecast?: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
}

// Default Global Market Quotes Baseline
const DEFAULT_MARKET_OVERVIEW: MarketOverviewData = {
  indices: [
    {
      symbol: "^N225",
      name: "日経平均株価",
      category: "INDEX",
      price: 39580.45,
      change: 320.15,
      changePercent: 0.82,
      currency: "JPY",
      sparkline: [39200, 39310, 39280, 39450, 39520, 39580],
      updatedAt: "15:00 JST",
    },
    {
      symbol: "^TOPX",
      name: "TOPIX (東証株価指数)",
      category: "INDEX",
      price: 2715.30,
      change: 18.40,
      changePercent: 0.68,
      currency: "JPY",
      sparkline: [2695, 2701, 2704, 2710, 2712, 2715],
      updatedAt: "15:00 JST",
    },
    {
      symbol: "^TOPIXG",
      name: "東証グロース250",
      category: "INDEX",
      price: 648.20,
      change: -4.35,
      changePercent: -0.67,
      currency: "JPY",
      sparkline: [654, 652, 650, 649, 647, 648],
      updatedAt: "15:00 JST",
    },
    {
      symbol: "^GSPC",
      name: "S&P 500",
      category: "INDEX",
      price: 5864.67,
      change: 23.36,
      changePercent: 0.40,
      currency: "USD",
      sparkline: [5820, 5835, 5840, 5855, 5860, 5864],
      updatedAt: "05:00 JST",
    },
    {
      symbol: "^IXIC",
      name: "NASDAQ 総合",
      category: "INDEX",
      price: 18518.61,
      change: 115.82,
      changePercent: 0.63,
      currency: "USD",
      sparkline: [18350, 18400, 18420, 18480, 18500, 18518],
      updatedAt: "05:00 JST",
    },
    {
      symbol: "^DJI",
      name: "NYダウ平均",
      category: "INDEX",
      price: 43239.05,
      change: 36.16,
      changePercent: 0.08,
      currency: "USD",
      sparkline: [43150, 43200, 43180, 43220, 43210, 43239],
      updatedAt: "05:00 JST",
    },
  ],
  forex: [
    {
      symbol: "USDJPY=X",
      name: "米ドル / 円",
      category: "FX",
      price: 149.85,
      change: 0.32,
      changePercent: 0.21,
      currency: "JPY",
      sparkline: [149.4, 149.55, 149.6, 149.72, 149.8, 149.85],
      updatedAt: "リアルタイム",
    },
    {
      symbol: "EURJPY=X",
      name: "ユーロ / 円",
      category: "FX",
      price: 162.90,
      change: -0.15,
      changePercent: -0.09,
      currency: "JPY",
      sparkline: [163.1, 163.05, 162.98, 162.92, 162.88, 162.9],
      updatedAt: "リアルタイム",
    },
    {
      symbol: "EURUSD=X",
      name: "ユーロ / ドル",
      category: "FX",
      price: 1.0871,
      change: -0.0024,
      changePercent: -0.22,
      currency: "USD",
      sparkline: [1.089, 1.0885, 1.088, 1.0875, 1.0872, 1.0871],
      updatedAt: "リアルタイム",
    },
  ],
  commodities: [
    {
      symbol: "CL=F",
      name: "WTI 原油先物",
      category: "COMMODITY",
      price: 70.62,
      change: -1.35,
      changePercent: -1.88,
      currency: "USD",
      sparkline: [72.2, 71.8, 71.4, 71.0, 70.8, 70.62],
      updatedAt: "リアルタイム",
    },
    {
      symbol: "GC=F",
      name: "金先物 (Gold)",
      category: "COMMODITY",
      price: 2735.80,
      change: 14.90,
      changePercent: 0.55,
      currency: "USD",
      sparkline: [2715, 2720, 2724, 2728, 2732, 2735.8],
      updatedAt: "リアルタイム",
    },
    {
      symbol: "^TNX",
      name: "米国10年債利回り",
      category: "BOND",
      price: 4.09,
      change: 0.02,
      changePercent: 0.49,
      currency: "%",
      sparkline: [4.06, 4.07, 4.08, 4.085, 4.09],
      updatedAt: "リアルタイム",
    },
  ],
  crypto: [
    {
      symbol: "BTC-USD",
      name: "ビットコイン (BTC)",
      category: "CRYPTO",
      price: 68420.0,
      change: 1250.0,
      changePercent: 1.86,
      currency: "USD",
      sparkline: [66800, 67200, 67500, 67900, 68100, 68420],
      updatedAt: "24h リアルタイム",
    },
    {
      symbol: "ETH-USD",
      name: "イーサリアム (ETH)",
      category: "CRYPTO",
      price: 2645.5,
      change: 42.8,
      changePercent: 1.64,
      currency: "USD",
      sparkline: [2590, 2610, 2625, 2630, 2640, 2645.5],
      updatedAt: "24h リアルタイム",
    },
  ],
  sectors: [
    { name: "電気機器", changePercent: 1.45, market: "TSE" },
    { name: "精密機器", changePercent: 1.28, market: "TSE" },
    { name: "輸送用機器", changePercent: 0.95, market: "TSE" },
    { name: "銀行業", changePercent: 0.88, market: "TSE" },
    { name: "卸売業 (商社)", changePercent: 0.62, market: "TSE" },
    { name: "情報・通信業", changePercent: 0.41, market: "TSE" },
    { name: "医薬品", changePercent: -0.15, market: "TSE" },
    { name: "化学", changePercent: -0.32, market: "TSE" },
    { name: "食料品", changePercent: -0.48, market: "TSE" },
    { name: "鉱業・石油", changePercent: -1.65, market: "TSE" },
  ],
  marketBreadth: {
    gainers: 1045,
    losers: 520,
    unchanged: 85,
    sentimentScore: 68, // Greed
  },
  news: [
    {
      id: "news-1",
      title: "日経平均は続伸、半導体関連株が牽引し一時3万9600円台回復",
      source: "市場速報",
      publishedAt: "25分前",
      relatedTicker: "8035",
    },
    {
      id: "news-2",
      title: "米ハイテク株高を受けナスダック続伸、AIインフラ需要期待が継続",
      source: "グローバル金融",
      publishedAt: "1時間前",
      relatedTicker: "NVDA",
    },
    {
      id: "news-3",
      title: "ドル円は149円台後半で小動き、日米金利差と政策会合待ちの姿勢",
      source: "為替市況",
      publishedAt: "2時間前",
      relatedTicker: "USDJPY=X",
    },
    {
      id: "news-4",
      title: "東証プライムの値上がり銘柄数が6割超、好業績バリュー銘柄に見直し買い",
      source: "株式ニュース",
      publishedAt: "3時間前",
    },
  ],
};

// Generates rich fundamentals for any ticker
export function getStockFundamentals(ticker: string): StockQuoteFundamentals {
  const input = ticker.trim().toUpperCase();
  // Exact ticker match first, then exact name lookup. The previous
  // `name.includes(...)` matched substrings, so short inputs like "72"
  // resolved to an unrelated preset (and an empty ticker matched the
  // first stock).
  const matchedPreset =
    POPULAR_STOCKS.find((s) => s.ticker.toUpperCase() === input) ??
    (input ? POPULAR_STOCKS.find((s) => s.name === input) : undefined);
  // A name lookup resolves to the preset's code so callers always receive a
  // real ticker (and the same seed/data as a code lookup for that stock).
  const normTicker = matchedPreset ? matchedPreset.ticker.toUpperCase() : input;

  const name = matchedPreset ? matchedPreset.name : `銘柄 ${normTicker}`;
  const theme = matchedPreset ? matchedPreset.theme : "株式";
  const isUS = !/^\d/.test(normTicker);

  // Generate plausible, realistic data seeded by ticker character sum
  const seed = normTicker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const basePrice = isUS ? 120 + (seed % 350) : 1800 + (seed % 6500);
  const changePct = Number((((seed % 60) - 28) / 10).toFixed(2));
  const change = Number(((basePrice * changePct) / 100).toFixed(2));
  const prevClose = Number((basePrice - change).toFixed(2));

  const per = isUS ? 22 + (seed % 35) : 12 + (seed % 20);
  const pbr = Number((0.8 + ((seed % 35) / 10)).toFixed(2));
  const dividendYield = Number((1.5 + ((seed % 30) / 10)).toFixed(2));
  const roe = Number((8 + (seed % 14)).toFixed(1));
  const equityRatio = 40 + (seed % 45);
  const marketCap = isUS ? 45000 + (seed * 850) : 12000 + (seed * 280);

  const eps = Number((basePrice / per).toFixed(1));
  const dps = Number(((basePrice * dividendYield) / 100).toFixed(1));

  let technicalSignal: StockQuoteFundamentals["technicalSignal"] = "BUY";
  if (changePct > 2.0) technicalSignal = "STRONG_BUY";
  else if (changePct > 0) technicalSignal = "BUY";
  else if (changePct > -1.5) technicalSignal = "NEUTRAL";
  else technicalSignal = "SELL";

  // 4 years historical financial performance
  const currentYear = new Date().getFullYear();
  const historicalFinances = [
    {
      fiscalYear: `${currentYear - 3}/3`,
      revenue: Math.round(marketCap * 0.72),
      operatingIncome: Math.round(marketCap * 0.08),
      netIncome: Math.round(marketCap * 0.055),
      eps: Math.round(eps * 0.75),
      dps: Math.round(dps * 0.8),
    },
    {
      fiscalYear: `${currentYear - 2}/3`,
      revenue: Math.round(marketCap * 0.81),
      operatingIncome: Math.round(marketCap * 0.095),
      netIncome: Math.round(marketCap * 0.065),
      eps: Math.round(eps * 0.88),
      dps: Math.round(dps * 0.9),
    },
    {
      fiscalYear: `${currentYear - 1}/3`,
      revenue: Math.round(marketCap * 0.92),
      operatingIncome: Math.round(marketCap * 0.11),
      netIncome: Math.round(marketCap * 0.078),
      eps: Math.round(eps * 0.96),
      dps: Math.round(dps * 0.95),
    },
    {
      fiscalYear: `${currentYear}/3 (予)`,
      revenue: Math.round(marketCap * 1.04),
      operatingIncome: Math.round(marketCap * 0.125),
      netIncome: Math.round(marketCap * 0.088),
      eps: eps,
      dps: dps,
    },
  ];

  return {
    ticker: normTicker,
    name,
    theme,
    sector: isUS ? "Information Tech" : "電気機器・精密",
    market: isUS ? "US" : "PRIME",
    price: basePrice,
    change,
    changePercent: changePct,
    volume: 1250000 + (seed * 8500),
    previousClose: prevClose,
    dayHigh: Number((basePrice * 1.015).toFixed(2)),
    dayLow: Number((basePrice * 0.985).toFixed(2)),
    yearHigh: Number((basePrice * 1.28).toFixed(2)),
    yearLow: Number((basePrice * 0.78).toFixed(2)),
    marketCap,
    per,
    pbr,
    dividendYield,
    roe,
    equityRatio,
    eps,
    dps,
    technicalSignal,
    historicalFinances,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeQuote(raw: unknown): MarketAssetQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.symbol !== "string" || !record.symbol) return null;
  if (typeof record.name !== "string" || !record.name) return null;
  if (!isFiniteNumber(record.price)) return null;

  const change = isFiniteNumber(record.change) ? record.change : 0;
  const changePercent = isFiniteNumber(record.changePercent)
    ? record.changePercent
    : 0;
  const sparkline = Array.isArray(record.sparkline)
    ? record.sparkline.filter(isFiniteNumber)
    : [];

  return {
    symbol: record.symbol,
    name: record.name,
    category:
      record.category === "FX" ||
        record.category === "COMMODITY" ||
        record.category === "CRYPTO" ||
        record.category === "BOND" ||
        record.category === "INDEX"
        ? record.category
        : "INDEX",
    price: record.price,
    change,
    changePercent,
    currency: typeof record.currency === "string" && record.currency ? record.currency : "USD",
    ...(sparkline.length > 0 ? { sparkline } : {}),
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt
        ? record.updatedAt
        : "-",
  };
}

function sanitizeQuotes(raw: unknown): MarketAssetQuote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeQuote)
    .filter((quote): quote is MarketAssetQuote => quote !== null);
}

/**
 * Validates an untrusted /api/market/overview payload before it reaches the
 * page. The endpoint can return partial or non-JSON responses, and the page
 * dereferences `marketBreadth`, `sectors` and `news` unconditionally, so any
 * missing section would otherwise throw during render.
 * Returns `null` when `indices` is absent or empty (the required section).
 */
export function normalizeMarketOverview(raw: unknown): MarketOverviewData | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.indices) || record.indices.length === 0) return null;

  const breadth = record.marketBreadth as Record<string, unknown> | undefined;
  const fallback = DEFAULT_MARKET_OVERVIEW;

  return {
    indices: sanitizeQuotes(record.indices),
    forex: sanitizeQuotes(record.forex),
    commodities: sanitizeQuotes(record.commodities),
    crypto: sanitizeQuotes(record.crypto),
    sectors: Array.isArray(record.sectors)
      ? record.sectors.filter(
        (sector): sector is MarketOverviewData["sectors"][number] =>
          !!sector &&
          typeof sector === "object" &&
          typeof (sector as { name?: unknown }).name === "string" &&
          isFiniteNumber((sector as { changePercent?: unknown }).changePercent),
      )
      : fallback.sectors,
    marketBreadth:
      breadth &&
        isFiniteNumber(breadth.gainers) &&
        isFiniteNumber(breadth.losers) &&
        isFiniteNumber(breadth.unchanged) &&
        isFiniteNumber(breadth.sentimentScore)
        ? {
          gainers: breadth.gainers,
          losers: breadth.losers,
          unchanged: breadth.unchanged,
          sentimentScore: Math.max(0, Math.min(100, breadth.sentimentScore)),
        }
        : fallback.marketBreadth,
    news: Array.isArray(record.news)
      ? record.news.filter(
        (item): item is MarketOverviewData["news"][number] =>
          !!item &&
          typeof item === "object" &&
          typeof (item as { id?: unknown }).id === "string" &&
          typeof (item as { title?: unknown }).title === "string" &&
          typeof (item as { source?: unknown }).source === "string" &&
          typeof (item as { publishedAt?: unknown }).publishedAt === "string",
      )
      : fallback.news,
  };
}

// The worker has no /api/market/overview route yet, so every call would 404
// (or fall through to the SPA index.html in dev). Remember a confirmed
// missing/mismatched endpoint and skip the request until a full reload.
let overviewEndpointConfirmedMissing = false;

/** Test hook: re-arm the endpoint probe between assertions. */
export function resetMarketOverviewEndpointProbe(): void {
  overviewEndpointConfirmedMissing = false;
}

// Fetch Market Overview Data (with API fallback)
export async function fetchMarketOverview(): Promise<MarketOverviewData> {
  const isBrowser = typeof globalThis !== "undefined" && "window" in globalThis;
  if (isBrowser && !overviewEndpointConfirmedMissing) {
    try {
      const res = await fetch("/api/market/overview", {
        headers: { accept: "application/json" },
      });
      if (res.status === 404) {
        overviewEndpointConfirmedMissing = true;
        return DEFAULT_MARKET_OVERVIEW;
      }
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        // The SPA fallback answers *.html paths with index.html; anything
        // that is not JSON means the route does not exist.
        if (!contentType.includes("json")) {
          overviewEndpointConfirmedMissing = true;
          return DEFAULT_MARKET_OVERVIEW;
        }
        const normalized = normalizeMarketOverview(await res.json());
        if (normalized) return normalized;
        overviewEndpointConfirmedMissing = true;
      }
    } catch {
      // Graceful fallback to rich local baseline; a network error may be
      // transient, so the endpoint probe stays armed.
    }
  }
  return DEFAULT_MARKET_OVERVIEW;
}

// Screener Query Options
export interface ScreenerFilterOptions {
  market?: "ALL" | "PRIME" | "STANDARD" | "GROWTH" | "US";
  minDividendYield?: number;
  maxPer?: number;
  maxPbr?: number;
  minRoe?: number;
  searchQuery?: string;
  sortBy?: "changePercent" | "dividendYield" | "per" | "pbr" | "volume" | "marketCap";
  sortOrder?: "asc" | "desc";
}

// Screen Stocks across POPULAR_STOCKS universe
export function runStockScreener(options: ScreenerFilterOptions = {}): StockQuoteFundamentals[] {
  const {
    market = "ALL",
    minDividendYield,
    maxPer,
    maxPbr,
    minRoe,
    searchQuery = "",
    sortBy = "changePercent",
    sortOrder = "desc",
  } = options;

  const allStocks = POPULAR_STOCKS.map((s) => getStockFundamentals(s.ticker));

  const filtered = allStocks.filter((stock) => {
    if (market !== "ALL") {
      if (market === "US" && stock.market !== "US") return false;
      if (market !== "US" && stock.market === "US") return false;
    }

    if (minDividendYield !== undefined && (stock.dividendYield === null || stock.dividendYield < minDividendYield)) {
      return false;
    }
    if (maxPer !== undefined && (stock.per === null || stock.per > maxPer)) {
      return false;
    }
    if (maxPbr !== undefined && (stock.pbr === null || stock.pbr > maxPbr)) {
      return false;
    }
    if (minRoe !== undefined && (stock.roe === null || stock.roe < minRoe)) {
      return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const match =
        stock.ticker.toLowerCase().includes(q) ||
        stock.name.toLowerCase().includes(q) ||
        stock.theme.toLowerCase().includes(q);
      if (!match) return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    const valA = a[sortBy] ?? 0;
    const valB = b[sortBy] ?? 0;
    // Keep equal keys untouched: returning -1 for ties makes the comparator
    // inconsistent (a > b and b > a both yield -1) and the order unstable.
    if (valA === valB) return 0;
    return sortOrder === "asc" ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1;
  });
}

// Sample Upcoming Earnings & Macro Events Calendar
export const UPCOMING_EVENTS: CalendarEvent[] = [
  {
    id: "macro-1",
    date: "10/18",
    type: "MACRO",
    title: "日銀金融政策決定会合・総裁記者会見",
    importance: "HIGH",
    previous: "0.25%",
    forecast: "0.25%",
  },
  {
    id: "earn-1",
    date: "10/24",
    type: "EARNINGS",
    title: "信越化学工業 (4063) 2Q決算発表",
    ticker: "4063",
    companyName: "信越化学工業",
    importance: "HIGH",
    marketCap: 115000,
  },
  {
    id: "earn-2",
    date: "10/25",
    type: "EARNINGS",
    title: "ファナック (6954) 2Q決算発表",
    ticker: "6954",
    companyName: "ファナック",
    importance: "MEDIUM",
    marketCap: 41000,
  },
  {
    id: "macro-2",
    date: "10/31",
    type: "MACRO",
    title: "米FOMC 政策金利発表 & パウエル議長会見",
    importance: "HIGH",
    previous: "5.00%",
    forecast: "4.75%",
  },
  {
    id: "earn-3",
    date: "11/01",
    type: "EARNINGS",
    title: "トヨタ自動車 (7203) 中間決算発表",
    ticker: "7203",
    companyName: "トヨタ自動車",
    importance: "HIGH",
    marketCap: 420000,
  },
  {
    id: "macro-3",
    date: "11/01",
    type: "MACRO",
    title: "米10月 雇用統計 (非農業部門雇用者数・失業率)",
    importance: "HIGH",
    previous: "25.4万人",
    forecast: "12.0万人",
  },
  {
    id: "earn-4",
    date: "11/07",
    type: "EARNINGS",
    title: "ソフトバンクグループ (9984) 2Q決算発表",
    ticker: "9984",
    companyName: "ソフトバンクグループ",
    importance: "HIGH",
    marketCap: 135000,
  },
  {
    id: "earn-5",
    date: "11/12",
    type: "EARNINGS",
    title: "東京エレクトロン (8035) 2Q決算発表",
    ticker: "8035",
    companyName: "東京エレクトロン",
    importance: "HIGH",
    marketCap: 122000,
  },
];
