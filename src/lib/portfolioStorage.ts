/**
 * Portfolio & Watchlist Storage Engine
 * 実保有株式の損益計算、アセットアロケーション、およびオリジナル指数化連携
 */

import { getStockFundamentals } from "./marketDataService";
import { getStockCurrency } from "./currency";
import { allocateIntegerWeights } from "./weights";
import { DEFAULT_USD_JPY_RATE } from "../data/marketConstants";
import type { BasketItem } from "../types";

export interface PortfolioPosition {
  id: string;
  ticker: string;
  name: string;
  shares: number; // 保有株数
  averageCost: number; // 取得単価
  currentPrice?: number;
  acquiredAt?: string;
  notes?: string;
}

/**
 * 取得日として記録する当日の暦日 (YYYY-MM-DD, JST)。
 * `new Date().toISOString().split("T")[0]` は UTC 暦日を返すため、
 * JST の早朝 (00:00-08:59) に追加したポジションが前日付で記録される。
 */
export function todayJstDateString(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export interface PositionCalculation extends PortfolioPosition {
  currentPrice: number;
  marketValue: number; // 評価額
  totalCost: number; // 取得総額
  unrealizedProfit: number; // 含み損益 (円)
  unrealizedProfitPercent: number; // 含み損益率 (%)
  dailyChange: number; // 前日比損益
  weightPercent: number; // ポートフォリオ内構成比率 (%)
  annualDividend: number; // 年間予想配当金
  currency?: string;
  fxRate?: number;
  marketValueJpy?: number;
  totalCostJpy?: number;
  dailyChangeJpy?: number;
  annualDividendJpy?: number;
  theme: string;
  sector: string;
  isDemoData?: boolean;
}

export interface PortfolioSummary {
  totalMarketValue: number; // 総評価額
  totalCost: number; // 総取得額
  totalProfit: number; // トータル含み損益
  totalProfitPercent: number; // トータル損益率 (%)
  dailyTotalChange: number; // 本日前日比損益
  totalAnnualDividend: number; // 年間配当金合計
  dividendYield: number; // ポートフォリオ配当利回り (%)
  positions: PositionCalculation[];
}

const STORAGE_KEY_PORTFOLIO = "indexforge_user_portfolio_positions";
const STORAGE_KEY_WATCHLIST = "indexforge_user_watchlist";

// Default preset positions for first-time user preview
const DEFAULT_PRESET_POSITIONS: PortfolioPosition[] = [
  {
    id: "pos-1",
    ticker: "7203",
    name: "トヨタ自動車",
    shares: 200,
    averageCost: 2450,
  },
  {
    id: "pos-2",
    ticker: "8035",
    name: "東京エレクトロン",
    shares: 50,
    averageCost: 23800,
  },
  {
    id: "pos-3",
    ticker: "8306",
    name: "三菱UFJ FG",
    shares: 500,
    averageCost: 1250,
  },
  {
    id: "pos-4",
    ticker: "8058",
    name: "三菱商事",
    shares: 300,
    averageCost: 2680,
  },
];

const DEFAULT_PRESET_WATCHLIST: string[] = ["6857", "6920", "9984", "NVDA", "AAPL"];

function getLocalStorage(): Storage | undefined {
  if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return undefined;
}

/**
 * Validates one stored position. localStorage content can be stale or
 * hand-edited, and an unvalidated array reaches `.shares`/`.averageCost`
 * arithmetic in the summary, so malformed entries are dropped here instead
 * of crashing the portfolio page.
 */
function sanitizePosition(raw: unknown): PortfolioPosition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const ticker = typeof record.ticker === "string" ? record.ticker.trim() : "";
  if (!ticker) return null;

  const shares = Number(record.shares);
  const averageCost = Number(record.averageCost);
  if (!Number.isFinite(shares) || shares <= 0) return null;
  if (!Number.isFinite(averageCost) || averageCost <= 0) return null;

  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : `pos-${ticker}-${shares}`;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : ticker;

  const position: PortfolioPosition = { id, ticker, name, shares, averageCost };
  if (typeof record.acquiredAt === "string" && record.acquiredAt) {
    position.acquiredAt = record.acquiredAt;
  }
  if (typeof record.notes === "string" && record.notes) {
    position.notes = record.notes;
  }
  return position;
}

/** Normalizes a raw watchlist array to unique, non-empty ticker strings. */
export function sanitizeWatchlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const ticker = entry.trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    result.push(ticker);
  }
  return result;
}

