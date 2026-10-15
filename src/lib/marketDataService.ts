/**
 * Market Data Service
 * 統合投資情報プラットフォーム向けのマーケット情報、株価、ファンダメンタルズ、スクリーナー、カレンダーの取得・管理サービス
 */

import { POPULAR_STOCKS } from "../data/popularStocks";
import { BASELINE_ASSET_QUOTES, type BaselineAssetQuote } from "../data/marketConstants";
import {
  BOJ_MEETING_SCHEDULE,
  FOMC_MEETING_SCHEDULE,
  getNextScheduledMeetings,
  MACRO_METRICS_DEFAULTS,
} from "../data/macroSchedule";
import { escapeCsvCell } from "./csv";

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
    publishedTimestamp?: string;
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
  /** 発表予定時刻 (例: "15:00 JST", "21:30 JST", "03:00 JST") */
  time?: string;
  /** 市場・地域区分 ("TSE": 国内東証, "US": 米国市場) */
  market?: "TSE" | "US";
  /** サプライズ判定 (発表結果と市場予想の比較) */
  surprise?: "BEAT" | "MISS" | "IN_LINE";
  /** 指標や決算の概要・注目ポイント解説 */
  description?: string;
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

/**
 * Format relative time string dynamically (e.g. "25分前", "1時間前", "昨日")
 * based on elapsed minutes from reference time or ISO timestamp.
 */
export function formatDynamicRelativeTime(
  offsetMinutesOrDate: number | string | Date,
  now = new Date(),
): string {
  let diffMs: number;
  if (typeof offsetMinutesOrDate === "number") {
    diffMs = offsetMinutesOrDate * 60 * 1000;
  } else {
    const target = new Date(offsetMinutesOrDate).getTime();
    diffMs = Math.max(0, now.getTime() - target);
  }

  const diffMins = Math.floor(diffMs / (60 * 1000));
  if (diffMins < 1) return "たった今";
  if (diffMins < 60) return `${diffMins}分前`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}時間前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "昨日";
  if (diffDays < 7) return `${diffDays}日前`;
  return `${Math.floor(diffDays / 7)}週間前`;
}

export function buildDefaultMarketNews(refDate = new Date()) {
  return [
    {
      id: "news-1",
      title: "日経平均は高水準推移、主要半導体・ハイテク関連株に堅調な買い需要",
      source: "市場速報",
      publishedAt: formatDynamicRelativeTime(25, refDate),
      publishedTimestamp: new Date(refDate.getTime() - 25 * 60 * 1000).toISOString(),
      relatedTicker: "8035",
    },
    {
      id: "news-2",
      title: "米ハイテク株と主要指数が堅調、AIインフラ需要期待が下支え",
      source: "グローバル金融",
      publishedAt: formatDynamicRelativeTime(60, refDate),
      publishedTimestamp: new Date(refDate.getTime() - 60 * 60 * 1000).toISOString(),
      relatedTicker: "NVDA",
    },
    {
      id: "news-3",
      title: "ドル円は158円台前半で推移、日米金利差と金融政策動向を注視",
      source: "為替市況",
      publishedAt: formatDynamicRelativeTime(120, refDate),
      publishedTimestamp: new Date(refDate.getTime() - 120 * 60 * 1000).toISOString(),
      relatedTicker: "USDJPY=X",
    },
    {
      id: "news-4",
      title: "東証プライム騰落レシオは良好、好業績バリュー銘柄に見直し買いが継続",
      source: "株式ニュース",
      publishedAt: formatDynamicRelativeTime(180, refDate),
      publishedTimestamp: new Date(refDate.getTime() - 180 * 60 * 1000).toISOString(),
    },
  ];
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
  news: buildDefaultMarketNews(),
};

export interface KnownStockAnchor {
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
  market?: "PRIME" | "STANDARD" | "GROWTH" | "US";
  historicalFinances?: Array<{
    fiscalYear: string;
    revenue: number;
    operatingIncome: number;
    netIncome: number;
    eps: number;
    dps: number;
  }>;
}

