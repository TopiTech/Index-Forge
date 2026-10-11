/**
 * Portfolio & Watchlist Storage Engine
 * 実保有株式の損益計算、アセットアロケーション、およびオリジナル指数化連携
 */

import { getStockFundamentals } from "./marketDataService";
import { allocateIntegerWeights } from "./weights";
import type { BasketItem } from "../types";

export interface PortfolioPosition {
  id: string;
  ticker: string;
  name: string;
  shares: number; // 保有株数
  averageCost: number; // 取得単価
  acquiredAt?: string;
  notes?: string;
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
  theme: string;
  sector: string;
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
  const name =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : ticker;

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

// Save positions to localStorage
export function savePortfolioPositions(positions: PortfolioPosition[]): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY_PORTFOLIO, JSON.stringify(positions));
  } catch {
    // Ignore storage write error
  }
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
 * Appends a ticker to the watchlist. Returns `true` when the list changed,
 * `false` when it was already present, so callers can report the difference
 * instead of always claiming success.
 */
export function addWatchlistTicker(ticker: string): boolean {
  const normalized = sanitizeWatchlist([ticker]);
  if (normalized.length === 0) return false;

  const watchlist = loadWatchlist();
  if (watchlist.includes(normalized[0])) return false;
  saveWatchlist([...watchlist, normalized[0]]);
  return true;
}

// Save watchlist to localStorage
export function saveWatchlist(tickers: string[]): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(tickers));
  } catch {
    // Ignore storage write error
  }
}

// Calculate entire portfolio financials and breakdown
export function calculatePortfolioSummary(
  positions: PortfolioPosition[],
): PortfolioSummary {
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
    const fund = getStockFundamentals(pos.ticker);
    const currentPrice = fund.price;
    const marketValue = Math.round(pos.shares * currentPrice);
    const totalCost = Math.round(pos.shares * pos.averageCost);
    const unrealizedProfit = marketValue - totalCost;
    const unrealizedProfitPercent =
      totalCost > 0 ? Number(((unrealizedProfit / totalCost) * 100).toFixed(2)) : 0;
    const dailyChange = Math.round(pos.shares * fund.change);
    const dps = fund.dps ?? 0;
    const annualDividend = Math.round(pos.shares * dps);

    return {
      ...pos,
      name: fund.name,
      currentPrice,
      marketValue,
      totalCost,
      unrealizedProfit,
      unrealizedProfitPercent,
      dailyChange,
      annualDividend,
      theme: fund.theme,
      sector: fund.sector,
      weightPercent: 0, // will compute below
    };
  });

  // 2. Compute aggregate totals
  const totalMarketValue = enriched.reduce((sum, p) => sum + p.marketValue, 0);
  const totalCost = enriched.reduce((sum, p) => sum + p.totalCost, 0);
  const totalProfit = totalMarketValue - totalCost;
  const totalProfitPercent =
    totalCost > 0 ? Number(((totalProfit / totalCost) * 100).toFixed(2)) : 0;
  const dailyTotalChange = enriched.reduce((sum, p) => sum + p.dailyChange, 0);
  const totalAnnualDividend = enriched.reduce((sum, p) => sum + p.annualDividend, 0);
  const dividendYield =
    totalMarketValue > 0
      ? Number(((totalAnnualDividend / totalMarketValue) * 100).toFixed(2))
      : 0;

  // 3. Normalize weights
  const finalPositions: PositionCalculation[] = enriched.map((p) => ({
    ...p,
    weightPercent:
      totalMarketValue > 0
        ? Number(((p.marketValue / totalMarketValue) * 100).toFixed(1))
        : 0,
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
): BasketItem[] {
  const summary = calculatePortfolioSummary(positions);
  if (summary.positions.length === 0) return [];

  // Group by ticker to prevent duplicate constituents in the index basket
  const grouped = new Map<
    string,
    { ticker: string; name: string; theme: string; marketValue: number }
  >();
  for (const pos of summary.positions) {
    const existing = grouped.get(pos.ticker);
    if (existing) {
      existing.marketValue += pos.marketValue;
    } else {
      grouped.set(pos.ticker, {
        ticker: pos.ticker,
        name: pos.name,
        theme: pos.theme,
        marketValue: pos.marketValue,
      });
    }
  }

  const items = Array.from(grouped.values());
  const weights = allocateIntegerWeights(
    items.map((item) => item.marketValue),
  );

  return items.map((item, index) => ({
    ticker: item.ticker,
    name: item.name,
    theme: item.theme,
    weight: weights[index],
  }));
}