/**
 * True when the user has a persisted portfolio. The preset list returned by
 * loadPortfolioPositions() is a first-visit preview; callers must not write it
 * back to storage before the user actually edits the list, or the preview
 * silently becomes real (fake holdings in P&L, weights and index conversion).
 */
export function hasPersistedPortfolio(): boolean {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEY_PORTFOLIO) !== null;
  } catch {
    return false;
  }
}

/** Same as hasPersistedPortfolio, for the watchlist key. */
export function hasPersistedWatchlist(): boolean {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEY_WATCHLIST) !== null;
  } catch {
    return false;
  }
}

// Load positions from localStorage
export function loadPortfolioPositions(): PortfolioPosition[] {
  const storage = getLocalStorage();
  if (!storage) return DEFAULT_PRESET_POSITIONS;
  try {
    const raw = storage.getItem(STORAGE_KEY_PORTFOLIO);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // An explicit empty list is an intended user action (cleared positions).
        if (parsed.length === 0) return [];

        const positions = parsed
          .map(sanitizePosition)
          .filter((position): position is PortfolioPosition => position !== null);
        // A fully corrupt non-empty list falls back to presets.
        if (positions.length > 0) return positions;
      }
    }
  } catch {
    // Ignore storage parse error
  }
  return DEFAULT_PRESET_POSITIONS;
}

/**
 * 直近の保存失敗を自動保存 effect へ渡すためのモジュール内フラグ。
 * 保存ヘルパーは boolean を返すが、PortfolioManagerPage の自動保存 effect は
 * 既存の文言テストにより `savePortfolioPositions(positions);` という生の呼び出しを
 * if ブロック先頭に置く必要があるため、直後の consumeSaveFailure() で成否を受け取る。
 * 各 save 関数は成功時に必ず false へ戻すので、consume は直前の自分の保存結果だけを観測する。
 */
let lastSaveFailed = false;

/** 直近の保存失敗フラグを取得してクリアする。save 直後に必ず呼ぶこと。 */
export function consumeSaveFailure(): boolean {
  const failed = lastSaveFailed;
  lastSaveFailed = false;
  return failed;
}

// Save positions to localStorage
export function savePortfolioPositions(positions: PortfolioPosition[]): boolean {
  const storage = getLocalStorage();
  if (!storage) {
    lastSaveFailed = true;
    return false;
  }
  try {
    storage.setItem(STORAGE_KEY_PORTFOLIO, JSON.stringify(positions));
    lastSaveFailed = false;
    return true;
  } catch {
    lastSaveFailed = true;
    return false;
  }
}

/**
 * Reads only what the user has actually persisted, with no preset fallback.
 * Used by the write paths: `loadPortfolioPositions()` returns the demo preset
 * list when nothing is stored yet, and persisting that list on the first
 * addition would silently inject holdings the user never entered (they would
 * then appear in P&L, weights and the portfolio→index conversion).
 */
function loadPersistedPositions(): PortfolioPosition[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY_PORTFOLIO);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map(sanitizePosition)
          .filter((position): position is PortfolioPosition => position !== null);
      }
    }
  } catch {
    // Ignore storage parse error
  }
  return [];
}

/** Same as loadPersistedPositions, for the watchlist key. */
function loadPersistedWatchlist(): string[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY_WATCHLIST);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return sanitizeWatchlist(parsed);
      }
    }
  } catch {
    // Ignore storage parse error
  }
  return [];
}

/**
 * Appends a position to the portfolio. Returns `true` when successful.
 */
export function addPortfolioPosition(
  position: Omit<PortfolioPosition, "id"> & { id?: string },
): boolean {
  const id = position.id?.trim() || `pos-${position.ticker}-${Date.now()}`;
  const sanitized = sanitizePosition({ ...position, id });
  if (!sanitized) return false;
  const current = loadPersistedPositions();
  return savePortfolioPositions([...current, sanitized]);
}

// Load watchlist from localStorage
export function loadWatchlist(): string[] {
  const storage = getLocalStorage();
  if (!storage) return DEFAULT_PRESET_WATCHLIST;
  try {
    const raw = storage.getItem(STORAGE_KEY_WATCHLIST);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // An explicit empty list is an intended user action (cleared watchlist).
        if (parsed.length === 0) return [];

        const tickers = sanitizeWatchlist(parsed);
        // A fully corrupt non-empty list falls back to presets.
        if (tickers.length > 0) return tickers;
      }
    }
  } catch {
    // Ignore storage parse error
  }
  return DEFAULT_PRESET_WATCHLIST;
}