export const KNOWN_STOCK_ANCHORS: Record<string, KnownStockAnchor> = {
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/3", revenue: 313795, operatingIncome: 29956, netIncome: 28501, eps: 205.2, dps: 52 },
      { fiscalYear: "2023/3", revenue: 371542, operatingIncome: 27250, netIncome: 24513, eps: 179.5, dps: 60 },
      { fiscalYear: "2024/3", revenue: 450953, operatingIncome: 53529, netIncome: 49449, eps: 365.9, dps: 90 },
      { fiscalYear: "2025/3 (予)", revenue: 460000, operatingIncome: 43000, netIncome: 35700, eps: 270.0, dps: 100 },
    ],
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/3", revenue: 20038, operatingIncome: 5992, netIncome: 4370, eps: 279.7, dps: 351 },
      { fiscalYear: "2023/3", revenue: 22090, operatingIncome: 6177, netIncome: 4715, eps: 301.9, dps: 360 },
      { fiscalYear: "2024/3", revenue: 18305, operatingIncome: 4562, netIncome: 3639, eps: 234.6, dps: 394 },
      { fiscalYear: "2025/3 (予)", revenue: 24000, operatingIncome: 6800, netIncome: 5260, eps: 340.5, dps: 466 },
    ],
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/3", revenue: 4169, operatingIncome: 1147, netIncome: 873, eps: 113.8, dps: 65 },
      { fiscalYear: "2023/3", revenue: 5602, operatingIncome: 1677, netIncome: 1304, eps: 171.6, dps: 70 },
      { fiscalYear: "2024/3", revenue: 4866, operatingIncome: 816, netIncome: 623, eps: 83.2, dps: 72 },
      { fiscalYear: "2025/3 (予)", revenue: 6400, operatingIncome: 1650, netIncome: 1220, eps: 164.0, dps: 116 },
    ],
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/3", revenue: 99215, operatingIncome: 12023, netIncome: 8822, eps: 142.1, dps: 13 },
      { fiscalYear: "2023/3", revenue: 110449, operatingIncome: 12130, netIncome: 9371, eps: 151.7, dps: 16 },
      { fiscalYear: "2024/3", revenue: 130208, operatingIncome: 12088, netIncome: 9706, eps: 157.3, dps: 19 },
      { fiscalYear: "2025/3 (予)", revenue: 127100, operatingIncome: 13100, netIncome: 9800, eps: 159.0, dps: 21 },
    ],
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/3", revenue: 7551, operatingIncome: 4180, netIncome: 3033, eps: 1251.2, dps: 300 },
      { fiscalYear: "2023/3", revenue: 9224, operatingIncome: 4989, netIncome: 3629, eps: 1497.1, dps: 350 },
      { fiscalYear: "2024/3", revenue: 9672, operatingIncome: 4950, netIncome: 3696, eps: 1524.7, dps: 350 },
      { fiscalYear: "2025/3 (予)", revenue: 10400, operatingIncome: 5350, netIncome: 3900, eps: 1610.0, dps: 400 },
    ],
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/3", revenue: 62206, operatingIncome: -8726, netIncome: -17080, eps: -912.4, dps: 44 },
      { fiscalYear: "2023/3", revenue: 65704, operatingIncome: -15234, netIncome: -9701, eps: -684.0, dps: 44 },
      { fiscalYear: "2024/3", revenue: 67565, operatingIncome: 7409, netIncome: -2276, eps: -157.0, dps: 44 },
      { fiscalYear: "2025/3 (予)", revenue: 71000, operatingIncome: 9500, netIncome: 5400, eps: 373.5, dps: 44 },
    ],
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/3", revenue: 121564, operatingIncome: 17686, netIncome: 11810, eps: 12.8, dps: 4.6 },
      { fiscalYear: "2023/3", revenue: 131362, operatingIncome: 18289, netIncome: 12131, eps: 13.5, dps: 4.8 },
      { fiscalYear: "2024/3", revenue: 133746, operatingIncome: 19229, netIncome: 12591, eps: 14.1, dps: 5.0 },
      { fiscalYear: "2025/3 (予)", revenue: 134600, operatingIncome: 18100, netIncome: 11000, eps: 13.2, dps: 5.2 },
    ],
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/3", revenue: 60759, operatingIncome: 15392, netIncome: 11308, eps: 87.5, dps: 28 },
      { fiscalYear: "2023/3", revenue: 92769, operatingIncome: 15637, netIncome: 11164, eps: 89.2, dps: 32 },
      { fiscalYear: "2024/3", revenue: 112185, operatingIncome: 20215, netIncome: 14907, eps: 123.8, dps: 41 },
      { fiscalYear: "2025/3 (予)", revenue: 118000, operatingIncome: 23500, netIncome: 17500, eps: 150.0, dps: 55 },
    ],
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/3", revenue: 172648, operatingIncome: 12518, netIncome: 9375, eps: 211.5, dps: 50 },
      { fiscalYear: "2023/3", revenue: 215719, operatingIncome: 14782, netIncome: 11806, eps: 270.8, dps: 60 },
      { fiscalYear: "2024/3", revenue: 195676, operatingIncome: 11425, netIncome: 9640, eps: 231.2, dps: 100 },
      { fiscalYear: "2025/3 (予)", revenue: 200000, operatingIncome: 12000, netIncome: 10000, eps: 250.0, dps: 108 },
    ],
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/3", revenue: 16953, operatingIncome: 5927, netIncome: 4776, eps: 395.0, dps: 203 },
      { fiscalYear: "2023/3", revenue: 16016, operatingIncome: 5043, netIncome: 4327, eps: 371.4, dps: 186 },
      { fiscalYear: "2024/3", revenue: 16718, operatingIncome: 5289, netIncome: 4906, eps: 421.2, dps: 211 },
      { fiscalYear: "2025/3 (予)", revenue: 12800, operatingIncome: 3600, netIncome: 3000, eps: 311.3, dps: 210 },
    ],
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
    market: "PRIME",
    historicalFinances: [
      { fiscalYear: "2022/8", revenue: 23011, operatingIncome: 2973, netIncome: 2733, eps: 892.4, dps: 207 },
      { fiscalYear: "2023/8", revenue: 27665, operatingIncome: 3810, netIncome: 2962, eps: 967.0, dps: 290 },
      { fiscalYear: "2024/8", revenue: 31038, operatingIncome: 5009, netIncome: 3719, eps: 1213.5, dps: 400 },
      { fiscalYear: "2025/8 (予)", revenue: 34000, operatingIncome: 5300, netIncome: 3850, eps: 1260.8, dps: 425 },
    ],
  },
  "6920": {
    price: 21850.0,
    change: 350.0,
    changePercent: 1.63,
    volume: 12500000,
    dayHigh: 22100.0,
    dayLow: 21600.0,
    yearHigh: 44950.0,
    yearLow: 19500.0,
    marketCap: 206000,
    per: 32.5,
    pbr: 14.8,
    dividendYield: 1.15,
    roe: 45.2,
    equityRatio: 62.0,
    eps: 672.3,
    dps: 251.0,
    sector: "電気機器・最先端マスク検査",
    market: "PRIME",
  },
  "6146": {
    price: 38200.0,
    change: 750.0,
    changePercent: 2.00,
    volume: 2200000,
    dayHigh: 38800.0,
    dayLow: 37900.0,
    yearHigh: 68500.0,
    yearLow: 33000.0,
    marketCap: 138000,
    per: 32.0,
    pbr: 6.95,
    dividendYield: 1.95,
    roe: 23.5,
    equityRatio: 72.0,
    eps: 1193.7,
    dps: 745.0,
    sector: "機械・半導体切断加工",
    market: "PRIME",
  },
  "6501": {
    price: 3950.0,
    change: 45.0,
    changePercent: 1.15,
    volume: 8200000,
    dayHigh: 3990.0,
    dayLow: 3920.0,
    yearHigh: 4250.0,
    yearLow: 2300.0,
    marketCap: 371000,
    per: 24.8,
    pbr: 2.75,
    dividendYield: 1.14,
    roe: 11.5,
    equityRatio: 36.0,
    eps: 159.2,
    dps: 45.0,
    sector: "電気機器・社会インフラ",
    market: "PRIME",
  },
  "6702": {
    price: 2950.0,
    change: 32.0,
    changePercent: 1.10,
    volume: 4100000,
    dayHigh: 2980.0,
    dayLow: 2930.0,
    yearHigh: 3200.0,
    yearLow: 2100.0,
    marketCap: 56000,
    per: 21.5,
    pbr: 2.80,
    dividendYield: 1.35,
    roe: 13.5,
    equityRatio: 48.0,
    eps: 137.2,
    dps: 40.0,
    sector: "情報・通信業 (ITサービス)",
    market: "PRIME",
  },
  "6723": {
    price: 2080.0,
    change: -15.0,
    changePercent: -0.72,
    volume: 15200000,
    dayHigh: 2120.0,
    dayLow: 2060.0,
    yearHigh: 3250.0,
    yearLow: 1950.0,
    marketCap: 385000,
    per: 13.5,
    pbr: 1.85,
    dividendYield: 0.0,
    roe: 14.2,
    equityRatio: 55.0,
    eps: 154.0,
    dps: 0.0,
    sector: "電気機器・車載半導体",
    market: "PRIME",
  },
  "6981": {
    price: 2680.0,
    change: 18.0,
    changePercent: 0.68,
    volume: 6800000,
    dayHigh: 2710.0,
    dayLow: 2660.0,
    yearHigh: 3450.0,
    yearLow: 2500.0,
    marketCap: 540000,
    per: 22.5,
    pbr: 1.85,
    dividendYield: 1.87,
    roe: 8.5,
    equityRatio: 82.0,
    eps: 119.1,
    dps: 50.0,
    sector: "電気機器・電子部品",
    market: "PRIME",
  },
  "7735": {
    price: 9980.0,
    change: 210.0,
    changePercent: 2.15,
    volume: 2900000,
    dayHigh: 10100.0,
    dayLow: 9850.0,
    yearHigh: 18500.0,
    yearLow: 9200.0,
    marketCap: 48000,
    per: 15.2,
    pbr: 2.45,
    dividendYield: 2.85,
    roe: 17.5,
    equityRatio: 64.0,
    eps: 656.5,
    dps: 284.0,
    sector: "精密機器・半導体洗浄",
    market: "PRIME",
  },
  "7011": {
    price: 2150.0,
    change: 48.0,
    changePercent: 2.28,
    volume: 22500000,
    dayHigh: 2180.0,
    dayLow: 2120.0,
    yearHigh: 2450.0,
    yearLow: 1100.0,
    marketCap: 72000,
    per: 28.5,
    pbr: 3.25,
    dividendYield: 1.16,
    roe: 12.4,
    equityRatio: 35.0,
    eps: 75.4,
    dps: 25.0,
    sector: "機械 (防衛・重工)",
    market: "PRIME",
  },
  "7012": {
    price: 6450.0,
    change: 160.0,
    changePercent: 2.54,
    volume: 5800000,
    dayHigh: 6550.0,
    dayLow: 6350.0,
    yearHigh: 7200.0,
    yearLow: 3800.0,
    marketCap: 10800,
    per: 18.5,
    pbr: 1.85,
    dividendYield: 1.85,
    roe: 10.5,
    equityRatio: 26.0,
    eps: 348.6,
    dps: 120.0,
    sector: "機械 (防衛・航空・重工)",
    market: "PRIME",
  },
  "7013": {
    price: 8650.0,
    change: 220.0,
    changePercent: 2.61,
    volume: 4900000,
    dayHigh: 8780.0,
    dayLow: 8520.0,
    yearHigh: 9400.0,
    yearLow: 3400.0,
    marketCap: 13300,
    per: 16.5,
    pbr: 2.65,
    dividendYield: 1.62,
    roe: 16.5,
    equityRatio: 22.0,
    eps: 524.2,
    dps: 140.0,
    sector: "機械 (防衛・航空宇宙)",
    market: "PRIME",
  },
  "9433": {
    price: 4850.0,
    change: 20.0,
    changePercent: 0.41,
    volume: 4800000,
    dayHigh: 4880.0,
    dayLow: 4830.0,
    yearHigh: 5100.0,
    yearLow: 4200.0,
    marketCap: 105000,
    per: 14.5,
    pbr: 1.75,
    dividendYield: 3.10,
    roe: 12.8,
    equityRatio: 46.0,
    eps: 334.5,
    dps: 150.0,
    sector: "情報・通信業",
    market: "PRIME",
  },
  "9434": {
    price: 198.5,
    change: 0.8,
    changePercent: 0.40,
    volume: 28000000,
    dayHigh: 199.5,
    dayLow: 197.5,
    yearHigh: 215.0,
    yearLow: 175.0,
    marketCap: 95000,
    per: 17.8,
    pbr: 4.85,
    dividendYield: 4.35,
    roe: 28.5,
    equityRatio: 16.0,
    eps: 11.1,
    dps: 8.6,
    sector: "情報・通信業",
    market: "PRIME",
  },
  "3778": {
    price: 4350.0,
    change: 120.0,
    changePercent: 2.84,
    volume: 5500000,
    dayHigh: 4450.0,
    dayLow: 4280.0,
    yearHigh: 10980.0,
    yearLow: 3800.0,
    marketCap: 17200,
    per: 95.0,
    pbr: 12.5,
    dividendYield: 0.25,
    roe: 13.8,
    equityRatio: 38.0,
    eps: 45.8,
    dps: 11.0,
    sector: "情報・通信業 (AIクラウド)",
    market: "PRIME",
  },
  "4689": {
    price: 425.0,
    change: 3.5,
    changePercent: 0.83,
    volume: 21000000,
    dayHigh: 428.0,
    dayLow: 422.0,
    yearHigh: 520.0,
    yearLow: 360.0,
    marketCap: 32000,
    per: 19.5,
    pbr: 1.05,
    dividendYield: 1.65,
    roe: 5.5,
    equityRatio: 62.0,
    eps: 21.8,
    dps: 7.0,
    sector: "情報・通信業 (ネット・広告)",
    market: "PRIME",
  },
  "7267": {
    price: 1450.0,
    change: 12.0,
    changePercent: 0.83,
    volume: 18000000,
    dayHigh: 1465.0,
    dayLow: 1440.0,
    yearHigh: 1950.0,
    yearLow: 1350.0,
    marketCap: 72000,
    per: 6.8,
    pbr: 0.58,
    dividendYield: 4.68,
    roe: 9.8,
    equityRatio: 42.0,
    eps: 213.2,
    dps: 68.0,
    sector: "輸送用機器 (自動車)",
    market: "PRIME",
  },
  "7269": {
    price: 1880.0,
    change: 15.0,
    changePercent: 0.80,
    volume: 6200000,
    dayHigh: 1895.0,
    dayLow: 1865.0,
    yearHigh: 2150.0,
    yearLow: 1550.0,
    marketCap: 36500,
    per: 12.8,
    pbr: 1.45,
    dividendYield: 2.25,
    roe: 12.1,
    equityRatio: 48.0,
    eps: 146.8,
    dps: 42.0,
    sector: "輸送用機器 (軽・2輪)",
    market: "PRIME",
  },
  "7201": {
    price: 410.0,
    change: -4.5,
    changePercent: -1.09,
    volume: 24000000,
    dayHigh: 416.0,
    dayLow: 408.0,
    yearHigh: 640.0,
    yearLow: 380.0,
    marketCap: 16000,
    per: 8.5,
    pbr: 0.28,
    dividendYield: 4.88,
    roe: 3.5,
    equityRatio: 28.0,
    eps: 48.2,
    dps: 20.0,
    sector: "輸送用機器 (自動車)",
    market: "PRIME",
  },
  "6902": {
    price: 2280.0,
    change: 18.0,
    changePercent: 0.80,
    volume: 7500000,
    dayHigh: 2300.0,
    dayLow: 2260.0,
    yearHigh: 3050.0,
    yearLow: 2050.0,
    marketCap: 67000,
    per: 14.5,
    pbr: 1.15,
    dividendYield: 2.65,
    roe: 8.5,
    equityRatio: 61.0,
    eps: 157.2,
    dps: 60.0,
    sector: "輸送用機器 (自動車部品)",
    market: "PRIME",
  },
  "8316": {
    price: 3620.0,
    change: 42.0,
    changePercent: 1.17,
    volume: 14500000,
    dayHigh: 3650.0,
    dayLow: 3590.0,
    yearHigh: 3950.0,
    yearLow: 2600.0,
    marketCap: 141000,
    per: 11.5,
    pbr: 0.92,
    dividendYield: 3.31,
    roe: 8.8,
    equityRatio: 4.8,
    eps: 314.8,
    dps: 120.0,
    sector: "銀行業 (メガバンク)",
    market: "PRIME",
  },
  "8411": {
    price: 3280.0,
    change: 35.0,
    changePercent: 1.08,
    volume: 11800000,
    dayHigh: 3310.0,
    dayLow: 3260.0,
    yearHigh: 3550.0,
    yearLow: 2350.0,
    marketCap: 83000,
    per: 10.8,
    pbr: 0.85,
    dividendYield: 3.65,
    roe: 8.5,
    equityRatio: 4.2,
    eps: 303.7,
    dps: 120.0,
    sector: "銀行業 (メガバンク)",
    market: "PRIME",
  },
  "8766": {
    price: 5780.0,
    change: 65.0,
    changePercent: 1.14,
    volume: 5800000,
    dayHigh: 5830.0,
    dayLow: 5740.0,
    yearHigh: 6300.0,
    yearLow: 4200.0,
    marketCap: 114000,
    per: 13.2,
    pbr: 1.85,
    dividendYield: 2.85,
    roe: 14.5,
    equityRatio: 18.0,
    eps: 437.8,
    dps: 165.0,
    sector: "保険業 (損保)",
    market: "PRIME",
  },
  "8604": {
    price: 885.0,
    change: 9.5,
    changePercent: 1.09,
    volume: 16200000,
    dayHigh: 895.0,
    dayLow: 878.0,
    yearHigh: 1020.0,
    yearLow: 680.0,
    marketCap: 28000,
    per: 11.2,
    pbr: 0.78,
    dividendYield: 3.85,
    roe: 7.2,
    equityRatio: 6.5,
    eps: 79.0,
    dps: 34.0,
    sector: "証券業・投資銀行",
    market: "PRIME",
  },
  "8001": {
    price: 7850.0,
    change: 65.0,
    changePercent: 0.83,
    volume: 5400000,
    dayHigh: 7910.0,
    dayLow: 7800.0,
    yearHigh: 8450.0,
    yearLow: 6200.0,
    marketCap: 119000,
    per: 13.5,
    pbr: 1.75,
    dividendYield: 2.55,
    roe: 13.8,
    equityRatio: 38.0,
    eps: 581.5,
    dps: 200.0,
    sector: "卸売業 (総合商社)",
    market: "PRIME",
  },
  "8031": {
    price: 3380.0,
    change: 28.0,
    changePercent: 0.84,
    volume: 7200000,
    dayHigh: 3410.0,
    dayLow: 3360.0,
    yearHigh: 3850.0,
    yearLow: 2750.0,
    marketCap: 102000,
    per: 11.2,
    pbr: 1.25,
    dividendYield: 3.25,
    roe: 11.8,
    equityRatio: 41.0,
    eps: 301.8,
    dps: 110.0,
    sector: "卸売業 (総合商社)",
    market: "PRIME",
  },
  "8053": {
    price: 3620.0,
    change: 26.0,
    changePercent: 0.72,
    volume: 4900000,
    dayHigh: 3650.0,
    dayLow: 3600.0,
    yearHigh: 4100.0,
    yearLow: 3100.0,
    marketCap: 44000,
    per: 9.8,
    pbr: 0.95,
    dividendYield: 3.59,
    roe: 10.2,
    equityRatio: 36.0,
    eps: 369.4,
    dps: 130.0,
    sector: "卸売業 (総合商社)",
    market: "PRIME",
  },
  "8002": {
    price: 2480.0,
    change: 18.0,
    changePercent: 0.73,
    volume: 6800000,
    dayHigh: 2505.0,
    dayLow: 2465.0,
    yearHigh: 3150.0,
    yearLow: 2150.0,
    marketCap: 41000,
    per: 8.9,
    pbr: 1.12,
    dividendYield: 3.62,
    roe: 13.2,
    equityRatio: 34.0,
    eps: 278.6,
    dps: 90.0,
    sector: "卸売業 (総合商社)",
    market: "PRIME",
  },
  "3382": {
    price: 2450.0,
    change: 15.0,
    changePercent: 0.62,
    volume: 6200000,
    dayHigh: 2480.0,
    dayLow: 2435.0,
    yearHigh: 2650.0,
    yearLow: 1850.0,
    marketCap: 64000,
    per: 28.5,
    pbr: 1.48,
    dividendYield: 1.63,
    roe: 5.8,
    equityRatio: 34.0,
    eps: 86.0,
    dps: 40.0,
    sector: "小売業 (流通)",
    market: "PRIME",
  },
  "4502": {
    price: 4220.0,
    change: 12.0,
    changePercent: 0.29,
    volume: 5500000,
    dayHigh: 4250.0,
    dayLow: 4200.0,
    yearHigh: 4600.0,
    yearLow: 3950.0,
    marketCap: 66000,
    per: 24.5,
    pbr: 0.95,
    dividendYield: 4.64,
    roe: 4.2,
    equityRatio: 46.0,
    eps: 172.2,
    dps: 196.0,
    sector: "医薬品",
    market: "PRIME",
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
    market: "US",
    historicalFinances: [
      { fiscalYear: "2022 FY", revenue: 26914, operatingIncome: 10041, netIncome: 9752, eps: 0.39, dps: 0.16 },
      { fiscalYear: "2023 FY", revenue: 26974, operatingIncome: 4224, netIncome: 4368, eps: 0.18, dps: 0.16 },
      { fiscalYear: "2024 FY", revenue: 60922, operatingIncome: 32972, netIncome: 29760, eps: 1.20, dps: 0.16 },
      { fiscalYear: "2025 FY (予)", revenue: 125000, operatingIncome: 78000, netIncome: 65000, eps: 2.60, dps: 0.20 },
    ],
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
    market: "US",
    historicalFinances: [
      { fiscalYear: "2021 FY", revenue: 365817, operatingIncome: 108949, netIncome: 94680, eps: 5.61, dps: 0.85 },
      { fiscalYear: "2022 FY", revenue: 394328, operatingIncome: 119437, netIncome: 99803, eps: 6.11, dps: 0.91 },
      { fiscalYear: "2023 FY", revenue: 383285, operatingIncome: 114301, netIncome: 96995, eps: 6.13, dps: 0.95 },
      { fiscalYear: "2024 FY", revenue: 391035, operatingIncome: 123216, netIncome: 93736, eps: 6.08, dps: 1.00 },
    ],
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
    market: "US",
    historicalFinances: [
      { fiscalYear: "2022 FY", revenue: 198270, operatingIncome: 83383, netIncome: 72738, eps: 9.65, dps: 2.48 },
      { fiscalYear: "2023 FY", revenue: 211915, operatingIncome: 88523, netIncome: 72361, eps: 9.68, dps: 2.72 },
      { fiscalYear: "2024 FY", revenue: 245120, operatingIncome: 109433, netIncome: 88136, eps: 11.80, dps: 3.00 },
      { fiscalYear: "2025 FY (予)", revenue: 279000, operatingIncome: 126000, netIncome: 101000, eps: 13.50, dps: 3.30 },
    ],
  },
  GOOGL: {
    price: 182.50,
    change: 1.80,
    changePercent: 1.00,
    volume: 22000000,
    dayHigh: 184.20,
    dayLow: 181.50,
    yearHigh: 193.31,
    yearLow: 130.67,
    marketCap: 2250000,
    per: 24.2,
    pbr: 6.85,
    dividendYield: 0.44,
    roe: 31.5,
    equityRatio: 72.0,
    eps: 7.54,
    dps: 0.80,
    sector: "Internet / AI",
    market: "US",
    historicalFinances: [
      { fiscalYear: "2021 FY", revenue: 257637, operatingIncome: 78714, netIncome: 76033, eps: 5.61, dps: 0.0 },
      { fiscalYear: "2022 FY", revenue: 282836, operatingIncome: 74842, netIncome: 59972, eps: 4.56, dps: 0.0 },
      { fiscalYear: "2023 FY", revenue: 307394, operatingIncome: 84293, netIncome: 73795, eps: 5.80, dps: 0.0 },
      { fiscalYear: "2024 FY (予)", revenue: 348000, operatingIncome: 108000, netIncome: 96000, eps: 7.54, dps: 0.80 },
    ],
  },
  AMZN: {
    price: 188.60,
    change: 2.10,
    changePercent: 1.13,
    volume: 38000000,
    dayHigh: 190.50,
    dayLow: 187.20,
    yearHigh: 201.20,
    yearLow: 144.05,
    marketCap: 1980000,
    per: 39.5,
    pbr: 7.80,
    dividendYield: 0.0,
    roe: 21.8,
    equityRatio: 42.0,
    eps: 4.77,
    dps: 0.0,
    sector: "E-Commerce / Cloud",
    market: "US",
    historicalFinances: [
      { fiscalYear: "2021 FY", revenue: 469822, operatingIncome: 24879, netIncome: 33364, eps: 3.24, dps: 0.0 },
      { fiscalYear: "2022 FY", revenue: 513983, operatingIncome: 12248, netIncome: -2722, eps: -0.27, dps: 0.0 },
      { fiscalYear: "2023 FY", revenue: 574785, operatingIncome: 36852, netIncome: 30425, eps: 2.90, dps: 0.0 },
      { fiscalYear: "2024 FY (予)", revenue: 638000, operatingIncome: 62000, netIncome: 50000, eps: 4.77, dps: 0.0 },
    ],
  },
  META: {
    price: 585.40,
    change: 7.20,
    changePercent: 1.25,
    volume: 14000000,
    dayHigh: 590.20,
    dayLow: 581.00,
    yearHigh: 602.95,
    yearLow: 390.00,
    marketCap: 1480000,
    per: 26.8,
    pbr: 8.90,
    dividendYield: 0.34,
    roe: 35.8,
    equityRatio: 70.0,
    eps: 21.84,
    dps: 2.00,
    sector: "Social Media / AI",
    market: "US",
    historicalFinances: [
      { fiscalYear: "2021 FY", revenue: 117929, operatingIncome: 46753, netIncome: 39370, eps: 13.77, dps: 0.0 },
      { fiscalYear: "2022 FY", revenue: 116609, operatingIncome: 28944, netIncome: 23200, eps: 8.59, dps: 0.0 },
      { fiscalYear: "2023 FY", revenue: 134902, operatingIncome: 46751, netIncome: 39098, eps: 14.87, dps: 0.0 },
      { fiscalYear: "2024 FY (予)", revenue: 162000, operatingIncome: 69000, netIncome: 56000, eps: 21.84, dps: 2.00 },
    ],
  },
  TSLA: {
    price: 245.80,
    change: -3.20,
    changePercent: -1.29,
    volume: 65000000,
    dayHigh: 252.00,
    dayLow: 243.50,
    yearHigh: 271.00,
    yearLow: 138.80,
    marketCap: 785000,
    per: 68.5,
    pbr: 11.2,
    dividendYield: 0.0,
    roe: 18.5,
    equityRatio: 64.0,
    eps: 3.59,
    dps: 0.0,
    sector: "EV / Clean Tech",
    market: "US",
    historicalFinances: [
      { fiscalYear: "2021 FY", revenue: 53823, operatingIncome: 6523, netIncome: 5519, eps: 1.87, dps: 0.0 },
      { fiscalYear: "2022 FY", revenue: 81462, operatingIncome: 13656, netIncome: 12583, eps: 4.02, dps: 0.0 },
      { fiscalYear: "2023 FY", revenue: 96773, operatingIncome: 8891, netIncome: 14997, eps: 4.30, dps: 0.0 },
      { fiscalYear: "2024 FY (予)", revenue: 99500, operatingIncome: 8200, netIncome: 11500, eps: 3.59, dps: 0.0 },
    ],
  },
};

