/**
 * Market Data Service
 * 統合投資情報プラットフォーム向けのマーケット情報、株価、ファンダメンタルズ、スクリーナー、カレンダーの取得・管理サービス
 */

import { POPULAR_STOCKS } from "../data/popularStocks";
import { BASELINE_ASSET_QUOTES, type BaselineAssetQuote } from "../data/marketConstants";

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
  /**
   * データ出所のメタデータ (後方互換のためオプショナル)。
   * "fallback" の場合は実データ取得に失敗し、静的ベースラインを表示していることを示す。
   */
  dataSource?: "fallback" | "live";
  /** データ生成時刻 (ISO 8601)。フォールバック表示時の鮮度確認に使用。 */
  dataAsOf?: string;
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
  sparkline?: number[];
  technicalSignal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  /**
   * true の場合、実データではなくティッカー名から擬似生成した参考値 (デモ) であることを示す。
   * 既知銘柄アンカー (KNOWN_STOCK_ANCHORS) が存在しない未知ティッカーに付与される。
   */
  isDemoData?: boolean;
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
  /** 完全な日付 (YYYY-MM-DD)。年を跨ぐソートや曜日判定の精度向上に使用 (後方互換のためオプショナル)。 */
  fullDate?: string;
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
  /**
   * データの出所。実データ取得に失敗して静的フォールバックを返した場合は "fallback"。
   * 未設定の場合は実データ (または従来どおりの生成データ) を意味する。
   */
  source?: string;
}

function buildDefaultMarketQuotes(
  filterFn: (q: BaselineAssetQuote) => boolean,
): MarketAssetQuote[] {
  return BASELINE_ASSET_QUOTES.filter(filterFn).map((q) => {
    const updatedAt =
      q.category === "INDEX"
        ? q.currency === "JPY"
          ? "15:00 JST"
          : "05:00 JST"
        : q.category === "CRYPTO"
          ? "24h リアルタイム"
          : "リアルタイム";
    const p = q.baselinePrice;
    const sparkline = [
      Number((p * 0.995).toFixed(2)),
      Number((p * 0.997).toFixed(2)),
      Number((p * 0.998).toFixed(2)),
      Number((p * 1.001).toFixed(2)),
      Number(p.toFixed(2)),
    ];
    return {
      symbol: q.symbol,
      name: q.name,
      category: q.category,
      price: q.baselinePrice,
      change: q.baselineChange,
      changePercent: q.baselineChangePercent,
      currency: q.currency,
      sparkline,
      updatedAt,
    };
  });
}

// Default Global Market Quotes Baseline (Derived from shared marketConstants BASELINE_ASSET_QUOTES)
export const DEFAULT_MARKET_OVERVIEW: MarketOverviewData = {
  indices: buildDefaultMarketQuotes((q) => q.category === "INDEX"),
  forex: buildDefaultMarketQuotes((q) => q.category === "FX"),
  commodities: buildDefaultMarketQuotes(
    (q) => q.category === "COMMODITY" || q.category === "BOND",
  ),
  crypto: buildDefaultMarketQuotes((q) => q.category === "CRYPTO"),
  sectors: [
    { name: "電気機器・半導体", changePercent: 2.09, market: "TSE" },
    { name: "精密機器", changePercent: 1.35, market: "TSE" },
    { name: "輸送用機器", changePercent: 0.29, market: "TSE" },
    { name: "銀行業", changePercent: 1.18, market: "TSE" },
    { name: "卸売業 (商社)", changePercent: 0.74, market: "TSE" },
    { name: "情報・通信業", changePercent: 0.45, market: "TSE" },
    { name: "医薬品", changePercent: 0.12, market: "TSE" },
    { name: "化学・素材", changePercent: -0.25, market: "TSE" },
    { name: "食料品・小売", changePercent: -0.38, market: "TSE" },
    { name: "鉱業・エネルギー", changePercent: 0.85, market: "TSE" },
  ],
  marketBreadth: {
    gainers: 1072,
    losers: 578,
    unchanged: 85,
    sentimentScore: 65, // Greed
  },
  news: [
    {
      id: "news-1",
      title: "日経平均は高水準推移、主要半導体・ハイテク関連株に堅調な買い需要",
      source: "市場速報",
      publishedAt: "25分前",
      relatedTicker: "8035",
    },
    {
      id: "news-2",
      title: "米ハイテク株と主要指数が堅調、AIインフラ需要期待が下支え",
      source: "グローバル金融",
      publishedAt: "1時間前",
      relatedTicker: "NVDA",
    },
    {
      id: "news-3",
      title: "ドル円は158円台前半で推移、日米金利差と金融政策動向を注視",
      source: "為替市況",
      publishedAt: "2時間前",
      relatedTicker: "USDJPY=X",
    },
    {
      id: "news-4",
      title: "東証プライム騰落レシオは良好、好業績バリュー銘柄に見直し買いが継続",
      source: "株式ニュース",
      publishedAt: "3時間前",
    },
  ],
};

interface KnownStockAnchor {
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  per: number;
  pbr: number;
  dividendYield: number;
  roe: number;
  equityRatio: number;
  eps: number;
  dps: number;
  sector?: string;
}