/**
 * Appends a ticker to the watchlist. Returns `true` when the list changed and was saved,
 * `false` when it was already present or storage failed, so callers can report the difference
 * instead of always claiming success.
 */
export function addWatchlistTicker(ticker: string): boolean {
  const normalized = sanitizeWatchlist([ticker]);
  if (normalized.length === 0) return false;

  const watchlist = loadPersistedWatchlist();
  if (watchlist.includes(normalized[0])) return false;
  return saveWatchlist([...watchlist, normalized[0]]);
}

// Save watchlist to localStorage
export function saveWatchlist(tickers: string[]): boolean {
  const storage = getLocalStorage();
  if (!storage) {
    lastSaveFailed = true;
    return false;
  }
  try {
    storage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(tickers));
    lastSaveFailed = false;
    return true;
  } catch {
    lastSaveFailed = true;
    return false;
  }
}

export interface PortfolioLiveQuote {
  price: number;
  change?: number;
  dps?: number | null;
  dividendYield?: number | null;
  name?: string;
  isDemoData?: boolean;
}

// Calculate entire portfolio financials and breakdown
export function calculatePortfolioSummary(
  positions: PortfolioPosition[],
  liveQuotesMap?:
    | Map<string, PortfolioLiveQuote>
    | ReadonlyMap<string, PortfolioLiveQuote>
    | number,
  usdJpyRate?: number,
): PortfolioSummary {
  let quotesMap:
    | ReadonlyMap<string, PortfolioLiveQuote>
    | undefined;
  let effectiveUsdJpyRate = usdJpyRate;

  if (typeof liveQuotesMap === "number") {
    effectiveUsdJpyRate = liveQuotesMap;
    quotesMap = undefined;
  } else {
    quotesMap = liveQuotesMap;
  }
  if (!positions || positions.length === 0) {
    return {
      totalMarketValue: 0,
      totalCost: 0,
      totalProfit: 0,
      totalProfitPercent: 0,
      dailyTotalChange: 0,
      totalAnnualDividend: 0,
      dividendYield: 0,
      positions: [],
    };
  }

  // 1. Calculate each position
  const enriched = positions.map((pos) => {
    const live =
      quotesMap && typeof quotesMap.get === "function"
        ? quotesMap.get(pos.ticker.toUpperCase())
        : undefined;
    const fund = getStockFundamentals(pos.ticker);
    const curr = getStockCurrency(pos.ticker);
    const isUSD = curr === "$";
    const rawQuoteRate = quotesMap?.get?.("USDJPY=X")?.price;
    const fallbackRate =
      typeof rawQuoteRate === "number" && Number.isFinite(rawQuoteRate) && rawQuoteRate > 0
        ? rawQuoteRate
        : DEFAULT_USD_JPY_RATE;
    const validCustomRate =
      typeof effectiveUsdJpyRate === "number" &&
      Number.isFinite(effectiveUsdJpyRate) &&
      effectiveUsdJpyRate > 0
        ? effectiveUsdJpyRate
        : undefined;
    const fxRate = isUSD ? (validCustomRate ?? fallbackRate) : 1;

    const currentPrice =
      live?.price && Number.isFinite(live.price) && live.price > 0
        ? live.price
        : pos.currentPrice && Number.isFinite(pos.currentPrice) && pos.currentPrice > 0
          ? pos.currentPrice
          : fund.price && Number.isFinite(fund.price) && fund.price > 0
            ? fund.price
            : pos.averageCost && Number.isFinite(pos.averageCost) && pos.averageCost > 0
              ? pos.averageCost
              : 0;
    const marketValue = isUSD
      ? Number((pos.shares * currentPrice).toFixed(2))
      : Math.round(pos.shares * currentPrice);
    const totalCost = isUSD
      ? Number((pos.shares * pos.averageCost).toFixed(2))
      : Math.round(pos.shares * pos.averageCost);
    const unrealizedProfit = isUSD
      ? Number((marketValue - totalCost).toFixed(2))
      : marketValue - totalCost;
    const unrealizedProfitPercent =
      totalCost > 0 ? Number(((unrealizedProfit / totalCost) * 100).toFixed(2)) : 0;
    const change = live?.change !== undefined ? live.change : fund.change;
    const dailyChange = isUSD
      ? Number((pos.shares * change).toFixed(2))
      : Math.round(pos.shares * change);
    const dps =
      live?.dps !== undefined && live.dps !== null
        ? live.dps
        : live?.dividendYield === 0
          ? 0
          : (fund.dps ?? 0);
    const annualDividend = isUSD
      ? Number((pos.shares * dps).toFixed(2))
      : Math.round(pos.shares * dps);

    const marketValueJpy = Math.round(marketValue * fxRate) || 0;
    const totalCostJpy = Math.round(totalCost * fxRate) || 0;
    const dailyChangeJpy = Math.round(dailyChange * fxRate) || 0;
    const annualDividendJpy = Math.round(annualDividend * fxRate) || 0;

    return {
      ...pos,
      name: live?.name || fund.name,
      currency: curr,
      fxRate,
      currentPrice,
      marketValue,
      totalCost,
      unrealizedProfit,
      unrealizedProfitPercent,
      dailyChange,
      annualDividend,
      marketValueJpy,
      totalCostJpy,
      dailyChangeJpy,
      annualDividendJpy,
      theme: fund.theme,
      sector: fund.sector,
      isDemoData: live?.isDemoData !== undefined ? live.isDemoData : fund.isDemoData,
      weightPercent: 0, // will compute below
    };
  });

  // 2. Compute aggregate totals (converted to JPY base)
  const totalMarketValue = enriched.reduce((sum, p) => sum + (Number.isFinite(p.marketValueJpy) ? p.marketValueJpy : 0), 0);
  const totalCost = enriched.reduce((sum, p) => sum + (Number.isFinite(p.totalCostJpy) ? p.totalCostJpy : 0), 0);
  const totalProfit = totalMarketValue - totalCost;
  const totalProfitPercent =
    totalCost > 0 ? Number(((totalProfit / totalCost) * 100).toFixed(2)) : 0;
  const dailyTotalChange = enriched.reduce((sum, p) => sum + (Number.isFinite(p.dailyChangeJpy) ? p.dailyChangeJpy : 0), 0);
  const totalAnnualDividend = enriched.reduce((sum, p) => sum + (Number.isFinite(p.annualDividendJpy) ? p.annualDividendJpy : 0), 0);
  const dividendYield =
    totalMarketValue > 0 ? Number(((totalAnnualDividend / totalMarketValue) * 100).toFixed(2)) : 0;

  // 3. Normalize weights
  const finalPositions: PositionCalculation[] = enriched.map((p) => ({
    ...p,
    weightPercent:
      totalMarketValue > 0 ? Number(((p.marketValueJpy / totalMarketValue) * 100).toFixed(1)) : 0,
  }));

  return {
    totalMarketValue,
    totalCost,
    totalProfit,
    totalProfitPercent,
    dailyTotalChange,
    totalAnnualDividend,
    dividendYield,
    positions: finalPositions,
  };
}