/**
 * Check if a ticker corresponds to a stock market index (e.g. ^GSPC, ^N225).
 */
export function isIndexAsset(ticker: string): boolean {
  if (!ticker) return false;
  const t = ticker.trim().toUpperCase();
  if (t.startsWith("^") || t.startsWith("INDEX:")) return true;
  return DEFAULT_MARKET_OVERVIEW.indices.some((idx) => idx.symbol.toUpperCase() === t);
}

/**
 * Check if a ticker corresponds to a macro/benchmark asset (Index, FX, Commodity, Crypto).
 */
export function isMacroAsset(ticker: string): boolean {
  if (!ticker) return false;
  const t = ticker.trim().toUpperCase();
  if (isIndexAsset(t)) return true;
  if (t.includes("=X") || t.startsWith("FX:") || t.startsWith("FX_IDC:")) return true;
  if (t.endsWith("-USD") || t.endsWith("USDT")) return true;
  const allAssets = [
    ...DEFAULT_MARKET_OVERVIEW.indices,
    ...DEFAULT_MARKET_OVERVIEW.forex,
    ...DEFAULT_MARKET_OVERVIEW.commodities,
    ...DEFAULT_MARKET_OVERVIEW.crypto,
  ];
  return allAssets.some((a) => a.symbol.toUpperCase() === t);
}

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

  const isIndex = isIndexAsset(normTicker) || overviewAsset?.category === "INDEX";
  const isFx = normTicker.includes("=X") || overviewAsset?.category === "FX";
  const isCrypto = normTicker.endsWith("-USD") || overviewAsset?.category === "CRYPTO";
  const isMacro = Boolean(
    isIndex ||
    isFx ||
    isCrypto ||
    overviewAsset?.category === "COMMODITY" ||
    overviewAsset?.category === "BOND",
  );

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
      : isIndex
        ? "株価指数"
        : isFx
          ? "為替"
          : isCrypto
            ? "暗号資産"
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

  const per = isMacro
    ? null
    : anchor
      ? anchor.per
      : isUS
        ? 22 + (seed % 35)
        : 12 + (seed % 20);
  const pbr = isMacro
    ? null
    : anchor
      ? anchor.pbr
      : Number((0.8 + (seed % 35) / 10).toFixed(2));
  const dividendYield = isMacro
    ? null
    : anchor
      ? anchor.dividendYield
      : Number((1.5 + (seed % 30) / 10).toFixed(2));
  const roe = isMacro ? null : anchor ? anchor.roe : Number((8 + (seed % 14)).toFixed(1));
  const equityRatio = isMacro ? null : anchor ? anchor.equityRatio : 40 + (seed % 45);
  const marketCap = isMacro
    ? 0
    : anchor
      ? anchor.marketCap
      : isUS
        ? 45000 + seed * 850
        : 12000 + seed * 280;

  const eps = isMacro
    ? null
    : anchor
      ? anchor.eps
      : per
        ? Number((basePrice / per).toFixed(1))
        : null;
  const dps = isMacro
    ? null
    : anchor
      ? anchor.dps
      : dividendYield
        ? Number(((basePrice * dividendYield) / 100).toFixed(1))
        : null;
  const sector = overviewAsset
    ? overviewAsset.category
    : isIndex
      ? "INDEX"
      : isFx
        ? "FX"
        : isCrypto
          ? "CRYPTO"
          : (anchor?.sector ?? (isUS ? "Information Tech" : "電気機器・精密"));


  // 4 years historical financial performance
  const currentYear = new Date().getFullYear();
  const safeEps = eps ?? 0;
  const safeDps = dps ?? 0;
  const historicalFinances = isMacro
    ? []
    : [
        {
          fiscalYear: isUS ? `${currentYear - 3} FY` : `${currentYear - 3}/3`,
          revenue: Math.round(marketCap * 0.72),
          operatingIncome: Math.round(marketCap * 0.08),
          netIncome: Math.round(marketCap * 0.055),
          eps: Math.round(safeEps * 0.75),
          dps: Math.round(safeDps * 0.8),
        },
        {
          fiscalYear: isUS ? `${currentYear - 2} FY` : `${currentYear - 2}/3`,
          revenue: Math.round(marketCap * 0.81),
          operatingIncome: Math.round(marketCap * 0.095),
          netIncome: Math.round(marketCap * 0.065),
          eps: Math.round(safeEps * 0.88),
          dps: Math.round(safeDps * 0.9),
        },
        {
          fiscalYear: isUS ? `${currentYear - 1} FY` : `${currentYear - 1}/3`,
          revenue: Math.round(marketCap * 0.92),
          operatingIncome: Math.round(marketCap * 0.11),
          netIncome: Math.round(marketCap * 0.078),
          eps: Math.round(safeEps * 0.96),
          dps: Math.round(safeDps * 0.95),
        },
        {
          fiscalYear: isUS ? `${currentYear} FY (予)` : `${currentYear}/3 (予)`,
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

  const finalFinances = overviewAsset
    ? []
    : anchor?.historicalFinances && anchor.historicalFinances.length > 0
      ? anchor.historicalFinances
      : historicalFinances;
  const finalSparkline = overviewAsset?.sparkline ?? sparkline;
  const computedTechSignal = evaluateTechnicalSignal(changePct, finalSparkline, basePrice).signal;
  return {
    ticker: normTicker,
    name,
    theme,
    sector,
    market: anchor?.market ?? (isUS ? "US" : "PRIME"),
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
    technicalSignal: computedTechSignal,
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

let overviewEndpointConfirmedMissing = false;
let overviewEndpointMissingUntil = 0;

/** Test hook: re-arm the endpoint probe between assertions. */
export function resetMarketOverviewEndpointProbe(): void {
  overviewEndpointConfirmedMissing = false;
  overviewEndpointMissingUntil = 0;
}

// Fetch Market Overview Data (with API fallback and forceRefresh support)
export async function fetchMarketOverview(forceRefresh = false): Promise<MarketOverviewData> {
  const isBrowser = typeof globalThis !== "undefined" && "window" in globalThis;
  if (forceRefresh) {
    overviewEndpointConfirmedMissing = false;
    overviewEndpointMissingUntil = 0;
  }
  const now = Date.now();
  const isCooldown = now < overviewEndpointMissingUntil;
  if (isBrowser && (!overviewEndpointConfirmedMissing || !isCooldown || forceRefresh)) {
    try {
      const res = await fetch("/api/market/overview", {
        headers: { accept: "application/json" },
        cache: forceRefresh ? "no-cache" : "default",
      });
      if (res.status === 404) {
        overviewEndpointConfirmedMissing = true;
        overviewEndpointMissingUntil = now + 30000;
        return withFallbackMetadata(DEFAULT_MARKET_OVERVIEW);
      }
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        // The SPA fallback answers *.html paths with index.html; anything
        // that is not JSON means the route does not exist.
        if (!contentType.includes("json")) {
          overviewEndpointConfirmedMissing = true;
          overviewEndpointMissingUntil = now + 30000;
          return withFallbackMetadata(DEFAULT_MARKET_OVERVIEW);
        }
        const normalized = normalizeMarketOverview(await res.json());
        if (normalized) {
          overviewEndpointConfirmedMissing = false;
          overviewEndpointMissingUntil = 0;
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
  removeItem?(key: string): void;
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

const CALENDAR_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL

function saveCalendarCache(events: CalendarEvent[]): void {
  try {
    const storage = getSessionStorageSafe();
    if (storage) {
      const payload = {
        timestamp: Date.now(),
        events,
      };
      storage.setItem(CALENDAR_CACHE_KEY, JSON.stringify(payload));
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
        let eventsArray: unknown = parsed;
        if (
          parsed &&
          typeof parsed === "object" &&
          "timestamp" in parsed &&
          Array.isArray((parsed as { events?: unknown }).events)
        ) {
          const age = Date.now() - (parsed as { timestamp: number }).timestamp;
          if (age > CALENDAR_CACHE_TTL_MS) {
            storage.removeItem?.(CALENDAR_CACHE_KEY);
            return null;
          }
          eventsArray = (parsed as { events: unknown }).events;
        }
        if (Array.isArray(eventsArray)) {
          const valid = eventsArray.filter(isValidCalendarEvent);
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

  // マクロ: 日銀会合 (公定日程スケジュールマスターから直近次回・次々回を特定)
  const nextBoj =
    getNextScheduledMeetings(BOJ_MEETING_SCHEDULE, referenceDate, 1)[0] ||
    adjustToWeekday(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 24));
  events.push({
    id: "macro-boj",
    date: fmt(nextBoj),
    fullDate: fmtFull(nextBoj),
    type: "MACRO",
    title: "日銀金融政策決定会合・総裁記者会見",
    importance: "HIGH",
    time: "15:30 JST",
    market: "TSE",
    previous: MACRO_METRICS_DEFAULTS.boj.previous,
    forecast: MACRO_METRICS_DEFAULTS.boj.forecast,
    description: MACRO_METRICS_DEFAULTS.boj.description,
    source: "fallback",
  });

  // マクロ: 米FOMC (公定日程スケジュールマスターから直近次回・次々回を特定)
  const nextFomc =
    getNextScheduledMeetings(FOMC_MEETING_SCHEDULE, referenceDate, 1)[0] ||
    adjustToWeekday(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 28));
  events.push({
    id: "macro-fomc",
    date: fmt(nextFomc),
    fullDate: fmtFull(nextFomc),
    type: "MACRO",
    title: "米FOMC 政策金利発表 & パウエル議長記者会見",
    importance: "HIGH",
    time: "03:00 JST",
    market: "US",
    previous: MACRO_METRICS_DEFAULTS.fomc.previous,
    forecast: MACRO_METRICS_DEFAULTS.fomc.forecast,
    description: MACRO_METRICS_DEFAULTS.fomc.description,
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
    time: "21:30 JST",
    market: "US",
    previous: MACRO_METRICS_DEFAULTS.jobs.previous,
    forecast: MACRO_METRICS_DEFAULTS.jobs.forecast,
    description: MACRO_METRICS_DEFAULTS.jobs.description,
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
    time: "21:30 JST",
    market: "US",
    previous: MACRO_METRICS_DEFAULTS.cpi.previous,
    forecast: MACRO_METRICS_DEFAULTS.cpi.forecast,
    description: MACRO_METRICS_DEFAULTS.cpi.description,
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
      market: corp.ticker === "AAPL" || corp.ticker === "NVDA" ? "US" : "TSE",
      time: corp.ticker === "AAPL" || corp.ticker === "NVDA" ? "06:30 JST (米引け後)" : "15:00 JST (東証引け後)",
      description: `${corp.companyName} (${corp.ticker}) の四半期業績および通期見通し発表。`,
      source: "fallback",
    });
  }

  // 追加マクロ指標: 日本全国CPI (毎月19日を含む週の金曜日・公定基準)
  const jpCpiDate = (() => {
    for (let offset = 0; offset <= 2; offset++) {
      const y = referenceDate.getFullYear();
      const m = referenceDate.getMonth() + offset;
      for (let day = 19; day <= 25; day++) {
        const d = new Date(y, m, day);
        if (d.getDay() === 5) {
          if (d.getTime() >= referenceDate.getTime() - 24 * 60 * 60 * 1000) {
            return d;
          }
        }
      }
    }
    return adjustToWeekday(addBusinessDays(referenceDate, 8));
  })();

  events.push({
    id: "macro-jp-cpi",
    date: fmt(jpCpiDate),
    fullDate: fmtFull(jpCpiDate),
    type: "MACRO",
    title: "日本 全国消費者物価指数 (全国CPI)",
    importance: "HIGH",
    time: "08:30 JST",
    market: "TSE",
    previous: "2.8%",
    forecast: "2.7%",
    description: "総務省発表。生鮮食品を除くコアCPI前年同月比。日銀追加利上げ判断の最重要物価指標。",
    source: "fallback",
  });

  // 四半期実質GDP1次速報 (2, 5, 8, 11月中旬・内閣府公約基準)
  const jpGdpDate = (() => {
    const gdpMonths = [1, 4, 7, 10]; // Feb, May, Aug, Nov
    for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
      const y = referenceDate.getFullYear() + yearOffset;
      for (const m of gdpMonths) {
        const target = adjustToWeekday(new Date(y, m, 15));
        if (target.getTime() >= referenceDate.getTime() - 24 * 60 * 60 * 1000) {
          return target;
        }
      }
    }
    return adjustToWeekday(addBusinessDays(referenceDate, 14));
  })();

  events.push({
    id: "macro-jp-gdp",
    date: fmt(jpGdpDate),
    fullDate: fmtFull(jpGdpDate),
    type: "MACRO",
    title: "日本 四半期実質GDP成長率 (1次速報)",
    importance: "HIGH",
    time: "08:50 JST",
    market: "TSE",
    previous: "+0.5%",
    forecast: "+0.3%",
    description: "内閣府発表。実質国内総生産（前期比・年率換算）。国内個人消費および設備投資の景気動向。",
    source: "fallback",
  });

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
    const parts = (e.date || "").split("/");
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    if (isNaN(m) || isNaN(d)) {
      return 0;
    }
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

/**
 * 業種・セクター別平均PERベンチマークテーブル (東証および主要市場基準)
 */
export const SECTOR_AVERAGE_PER: Record<string, number> = {
  "半導体": 32.5,
  "半導体製造装置": 32.5,
  "半導体検査": 30.0,
  "電気機器": 24.2,
  "IT": 28.0,
  "情報・通信": 22.0,
  "情報・通信業": 22.0,
  "モビリティ": 9.5,
  "自動車": 9.5,
  "輸送用機器": 9.5,
  "銀行": 10.2,
  "銀行業": 10.2,
  "メガバンク": 10.2,
  "金融": 11.5,
  "総合商社": 11.0,
  "卸売業": 11.0,
  "小売": 24.0,
  "小売業": 24.0,
  "医薬": 23.5,
  "製薬": 23.5,
  "化学": 15.0,
  "素材": 13.5,
  "ゲーム": 25.0,
  "防衛": 21.0,
  "FA・センサー": 35.0,
  "精密機器": 26.0,
};

export function getSectorAveragePer(sectorOrTheme?: string): number {
  if (!sectorOrTheme) return 15.0;
  for (const [key, val] of Object.entries(SECTOR_AVERAGE_PER)) {
    if (sectorOrTheme.includes(key)) return val;
  }
  return 15.0;
}

/**
 * テクニカルシグナル判定エンジン (移動平均・モメンタム複合)
 */
export function evaluateTechnicalSignal(
  changePct: number,
  sparkline?: number[],
  price?: number,
): { signal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL"; reason: string } {
  if (sparkline && sparkline.length >= 3 && price && Number.isFinite(price)) {
    const shortSMA = sparkline.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const fullSMA = sparkline.reduce((a, b) => a + b, 0) / sparkline.length;
    if (price > shortSMA && shortSMA > fullSMA && changePct > 0.5) {
      return { signal: "STRONG_BUY", reason: "短期・中期移動平均線ゴールデンクロス & 上昇トレンド" };
    }
    if (price > shortSMA && changePct >= 0) {
      return { signal: "BUY", reason: "短期移動平均線上抜け & 堅調推移" };
    }
    if (price < shortSMA && shortSMA < fullSMA && changePct < -0.5) {
      return { signal: "STRONG_SELL", reason: "移動平均線デッドクロス & 下落トレンド" };
    }
    if (price < shortSMA && changePct < 0) {
      return { signal: "SELL", reason: "短期移動平均線下抜け & 軟調推移" };
    }
  }
  if (changePct >= 2.0) return { signal: "STRONG_BUY", reason: "急反発モメンタム (+2%以上)" };
  if (changePct > 0.3) return { signal: "BUY", reason: "堅調モメンタム推移" };
  if (changePct > -0.8) return { signal: "NEUTRAL", reason: "レンジもみ合い推移" };
  if (changePct > -2.0) return { signal: "SELL", reason: "利益確定売り先行" };
  return { signal: "STRONG_SELL", reason: "大幅下落モメンタム (-2%超)" };
}

/**
 * RFC 5545 §3.3.11 TEXT エスケープ
 * バックスラッシュ、セミコロン、カンマ、改行を正しくエスケープします。
 */
export function escapeIcsText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * カレンダーイベント一覧を iCalendar (RFC 5545, .ics) 形式にエクスポート
 */
export function exportCalendarToIcs(events: CalendarEvent[]): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const dtStamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//IndexForge//Financial Calendar//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:IndexForge 決算・経済指標カレンダー",
    "X-WR-TIMEZONE:Asia/Tokyo",
  ];

  for (const evt of events) {
    let dateStr = "";
    if (evt.fullDate && /^\d{4}-\d{2}-\d{2}$/.test(evt.fullDate)) {
      dateStr = evt.fullDate.replace(/-/g, "");
    } else {
      const parts = evt.date.split("/");
      if (parts.length === 2) {
        const mNum = parseInt(parts[0], 10);
        const dNum = parseInt(parts[1], 10);
        if (!Number.isNaN(mNum) && !Number.isNaN(dNum)) {
          let y = now.getFullYear();
          const currentMonth = now.getMonth() + 1;
          if (mNum < currentMonth && currentMonth - mNum >= 6) {
            y += 1;
          } else if (mNum > currentMonth && mNum - currentMonth >= 6) {
            y -= 1;
          }
          const m = pad(mNum);
          const d = pad(dNum);
          dateStr = `${y}${m}${d}`;
        }
      }
    }
    if (!dateStr || dateStr.length !== 8) continue;

    const y = parseInt(dateStr.slice(0, 4), 10);
    const m = parseInt(dateStr.slice(4, 6), 10) - 1;
    const d = parseInt(dateStr.slice(6, 8), 10);
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) continue;
    const nextDay = new Date(Date.UTC(y, m, d + 1));
    if (Number.isNaN(nextDay.getTime())) continue;
    const nextDayStr = `${nextDay.getUTCFullYear()}${pad(nextDay.getUTCMonth() + 1)}${pad(nextDay.getUTCDate())}`;

    const descParts: string[] = [];
    if (evt.time) descParts.push(`【発表時刻】${evt.time}`);
    if (evt.importance) descParts.push(`【重要度】${evt.importance}`);
    if (evt.market) descParts.push(`【市場】${evt.market === "US" ? "米国" : "国内東証"}`);
    if (evt.forecast) descParts.push(`【市場予想】${evt.forecast}`);
    if (evt.previous) descParts.push(`【前回値】${evt.previous}`);
    if (evt.actual) descParts.push(`【発表結果】${evt.actual}`);
    if (evt.description) descParts.push(evt.description);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${evt.id}-${dateStr}@indexforge.internal`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dateStr}`);
    lines.push(`DTEND;VALUE=DATE:${nextDayStr}`);
    lines.push(`SUMMARY:${escapeIcsText(evt.title)}`);
    if (descParts.length > 0) {
      lines.push(`DESCRIPTION:${escapeIcsText(descParts.join("\n"))}`);
    }
    lines.push("CLASS:PUBLIC");
    lines.push("STATUS:CONFIRMED");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/**
 * カレンダーイベント一覧を CSV 形式にエクスポート (Excel対応 UTF-8 BOM付き)
 */
export function exportCalendarToCsv(events: CalendarEvent[]): string {
  const headers = [
    "日付",
    "完全日付",
    "種別",
    "イベント名",
    "ティッカー",
    "企業名",
    "重要度",
    "発表時刻",
    "市場",
    "前回値",
    "市場予想",
    "発表結果",
    "出所",
    "詳細",
  ];

  const rows = events.map((e) => [
    escapeCsvCell(e.date),
    escapeCsvCell(e.fullDate || ""),
    escapeCsvCell(e.type === "MACRO" ? "経済指標" : "企業決算"),
    escapeCsvCell(e.title),
    escapeCsvCell(e.ticker || ""),
    escapeCsvCell(e.companyName || ""),
    escapeCsvCell(e.importance),
    escapeCsvCell(e.time || ""),
    escapeCsvCell(e.market === "US" ? "米国" : "国内東証"),
    escapeCsvCell(e.previous || ""),
    escapeCsvCell(e.forecast || ""),
    escapeCsvCell(e.actual || ""),
    escapeCsvCell(e.source === "fallback" ? "参考値(推計)" : "実データ"),
    escapeCsvCell(e.description || ""),
  ]);

  return "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}