const KNOWN_STOCK_ANCHORS: Record<string, KnownStockAnchor> = {
  "7203": {
    price: 2910.5,
    change: 8.5,
    changePercent: 0.29,
    volume: 17845800,
    dayHigh: 2936.5,
    dayLow: 2891.0,
    yearHigh: 4000.0,
    yearLow: 2686.0,
    marketCap: 344657,
    per: 8.3,
    pbr: 0.92,
    dividendYield: 3.45,
    roe: 12.4,
    equityRatio: 46.5,
    eps: 351.4,
    dps: 100.0,
    sector: "輸送用機器 (自動車)",
  },
  "8035": {
    price: 12445.0,
    change: 255.0,
    changePercent: 2.09,
    volume: 3820000,
    dayHigh: 12600.0,
    dayLow: 12350.0,
    yearHigh: 16252.0,
    yearLow: 5586.0,
    marketCap: 291233,
    per: 45.9,
    pbr: 2.64,
    dividendYield: 3.75,
    roe: 18.2,
    equityRatio: 72.0,
    eps: 270.9,
    dps: 466.0,
    sector: "電気機器・半導体製造装置",
  },
  "6857": {
    price: 9280.0,
    change: 180.0,
    changePercent: 1.98,
    volume: 4210000,
    dayHigh: 9410.0,
    dayLow: 9150.0,
    yearHigh: 9980.0,
    yearLow: 4200.0,
    marketCap: 71200,
    per: 38.5,
    pbr: 6.8,
    dividendYield: 1.25,
    roe: 22.4,
    equityRatio: 65.0,
    eps: 241.0,
    dps: 116.0,
    sector: "電気機器・半導体検査装置",
  },
  "6758": {
    price: 2840.0,
    change: 35.0,
    changePercent: 1.25,
    volume: 6850000,
    dayHigh: 2865.0,
    dayLow: 2820.0,
    yearHigh: 3100.0,
    yearLow: 2250.0,
    marketCap: 175000,
    per: 18.4,
    pbr: 2.15,
    dividendYield: 0.75,
    roe: 12.8,
    equityRatio: 52.0,
    eps: 154.3,
    dps: 21.3,
    sector: "電気機器・エンタメ",
  },
  "6861": {
    price: 68500.0,
    change: 450.0,
    changePercent: 0.66,
    volume: 380000,
    dayHigh: 69200.0,
    dayLow: 68100.0,
    yearHigh: 74200.0,
    yearLow: 59000.0,
    marketCap: 166000,
    per: 42.5,
    pbr: 5.8,
    dividendYield: 0.58,
    roe: 14.2,
    equityRatio: 94.0,
    eps: 1611.8,
    dps: 400.0,
    sector: "電気機器・センサー",
  },
  "9984": {
    price: 9150.0,
    change: 110.0,
    changePercent: 1.22,
    volume: 5200000,
    dayHigh: 9280.0,
    dayLow: 9060.0,
    yearHigh: 12100.0,
    yearLow: 6800.0,
    marketCap: 134000,
    per: 24.5,
    pbr: 1.05,
    dividendYield: 0.48,
    roe: 4.8,
    equityRatio: 26.0,
    eps: 373.5,
    dps: 44.0,
    sector: "情報・通信・投資",
  },
  "9432": {
    price: 155.2,
    change: 0.5,
    changePercent: 0.32,
    volume: 58000000,
    dayHigh: 156.5,
    dayLow: 154.5,
    yearHigh: 192.0,
    yearLow: 144.0,
    marketCap: 139000,
    per: 11.8,
    pbr: 1.35,
    dividendYield: 3.35,
    roe: 12.5,
    equityRatio: 38.0,
    eps: 13.2,
    dps: 5.2,
    sector: "情報・通信業",
  },
  "8306": {
    price: 1680.5,
    change: 20.5,
    changePercent: 1.23,
    volume: 24500000,
    dayHigh: 1695.0,
    dayLow: 1665.0,
    yearHigh: 1850.0,
    yearLow: 1200.0,
    marketCap: 201000,
    per: 11.2,
    pbr: 0.95,
    dividendYield: 3.25,
    roe: 9.2,
    equityRatio: 4.5,
    eps: 150.0,
    dps: 55.0,
    sector: "銀行業 (メガバンク)",
  },
  "8058": {
    price: 3120.0,
    change: 25.0,
    changePercent: 0.81,
    volume: 8900000,
    dayHigh: 3150.0,
    dayLow: 3090.0,
    yearHigh: 3600.0,
    yearLow: 2600.0,
    marketCap: 132000,
    per: 12.5,
    pbr: 1.25,
    dividendYield: 3.45,
    roe: 12.1,
    equityRatio: 35.0,
    eps: 249.6,
    dps: 108.0,
    sector: "卸売業 (総合商社)",
  },
  "7974": {
    price: 8250.0,
    change: 65.0,
    changePercent: 0.79,
    volume: 2800000,
    dayHigh: 8320.0,
    dayLow: 8200.0,
    yearHigh: 9150.0,
    yearLow: 6700.0,
    marketCap: 96000,
    per: 26.5,
    pbr: 3.45,
    dividendYield: 2.55,
    roe: 15.4,
    equityRatio: 78.0,
    eps: 311.3,
    dps: 210.0,
    sector: "その他製品・ゲーム",
  },
  "9983": {
    price: 49800.0,
    change: 350.0,
    changePercent: 0.71,
    volume: 1200000,
    dayHigh: 50200.0,
    dayLow: 49400.0,
    yearHigh: 54000.0,
    yearLow: 38000.0,
    marketCap: 152000,
    per: 39.5,
    pbr: 6.2,
    dividendYield: 0.85,
    roe: 17.5,
    equityRatio: 58.0,
    eps: 1260.8,
    dps: 425.0,
    sector: "小売業 (アパレル)",
  },
  NVDA: {
    price: 229.28,
    change: -1.2,
    changePercent: -0.52,
    volume: 38500000,
    dayHigh: 233.89,
    dayLow: 229.11,
    yearHigh: 243.37,
    yearLow: 164.27,
    marketCap: 5536424,
    per: 29.0,
    pbr: 24.18,
    dividendYield: 0.42,
    roe: 117.2,
    equityRatio: 68.0,
    eps: 7.91,
    dps: 1.0,
    sector: "Semiconductors / AI",
  },
  AAPL: {
    price: 236.4,
    change: 1.15,
    changePercent: 0.49,
    volume: 45000000,
    dayHigh: 238.2,
    dayLow: 235.1,
    yearHigh: 245.0,
    yearLow: 168.0,
    marketCap: 3580000,
    per: 34.2,
    pbr: 48.5,
    dividendYield: 0.45,
    roe: 152.0,
    equityRatio: 28.0,
    eps: 6.91,
    dps: 1.0,
    sector: "Consumer Electronics",
  },
  MSFT: {
    price: 428.15,
    change: 2.45,
    changePercent: 0.58,
    volume: 18500000,
    dayHigh: 430.5,
    dayLow: 426.0,
    yearHigh: 468.0,
    yearLow: 385.0,
    marketCap: 3180000,
    per: 33.5,
    pbr: 11.8,
    dividendYield: 0.78,
    roe: 38.5,
    equityRatio: 42.0,
    eps: 12.78,
    dps: 3.3,
    sector: "Software / Cloud",
  },
};