/**
 * ★【キラー機能】保有株式ポートフォリオをオリジナル指数（CustomIndex）のBasketItem[]へ変換
 * 評価額比率に応じて比率（ウェイト%）を自動計算し、合計100%に正規化します。
 */
export function convertPortfolioToCustomIndexBasket(
  positions: PortfolioPosition[],
  usdJpyRate?: number,
): BasketItem[] {
  const summary = calculatePortfolioSummary(positions, undefined, usdJpyRate);
  if (summary.positions.length === 0) return [];

  // Group by ticker to prevent duplicate constituents in the index basket
  const grouped = new Map<
    string,
    { ticker: string; name: string; theme: string; marketValue: number }
  >();
  for (const pos of summary.positions) {
    const normTicker = (pos.ticker || "").trim().toUpperCase();
    if (!normTicker) continue;
    const existing = grouped.get(normTicker);
    if (existing) {
      existing.marketValue += pos.marketValueJpy ?? pos.marketValue;
    } else {
      const posName = typeof pos.name === "string" ? pos.name.trim() : "";
      const posTheme = typeof pos.theme === "string" ? pos.theme.trim() : "";
      grouped.set(normTicker, {
        ticker: normTicker,
        name: posName || normTicker,
        theme: posTheme || "カスタム",
        marketValue: pos.marketValueJpy ?? pos.marketValue,
      });
    }
  }

  const items = Array.from(grouped.values());
  const weights = allocateIntegerWeights(items.map((item) => item.marketValue));

  return items.map((item, index) => ({
    ticker: item.ticker,
    name: item.name,
    theme: item.theme,
    weight: weights[index],
  }));
}
