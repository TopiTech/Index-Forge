export type PricePoint = {
  date: string;
  close: number;
  value?: number; // 独自指数の計算結果用
};

export type StockSeries = {
  ticker: string;
  name: string;
  theme: string;
  sector: string;
  latestPrice: number;
  series: PricePoint[];
};

export type BasketItem = {
  ticker: string;
  name: string;
  theme: string;
  weight: number;
};

export type StockDetail = {
  ticker: string;
  name: string;
  theme: string;
  weight: number;
  currentPrice: number;
  previousPrice: number;
  change: number;
  changePct: number;
  contributionPt: number;
  contributionPct: number;
  sparkline: number[];
};

export type Snapshot = {
  label: string;
  current: number;
  change: number;
  changePct: number;
  updatedAt: string;
  description: string;
  symbol?: string;
};

export type Timeframe = "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y";

export type BenchmarkSymbol = "^N225" | "^GSPC" | "USDJPY=X" | "BTC-USD";

export interface BenchmarkOption {
  symbol: BenchmarkSymbol;
  label: string;
  shortLabel: string;
  currency: string;
}

export interface RiskMetrics {
  annualReturn: number;
  annualVolatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  /** Null when the benchmark has insufficient/constant data to estimate beta. */
  beta: number | null;
  winRate: number;
  bestDay: number;
  worstDay: number;
}

export type AuthRole = "admin" | "user";

export interface AuthSession {
  role: AuthRole;
  name: string;
  password?: string;
  maxStocks: number | null;
  maxIndices?: number | null;
  id?: string;
}

export interface UserPasswordItem {
  id: string;
  name: string;
  role: AuthRole;
  max_stocks: number | null;
  max_indices?: number | null;
  is_active: number;
  created_at: number;
  updated_at?: number;
}

export type ThemeMode = "dark" | "light";
export type AccentColor = "cyan" | "emerald" | "violet" | "amber" | "rose";