// Generates rich fundamentals for any ticker
export function getStockFundamentals(ticker: string): StockQuoteFundamentals {
  const input = ticker.trim().toUpperCase();
  const matchedPreset =
    POPULAR_STOCKS.find((s) => s.ticker.toUpperCase() === input) ??
    (input ? POPULAR_STOCKS.find((s) => s.name === input) : undefined);
  const normTicker = matchedPreset ? matchedPreset.ticker.toUpperCase() : input;

  const allOverviewAssets = [
    ...DEFAULT_MARKET_OVERVIEW.indices,
    ...DEFAULT_MARKET_OVERVIEW.forex,
    ...DEFAULT_MARKET_OVERVIEW.commodities,
    ...DEFAULT_MARKET_OVERVIEW.crypto,
  ];
  const overviewAsset = !matchedPreset
    ? allOverviewAssets.find((a) => a.symbol === normTicker)
    : undefined;

  const name = matchedPreset
    ? matchedPreset.name
    : overviewAsset
      ? overviewAsset.name
      : `銘柄 ${normTicker}`;
  const theme = matchedPreset
    ? matchedPreset.theme
    : overviewAsset
      ? overviewAsset.category === "FX"
        ? "為替"
        : overviewAsset.category === "COMMODITY"
          ? "コモディティ"
          : overviewAsset.category === "BOND"
            ? "債券"
            : overviewAsset.category === "CRYPTO"
              ? "暗号資産"
              : "株価指数"
      : "株式";
  const isUS = !/^\d/.test(normTicker);

  const anchor = KNOWN_STOCK_ANCHORS[normTicker];

  // Seed fallback for tickers without explicit anchor
  const seed = normTicker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const basePrice = overviewAsset
    ? overviewAsset.price
    : anchor
      ? anchor.price
      : isUS
        ? 120 + (seed % 350)
        : 1800 + (seed % 6500);
  const changePct = overviewAsset
    ? overviewAsset.changePercent
    : anchor
      ? anchor.changePercent
      : Number((((seed % 60) - 28) / 10).toFixed(2));
  const change = overviewAsset
    ? overviewAsset.change
    : anchor
      ? anchor.change
      : Number(((basePrice * changePct) / 100).toFixed(2));
  const prevClose = Number((basePrice - change).toFixed(2));

  const per = overviewAsset
    ? null
    : anchor
      ? anchor.per
      : isUS
        ? 22 + (seed % 35)
        : 12 + (seed % 20);
  const pbr = overviewAsset
    ? null
    : anchor
      ? anchor.pbr
      : Number((0.8 + (seed % 35) / 10).toFixed(2));
  const dividendYield = overviewAsset
    ? null
    : anchor
      ? anchor.dividendYield
      : Number((1.5 + (seed % 30) / 10).toFixed(2));
  const roe = overviewAsset ? null : anchor ? anchor.roe : Number((8 + (seed % 14)).toFixed(1));
  const equityRatio = overviewAsset ? null : anchor ? anchor.equityRatio : 40 + (seed % 45);
  const marketCap = overviewAsset
    ? 0
    : anchor
      ? anchor.marketCap
      : isUS
        ? 45000 + seed * 850
        : 12000 + seed * 280;

  const eps = overviewAsset
    ? null
    : anchor
      ? anchor.eps
      : per
        ? Number((basePrice / per).toFixed(1))
        : null;
  const dps = overviewAsset
    ? null
    : anchor
      ? anchor.dps
      : dividendYield
        ? Number(((basePrice * dividendYield) / 100).toFixed(1))
        : null;
  const sector = overviewAsset
    ? overviewAsset.category
    : (anchor?.sector ?? (isUS ? "Information Tech" : "電気機器・精密"));

  let technicalSignal: StockQuoteFundamentals["technicalSignal"] = "BUY";
  if (changePct > 2.0) technicalSignal = "STRONG_BUY";
  else if (changePct > 0) technicalSignal = "BUY";
  else if (changePct > -1.5) technicalSignal = "NEUTRAL";
  else technicalSignal = "SELL";

  // 4 years historical financial performance
  const currentYear = new Date().getFullYear();
  const safeEps = eps ?? 0;
  const safeDps = dps ?? 0;
  const historicalFinances = [
    {
      fiscalYear: `${currentYear - 3}/3`,
      revenue: Math.round(marketCap * 0.72),
      operatingIncome: Math.round(marketCap * 0.08),
      netIncome: Math.round(marketCap * 0.055),
      eps: Math.round(safeEps * 0.75),
      dps: Math.round(safeDps * 0.8),
    },
    {
      fiscalYear: `${currentYear - 2}/3`,
      revenue: Math.round(marketCap * 0.81),
      operatingIncome: Math.round(marketCap * 0.095),
      netIncome: Math.round(marketCap * 0.065),
      eps: Math.round(safeEps * 0.88),
      dps: Math.round(safeDps * 0.9),
    },
    {
      fiscalYear: `${currentYear - 1}/3`,
      revenue: Math.round(marketCap * 0.92),
      operatingIncome: Math.round(marketCap * 0.11),
      netIncome: Math.round(marketCap * 0.078),
      eps: Math.round(safeEps * 0.96),
      dps: Math.round(safeDps * 0.95),
    },
    {
      fiscalYear: `${currentYear}/3 (予)`,
      revenue: Math.round(marketCap * 1.04),
      operatingIncome: Math.round(marketCap * 0.125),
      netIncome: Math.round(marketCap * 0.088),
      eps: safeEps,
      dps: safeDps,
    },
  ];

  const s1 = Number((prevClose * (1 - ((seed % 15) - 7) / 200)).toFixed(2));
  const s2 = Number((prevClose * (1 - ((seed % 19) - 9) / 200)).toFixed(2));
  const s3 = Number((prevClose * (1 - ((seed % 11) - 5) / 200)).toFixed(2));
  const sparkline = [s1, s2, s3, prevClose, basePrice];

  const finalFinances = overviewAsset ? [] : historicalFinances;
  const finalSparkline = overviewAsset?.sparkline ?? sparkline;
  return {
    ticker: normTicker,
    name,
    theme,
    sector,
    market: isUS ? "US" : "PRIME",
    price: basePrice,
    change,
    changePercent: changePct,
    volume: anchor ? anchor.volume : 1250000 + seed * 8500,
    previousClose: prevClose,
    dayHigh: anchor ? anchor.dayHigh : Number((basePrice * 1.015).toFixed(2)),
    dayLow: anchor ? anchor.dayLow : Number((basePrice * 0.985).toFixed(2)),
    yearHigh: anchor ? anchor.yearHigh : Number((basePrice * 1.28).toFixed(2)),
    yearLow: anchor ? anchor.yearLow : Number((basePrice * 0.78).toFixed(2)),
    marketCap,
    per,
    pbr,
    dividendYield,
    roe,
    equityRatio,
    eps,
    dps,
    sparkline: finalSparkline,
    technicalSignal,
    historicalFinances: finalFinances,
    // 未知ティッカー (アンカー未定義) の場合は擬似生成データであることを明示
    ...(anchor ? {} : { isDemoData: true }),
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
  const changePercent = isFiniteNumber(record.changePercent) ? record.changePercent : 0;
  const sparkline = Array.isArray(record.sparkline) ? record.sparkline.filter(isFiniteNumber) : [];

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
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : "-",
  };
}

