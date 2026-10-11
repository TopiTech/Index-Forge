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
  sparkline?: number[];
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

// Default Global Market Quotes Baseline (Updated with actual market values)
export const DEFAULT_MARKET_OVERVIEW: MarketOverviewData = {
  indices: [
    {
      symbol: "^N225",
      name: "日経平均株価",
      category: "INDEX",
      price: 69030.92,
      change: -11.19,
      changePercent: -0.02,
      currency: "JPY",
      sparkline: [68980, 69010, 69025, 69045, 69039, 69030.92],
      updatedAt: "15:00 JST",
    },
    {
      symbol: "^TOPX",
      name: "TOPIX (東証株価指数)",
      category: "INDEX",
      price: 4138.50,
      change: 33.50,
      changePercent: 0.82,
      currency: "JPY",
      sparkline: [4105, 4112, 4120, 4128, 4135, 4138.5],
      updatedAt: "15:00 JST",
    },
    {
      symbol: "^TOPIXG",
      name: "東証グロース250",
      category: "INDEX",
      price: 639.00,
      change: 7.10,
      changePercent: 1.12,
      currency: "JPY",
      sparkline: [632, 634, 636, 638, 640, 639],
      updatedAt: "15:00 JST",
    },
    {
      symbol: "^GSPC",
      name: "S&P 500",
      category: "INDEX",
      price: 7811.54,
      change: 46.18,
      changePercent: 0.59,
      currency: "USD",
      sparkline: [7765, 7780, 7795, 7805, 7812, 7811.54],
      updatedAt: "05:00 JST",
    },
    {
      symbol: "^IXIC",
      name: "NASDAQ 総合",
      category: "INDEX",
      price: 27366.17,
      change: 172.83,
      changePercent: 0.64,
      currency: "USD",
      sparkline: [27190, 27240, 27280, 27340, 27360, 27366.17],
      updatedAt: "05:00 JST",
    },
    {
      symbol: "^DJI",
      name: "NYダウ平均",
      category: "INDEX",
      price: 51654.95,
      change: 423.31,
      changePercent: 0.83,
      currency: "USD",
      sparkline: [51230, 51350, 51480, 51580, 51640, 51654.95],
      updatedAt: "05:00 JST",
    },
  ],
  forex: [
    {
      symbol: "USDJPY=X",
      name: "米ドル / 円",
      category: "FX",
      price: 158.25,
      change: 0.45,
      changePercent: 0.29,
      currency: "JPY",
      sparkline: [157.8, 157.95, 158.1, 158.2, 158.24, 158.25],
      updatedAt: "リアルタイム",
    },
    {
      symbol: "EURJPY=X",
      name: "ユーロ / 円",
      category: "FX",
      price: 177.10,
      change: 0.28,
      changePercent: 0.16,
      currency: "JPY",
      sparkline: [176.8, 176.9, 177.0, 177.05, 177.08, 177.1],
      updatedAt: "リアルタイム",
    },
    {
      symbol: "EURUSD=X",
      name: "ユーロ / ドル",
      category: "FX",
      price: 1.1206,
      change: -0.0010,
      changePercent: -0.09,
      currency: "USD",
      sparkline: [1.1215, 1.1212, 1.121, 1.1208, 1.1207, 1.1206],
      updatedAt: "リアルタイム",
    },
  ],
  commodities: [
    {
      symbol: "CL=F",
      name: "WTI 原油先物",
      category: "COMMODITY",
      price: 91.85,
      change: 0.36,
      changePercent: 0.39,
      currency: "USD",
      sparkline: [91.2, 91.4, 91.6, 91.75, 91.8, 91.85],
      updatedAt: "リアルタイム",
    },
    {
      symbol: "GC=F",
      name: "金先物 (Gold)",
      category: "COMMODITY",
      price: 4216.30,
      change: 59.30,
      changePercent: 1.43,
      currency: "USD",
      sparkline: [4155, 4170, 4185, 4200, 4210, 4216.3],
      updatedAt: "リアルタイム",
    },
    {
      symbol: "^TNX",
      name: "米国10年債利回り",
      category: "BOND",
      price: 5.244,
      change: 0.013,
      changePercent: 0.25,
      currency: "%",
      sparkline: [5.23, 5.235, 5.24, 5.242, 5.244],
      updatedAt: "リアルタイム",
    },
  ],
  crypto: [
    {
      symbol: "BTC-USD",
      name: "ビットコイン (BTC)",
      category: "CRYPTO",
      price: 82945.58,
      change: 168.89,
      changePercent: 0.20,
      currency: "USD",
      sparkline: [82600, 82750, 82820, 82900, 82930, 82945.58],
      updatedAt: "24h リアルタイム",
    },
    {
      symbol: "ETH-USD",
      name: "イーサリアム (ETH)",
      category: "CRYPTO",
      price: 2499.26,
      change: 4.90,
      changePercent: 0.20,
      currency: "USD",
      sparkline: [2485, 2490, 2492, 2496, 2498, 2499.26],
      updatedAt: "24h リアルタイム",
    },
  ],
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
  "NVDA": {
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
  "AAPL": {
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
  "MSFT": {
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

  const name = matchedPreset ? matchedPreset.name : `銘柄 ${normTicker}`;
  const theme = matchedPreset ? matchedPreset.theme : "株式";
  const isUS = !/^\d/.test(normTicker);

  const anchor = KNOWN_STOCK_ANCHORS[normTicker];

  // Seed fallback for tickers without explicit anchor
  const seed = normTicker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const basePrice = anchor ? anchor.price : isUS ? 120 + (seed % 350) : 1800 + (seed % 6500);
  const changePct = anchor ? anchor.changePercent : Number((((seed % 60) - 28) / 10).toFixed(2));
  const change = anchor ? anchor.change : Number(((basePrice * changePct) / 100).toFixed(2));
  const prevClose = Number((basePrice - change).toFixed(2));

  const per = anchor ? anchor.per : isUS ? 22 + (seed % 35) : 12 + (seed % 20);
  const pbr = anchor ? anchor.pbr : Number((0.8 + ((seed % 35) / 10)).toFixed(2));
  const dividendYield = anchor ? anchor.dividendYield : Number((1.5 + ((seed % 30) / 10)).toFixed(2));
  const roe = anchor ? anchor.roe : Number((8 + (seed % 14)).toFixed(1));
  const equityRatio = anchor ? anchor.equityRatio : 40 + (seed % 45);
  const marketCap = anchor ? anchor.marketCap : isUS ? 45000 + (seed * 850) : 12000 + (seed * 280);

  const eps = anchor ? anchor.eps : Number((basePrice / per).toFixed(1));
  const dps = anchor ? anchor.dps : Number(((basePrice * dividendYield) / 100).toFixed(1));
  const sector = anchor?.sector ?? (isUS ? "Information Tech" : "電気機器・精密");

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

  const s1 = Number((prevClose * (1 - ((seed % 15) - 7) / 200)).toFixed(2));
  const s2 = Number((prevClose * (1 - ((seed % 19) - 9) / 200)).toFixed(2));
  const s3 = Number((prevClose * (1 - ((seed % 11) - 5) / 200)).toFixed(2));
  const sparkline = [s1, s2, s3, prevClose, basePrice];

  return {
    ticker: normTicker,
    name,
    theme,
    sector,
    market: isUS ? "US" : "PRIME",
    price: basePrice,
    change,
    changePercent: changePct,
    volume: anchor ? anchor.volume : 1250000 + (seed * 8500),
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
    sparkline,
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

/** Cache for stock fundamentals fetched from the backend API. */
const stockFundamentalsClientCache = new Map<string, StockQuoteFundamentals>();

export function clearStockFundamentalsClientCache(): void {
  stockFundamentalsClientCache.clear();
}

/**
 * Fetch real stock quote & fundamentals from /api/stock/fundamentals,
 * falling back to getStockFundamentals(ticker) if unavailable or offline.
 */
export async function fetchStockFundamentals(ticker: string): Promise<StockQuoteFundamentals> {
  const normTicker = ticker.trim().toUpperCase();
  if (!normTicker) return getStockFundamentals(ticker);

  const cached = stockFundamentalsClientCache.get(normTicker);
  if (cached) return cached;

  const isBrowser = typeof globalThis !== "undefined" && "window" in globalThis;
  if (isBrowser) {
    try {
      const res = await fetch(`/api/stock/fundamentals?ticker=${encodeURIComponent(normTicker)}`, {
        headers: { accept: "application/json" },
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
    if (market !== "ALL" && stock.market !== market) {
      return false;
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
    return sortOrder === "asc" ? (numA > numB ? 1 : -1) : (numA < numB ? 1 : -1);
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