function sanitizeQuotes(raw: unknown): MarketAssetQuote[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeQuote).filter((quote): quote is MarketAssetQuote => quote !== null);
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
  const dataSource =
    record.dataSource === "fallback" || record.dataSource === "live"
      ? record.dataSource
      : undefined;
  const dataAsOf = typeof record.dataAsOf === "string" ? record.dataAsOf : undefined;

  return {
    ...(dataSource ? { dataSource } : {}),
    ...(dataAsOf ? { dataAsOf } : {}),
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
      ? record.news
          .filter(
            (item): item is Record<string, unknown> =>
              !!item &&
              typeof item === "object" &&
              typeof (item as { id?: unknown }).id === "string" &&
              typeof (item as { title?: unknown }).title === "string" &&
              typeof (item as { source?: unknown }).source === "string" &&
              typeof (item as { publishedAt?: unknown }).publishedAt === "string",
          )
          .map((item) => {
            const rawUrl = typeof item.url === "string" ? item.url : undefined;
            const safeUrl = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined;
            return {
              id: item.id as string,
              title: item.title as string,
              source: item.source as string,
              publishedAt: item.publishedAt as string,
              url: safeUrl,
              relatedTicker:
                typeof item.relatedTicker === "string" && item.relatedTicker
                  ? (item.relatedTicker as string)
                  : undefined,
            };
          })
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

// Fetch Market Overview Data (with API fallback and forceRefresh support)
export async function fetchMarketOverview(forceRefresh = false): Promise<MarketOverviewData> {
  const isBrowser = typeof globalThis !== "undefined" && "window" in globalThis;
  if (forceRefresh) {
    overviewEndpointConfirmedMissing = false;
  }
  if (isBrowser && !overviewEndpointConfirmedMissing) {
    try {
      const res = await fetch("/api/market/overview", {
        headers: { accept: "application/json" },
        cache: forceRefresh ? "no-cache" : "default",
      });
      if (res.status === 404) {
        overviewEndpointConfirmedMissing = true;
        return withFallbackMetadata(DEFAULT_MARKET_OVERVIEW);
      }
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        // The SPA fallback answers *.html paths with index.html; anything
        // that is not JSON means the route does not exist.
        if (!contentType.includes("json")) {
          overviewEndpointConfirmedMissing = true;
          return withFallbackMetadata(DEFAULT_MARKET_OVERVIEW);
        }
        const normalized = normalizeMarketOverview(await res.json());
        if (normalized) {
          return {
            ...normalized,
            dataSource: normalized.dataSource || "live",
          };
        }
      }
    } catch {
      // Graceful fallback to rich local baseline; a network error may be
      // transient, so the endpoint probe stays armed.
    }
  }
  return withFallbackMetadata(DEFAULT_MARKET_OVERVIEW);
}

/**
 * 静的ベースライン (フォールバック) データに出所と鮮度のメタデータを付与する。
 * 既存のオブジェクトは変更せず、新しいオブジェクトを返す (イミュータブル)。
 */
function withFallbackMetadata(data: MarketOverviewData): MarketOverviewData {
  return { ...data, dataSource: "fallback", dataAsOf: new Date().toISOString() };
}

/** Cache for stock fundamentals fetched from the backend API. */
const stockFundamentalsClientCache = new Map<string, StockQuoteFundamentals>();

export function clearStockFundamentalsClientCache(): void {
  stockFundamentalsClientCache.clear();
}

/**
 * Return cached fundamentals if available (e.g. preloaded by Screener),
 * otherwise falling back to baseline getStockFundamentals.
 */
export function getCachedStockFundamentals(ticker: string): StockQuoteFundamentals {
  const norm = ticker.trim().toUpperCase();
  const cached = stockFundamentalsClientCache.get(norm);
  if (cached) return cached;
  return getStockFundamentals(ticker);
}

/** Cache for entire screener universe fetched from /api/stocks/screener. */
let screenerUniverseClientCache: StockQuoteFundamentals[] | null = null;

export function clearScreenerUniverseClientCache(): void {
  screenerUniverseClientCache = null;
}

/**
 * Format market cap for display with correct Japanese and US financial conventions.
 * Japanese stocks: stored in 億円. >= 10,000 億円 formatted as 兆円 (e.g. 29.1 兆円), otherwise 億円 (e.g. 3,500 億円).
 * US stocks: stored in millions of USD ($M). >= 1,000,000 $M formatted as 兆ドル (e.g. 5.54 兆ドル), >= 1,000 as 億ドル, otherwise 百万ドル.
 */
export function formatMarketCapDisplay(marketCap: number, market: string): string {
  if (typeof marketCap !== "number" || !Number.isFinite(marketCap) || marketCap <= 0) {
    return "--";
  }
  if (market === "US") {
    if (marketCap >= 1_000_000) {
      return `${(marketCap / 1_000_000).toFixed(2)} 兆ドル`;
    } else if (marketCap >= 1_000) {
      // marketCap is stored in millions of USD, so 1 億ドル = 100 $M.
      // Dividing by 1,000 understated US market caps by 10x (e.g. $45B was
      // rendered as "45 億ドル" = $4.5B).
      return `${(marketCap / 100).toFixed(0)} 億ドル`;
    }
    return `${marketCap.toLocaleString()} 百万ドル`;
  }
  if (marketCap >= 10_000) {
    return `${(marketCap / 10_000).toFixed(1)} 兆円`;
  }
  return `${marketCap.toLocaleString()} 億円`;
}

/**
 * Fetch real stock quote & fundamentals from /api/stock/fundamentals,
 * falling back to getStockFundamentals(ticker) if unavailable or offline.
 */
export async function fetchStockFundamentals(
  ticker: string,
  forceRefresh = false,
): Promise<StockQuoteFundamentals> {
  const normTicker = ticker.trim().toUpperCase();
  if (!normTicker) return getStockFundamentals(ticker);

  if (forceRefresh) {
    stockFundamentalsClientCache.delete(normTicker);
  } else {
    const cached = stockFundamentalsClientCache.get(normTicker);
    if (cached) return cached;
  }

  const isBrowser = typeof globalThis !== "undefined" && "window" in globalThis;
  if (isBrowser) {
    try {
      const res = await fetch(`/api/stock/fundamentals?ticker=${encodeURIComponent(normTicker)}`, {
        headers: { accept: "application/json" },
        cache: forceRefresh ? "no-cache" : "default",
      });
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("json")) {
          const raw = await res.json();
          if (
            raw &&
            typeof raw === "object" &&
            typeof (raw as { ticker?: unknown }).ticker === "string" &&
            typeof (raw as { price?: unknown }).price === "number" &&
            Number.isFinite((raw as { price?: unknown }).price)
          ) {
            const data = raw as StockQuoteFundamentals;
            stockFundamentalsClientCache.set(normTicker, data);
            return data;
          }
        }
      }
    } catch {
      // Graceful fallback to rich baseline
    }
  }

  const baseline = getStockFundamentals(normTicker);
  stockFundamentalsClientCache.set(normTicker, baseline);
  return baseline;
}

// Screener Query Options
export interface ScreenerFilterOptions {
  market?: "ALL" | "PRIME" | "STANDARD" | "GROWTH" | "US";
  minDividendYield?: number;
  maxPer?: number;
  maxPbr?: number;
  minRoe?: number;
  searchQuery?: string;
  sortBy?:
    | "changePercent"
    | "dividendYield"
    | "per"
    | "pbr"
    | "volume"
    | "marketCap"
    | "price"
    | "roe"
    | "name"
    | "ticker";
  sortOrder?: "asc" | "desc";
}

/**
 * Screen Stocks across POPULAR_STOCKS universe (supports an optional custom universe
 * populated with live market data from /api/stocks/screener).
 */
export function runStockScreener(
  options: ScreenerFilterOptions = {},
  customUniverse?: StockQuoteFundamentals[],
): StockQuoteFundamentals[] {
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

  const allStocks = customUniverse ?? POPULAR_STOCKS.map((s) => getStockFundamentals(s.ticker));

  const filtered = allStocks.filter((stock) => {
    if (market !== "ALL" && stock.market !== market) {
      return false;
    }

    if (
      minDividendYield !== undefined &&
      (stock.dividendYield === null || stock.dividendYield < minDividendYield)
    ) {
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
        stock.theme.toLowerCase().includes(q) ||
        (stock.sector && stock.sector.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    const valA = a[sortBy];
    const valB = b[sortBy];

    if (typeof valA === "string" && typeof valB === "string") {
      const cmp = valA.localeCompare(valB, "ja");
      return sortOrder === "asc" ? cmp : -cmp;
    }

    const hasNumA = typeof valA === "number" && Number.isFinite(valA);
    const hasNumB = typeof valB === "number" && Number.isFinite(valB);

    if (!hasNumA && !hasNumB) return 0;
    // Missing/null metrics always sort to the end
    if (!hasNumA) return 1;
    if (!hasNumB) return -1;

    const numA = valA as number;
    const numB = valB as number;
    if (numA === numB) return 0;
    return sortOrder === "asc" ? (numA > numB ? 1 : -1) : numA < numB ? 1 : -1;
  });
}

/**
 * Fetch entire universe of live stocks from /api/stocks/screener,
 * caching results and falling back to local baseline universe if offline.
 */
export async function fetchScreenerStocks(
  options: ScreenerFilterOptions = {},
  forceRefresh = false,
): Promise<StockQuoteFundamentals[]> {
  if (forceRefresh) {
    screenerUniverseClientCache = null;
  }

  if (screenerUniverseClientCache && !forceRefresh) {
    return runStockScreener(options, screenerUniverseClientCache);
  }

  const isBrowser = typeof globalThis !== "undefined" && "window" in globalThis;
  if (isBrowser) {
    try {
      const res = await fetch("/api/stocks/screener", {
        headers: { accept: "application/json" },
        cache: forceRefresh ? "no-cache" : "default",
      });
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("json")) {
          const raw = await res.json();
          if (Array.isArray(raw) && raw.length > 0) {
            const valid = raw.filter(
              (item): item is StockQuoteFundamentals =>
                !!item &&
                typeof item === "object" &&
                typeof item.ticker === "string" &&
                typeof item.price === "number" &&
                Number.isFinite(item.price) &&
                item.price > 0,
            );
            if (valid.length > 0) {
              screenerUniverseClientCache = valid;
              // Also populate individual stock cache for faster StockDetailPage access
              for (const stock of valid) {
                stockFundamentalsClientCache.set(stock.ticker.toUpperCase(), stock);
              }
              return runStockScreener(options, valid);
            }
          }
        }
      }
    } catch {
      // Graceful fallback to baseline
    }
  }

  return runStockScreener(options);
}

const CALENDAR_CACHE_KEY = "indexforge:calendar:cache:v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getSessionStorageSafe(): StorageLike | null {
  try {
    const g = globalThis as unknown as {
      sessionStorage?: StorageLike;
      window?: { sessionStorage?: StorageLike };
    };
    if (typeof g !== "undefined") {
      if (g.sessionStorage) return g.sessionStorage;
      if (g.window?.sessionStorage) return g.window.sessionStorage;
    }
  } catch {
    // Ignore
  }
  return null;
}

function saveCalendarCache(events: CalendarEvent[]): void {
  try {
    const storage = getSessionStorageSafe();
    if (storage) {
      storage.setItem(CALENDAR_CACHE_KEY, JSON.stringify(events));
    }
  } catch {
    // Ignore storage quota/security errors
  }
}

/**
 * Per-item validation for calendar events. Applied to both API responses and
 * cached JSON: CalendarPage reads `importance`, `type` and `date` directly, so
 * a stale or hand-edited cache entry with a malformed shape would render blank
 * or broken rows instead of falling back to the generated calendar.
 */
function isValidCalendarEvent(e: unknown): e is CalendarEvent {
  if (!e || typeof e !== "object") return false;
  const record = e as { id?: unknown; date?: unknown; title?: unknown };
  return (
    typeof record.id === "string" &&
    typeof record.date === "string" &&
    typeof record.title === "string"
  );
}

function loadCalendarCache(): CalendarEvent[] | null {
  try {
    const storage = getSessionStorageSafe();
    if (storage) {
      const stored = storage.getItem(CALENDAR_CACHE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(isValidCalendarEvent);
          if (valid.length > 0) {
            return valid;
          }
        }
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Fetch dynamic financial calendar events from /api/market/calendar,
 * falling back to cached events or UPCOMING_EVENTS.
 */
export async function fetchUpcomingEvents(forceRefresh = false): Promise<CalendarEvent[]> {
  const canFetch = typeof globalThis !== "undefined" && typeof globalThis.fetch === "function";
  if (canFetch) {
    try {
      const url = forceRefresh
        ? `/api/market/calendar?refresh=${Date.now()}`
        : "/api/market/calendar";
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(forceRefresh ? { "cache-control": "no-cache" } : {}),
        },
        cache: forceRefresh ? "no-cache" : "default",
      });
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("json")) {
          const raw = await res.json();
          if (Array.isArray(raw) && raw.length > 0) {
            const valid = raw.filter(isValidCalendarEvent);
            if (valid.length > 0) {
              saveCalendarCache(valid);
              return valid;
            }
          }
        }
      }
    } catch {
      // Graceful fallback to client cache or dynamic generator
    }

    const cached = loadCalendarCache();
    if (cached && cached.length > 0) {
      return cached;
    }
  }
  return generateUpcomingEvents();
}

/**
 * Generates financial calendar events dynamically relative to the reference date.
 *
 * 生成されるイベントは静的テンプレート由来の参考値であるため、
 * 各イベントに source: "fallback" を付与する。
 * CalendarPage のフォールバック表示 (バナー + 「参考値」バッジ) は
 * このメタデータに依存して動作する。
 */
export function generateUpcomingEvents(referenceDate = new Date()): CalendarEvent[] {
  const mStr = (m: number) => String(m).padStart(2, "0");
  const dStr = (d: number) => String(d).padStart(2, "0");
  const fmt = (d: Date) => `${mStr(d.getMonth() + 1)}/${dStr(d.getDate())}`;
  const fmtFull = (d: Date) => `${d.getFullYear()}-${mStr(d.getMonth() + 1)}-${dStr(d.getDate())}`;

  const addBusinessDays = (start: Date, days: number): Date => {
    const cur = new Date(start);
    let added = 0;
    while (added < days) {
      cur.setDate(cur.getDate() + 1);
      const day = cur.getDay();
      if (day !== 0 && day !== 6) {
        added++;
      }
    }
    return cur;
  };

  const adjustToWeekday = (d: Date): Date => {
    const res = new Date(d);
    const day = res.getDay();
    if (day === 0) res.setDate(res.getDate() + 1);
    if (day === 6) res.setDate(res.getDate() + 2);
    return res;
  };

  const events: CalendarEvent[] = [];

  // マクロ: 日銀会合 (直近平日)
  const bojDate = adjustToWeekday(addBusinessDays(referenceDate, 4));
  events.push({
    id: "macro-boj",
    date: fmt(bojDate),
    fullDate: fmtFull(bojDate),
    type: "MACRO",
    title: "日銀金融政策決定会合・総裁記者会見",
    importance: "HIGH",
    previous: "0.25%",
    forecast: "0.25%",
    source: "fallback",
  });

  // マクロ: 米FOMC (中旬〜月末平日)
  const fomcDate = adjustToWeekday(addBusinessDays(referenceDate, 12));
  events.push({
    id: "macro-fomc",
    date: fmt(fomcDate),
    fullDate: fmtFull(fomcDate),
    type: "MACRO",
    title: "米FOMC 政策金利発表 & パウエル議長記者会見",
    importance: "HIGH",
    previous: "5.00%",
    forecast: "4.75%",
    source: "fallback",
  });

  // マクロ: 米雇用統計 (第1金曜日)
  const jobsDate = (() => {
    for (let offset = 0; offset <= 2; offset++) {
      const y = referenceDate.getFullYear();
      const m = referenceDate.getMonth() + offset;
      const firstDay = new Date(y, m, 1);
      const dayOfWeek = firstDay.getDay();
      const diff = (5 - dayOfWeek + 7) % 7;
      const friday = new Date(y, m, 1 + diff);
      if (friday.getTime() >= referenceDate.getTime() - 24 * 60 * 60 * 1000) {
        return friday;
      }
    }
    return addBusinessDays(referenceDate, 6);
  })();

  events.push({
    id: "macro-jobs",
    date: fmt(jobsDate),
    fullDate: fmtFull(jobsDate),
    type: "MACRO",
    title: "米雇用統計 (非農業部門雇用者数・失業率)",
    importance: "HIGH",
    previous: "25.4万人",
    forecast: "12.0万人",
    source: "fallback",
  });

  // マクロ: 米CPI (中旬平日)
  const cpiDate = (() => {
    for (let offset = 0; offset <= 2; offset++) {
      const y = referenceDate.getFullYear();
      const m = referenceDate.getMonth() + offset;
      const d = adjustToWeekday(new Date(y, m, 12));
      if (d.getTime() >= referenceDate.getTime() - 24 * 60 * 60 * 1000) {
        return d;
      }
    }
    return addBusinessDays(referenceDate, 15);
  })();

  events.push({
    id: "macro-cpi",
    date: fmt(cpiDate),
    fullDate: fmtFull(cpiDate),
    type: "MACRO",
    title: "米消費者物価指数 (CPI) 発表",
    importance: "HIGH",
    previous: "2.4%",
    forecast: "2.3%",
    source: "fallback",
  });

  // 主要企業決算 (平日に分散配置)
  const corporateList = [
    {
      id: "earn-toyota",
      ticker: "7203",
      companyName: "トヨタ自動車",
      title: "トヨタ自動車 (7203) 決算発表",
      marketCap: 345000,
      importance: "HIGH" as const,
      days: 2,
    },
    {
      id: "earn-shinetsu",
      ticker: "4063",
      companyName: "信越化学工業",
      title: "信越化学工業 (4063) 決算発表",
      marketCap: 115000,
      importance: "HIGH" as const,
      days: 5,
    },
    {
      id: "earn-fanuc",
      ticker: "6954",
      companyName: "ファナック",
      title: "ファナック (6954) 決算発表",
      marketCap: 41000,
      importance: "MEDIUM" as const,
      days: 7,
    },
    {
      id: "earn-advantest",
      ticker: "6857",
      companyName: "アドバンテスト",
      title: "アドバンテスト (6857) 決算発表",
      marketCap: 300000,
      importance: "HIGH" as const,
      days: 9,
    },
    {
      id: "earn-aapl",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      title: "Apple (AAPL) 決算発表",
      marketCap: 4900000,
      importance: "HIGH" as const,
      days: 13,
    },
    {
      id: "earn-sbg",
      ticker: "9984",
      companyName: "ソフトバンクグループ",
      title: "ソフトバンクグループ (9984) 決算発表",
      marketCap: 135000,
      importance: "HIGH" as const,
      days: 16,
    },
    {
      id: "earn-tel",
      ticker: "8035",
      companyName: "東京エレクトロン",
      title: "東京エレクトロン (8035) 決算発表",
      marketCap: 290000,
      importance: "HIGH" as const,
      days: 18,
    },
    {
      id: "earn-nvda",
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      title: "NVIDIA (NVDA) 決算発表",
      marketCap: 5500000,
      importance: "HIGH" as const,
      days: 22,
    },
  ];

  for (const corp of corporateList) {
    const corpDate = addBusinessDays(referenceDate, corp.days);
    events.push({
      id: corp.id,
      date: fmt(corpDate),
      fullDate: fmtFull(corpDate),
      type: "EARNINGS",
      title: corp.title,
      ticker: corp.ticker,
      companyName: corp.companyName,
      importance: corp.importance,
      marketCap: corp.marketCap,
      source: "fallback",
    });
  }

  // 日付順にソート (fullDate 優先、または6ヶ月境界判定)
  const currentYear = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth() + 1;
  const parseEventTime = (e: CalendarEvent): number => {
    if (e.fullDate) {
      const parts = e.fullDate.split("-");
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
          return new Date(y, m - 1, d).getTime();
        }
      }
    }
    const [m, d] = e.date.split("/").map(Number);
    let y = currentYear;
    if (m < currentMonth && currentMonth - m >= 6) {
      y = currentYear + 1;
    } else if (m > currentMonth && m - currentMonth >= 6) {
      y = currentYear - 1;
    }
    return new Date(y, m - 1, d).getTime();
  };

  return events.sort((a, b) => parseEventTime(a) - parseEventTime(b));
}

export const UPCOMING_EVENTS: CalendarEvent[] = generateUpcomingEvents();
