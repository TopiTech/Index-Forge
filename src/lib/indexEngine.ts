import type { BasketItem, PricePoint, StockSeries } from "../types";
import { isValidTicker } from "./apiContract";

// Single-sourced: the canonical normalization lives in `./yahooSymbol` (which
// has no imports, so it stays Worker-bundleable). This re-export keeps the
// historical import surface working for existing callers and tests.
export { normalizeTicker } from "./yahooSymbol";
import { normalizeTicker } from "./yahooSymbol";

export function normalizeWeights(items: BasketItem[]): BasketItem[] {
  const safeItems = items.map((item) => ({
    ...item,
    weight: typeof item.weight === "number" && Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 0,
  }));
  const total = safeItems.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return safeItems;
  // No intermediate rounding: the caller rounds once at its own boundary
  // (index values to cents, UI weights to its display precision). Rounding
  // here to 4dp and again at the boundary was a textbook double rounding:
  // the second rounding could flip the last digit of an already-rounded
  // value. Full precision flows through; only the final output is rounded.
  return safeItems.map((item) => ({
    ...item,
    weight: (item.weight / total) * 100,
  }));
}

/**
 * Equalizes weights so that their sum is strictly 100.00% without rounding drift.
 * Uses integer remainder distribution across the first remainder items.
 */
export function equalizeWeightsExact<T extends { weight: number }>(items: T[], decimals = 2): T[] {
  const n = items.length;
  if (n === 0) return [];
  let safeDecimals = Math.max(0, Math.floor(decimals));
  while (n > 100 * 10 ** safeDecimals) {
    safeDecimals++;
  }
  const factor = 10 ** safeDecimals;
  const totalUnits = 100 * factor;
  const baseUnits = Math.floor(totalUnits / n);
  let remainder = totalUnits - baseUnits * n;

  return items.map((item) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    return {
      ...item,
      weight: Number(((baseUnits + extra) / factor).toFixed(safeDecimals)),
    };
  });
}

/**
 * Normalizes weights proportionally using the Largest Remainder Method (Hare-Niemeyer method)
 * so that their sum strictly equals 100.00% without rounding drift.
 *
 * Every constituent keeps a strictly positive weight: the Worker's basket
 * contract rejects an entry whose weight is not `> 0`, so a constituent whose
 * proportional share rounds down to zero would make the whole save fail with
 * a 400. One unit (0.01%) is therefore reserved per entry before the
 * remainder is distributed.
 */
export function redistributeWeightsExact<T extends { weight: number }>(items: T[], decimals = 2): T[] {
  if (items.length === 0) return [];
  let safeDecimals = Math.max(0, Math.floor(decimals));
  while (items.length > 100 * 10 ** safeDecimals) {
    safeDecimals++;
  }
  const factor = 10 ** safeDecimals;
  const totalUnits = 100 * factor;
  const safeWeights = items.map((item) =>
    typeof item.weight === "number" && Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 0,
  );
  const currentTotal = safeWeights.reduce((sum, w) => sum + w, 0);
  if (currentTotal <= 0) {
    return equalizeWeightsExact(items, safeDecimals);
  }

  const exactUnits = safeWeights.map((w) => (w / currentTotal) * totalUnits);
  const floors = exactUnits.map((u) => Math.max(1, Math.floor(u)));
  let currentFloorSum = floors.reduce((sum, f) => sum + f, 0);

  // The reserved units can push the sum past the target. Take the excess back
  // from the largest entries, never below the reserved minimum.
  let excess = currentFloorSum - totalUnits;
  if (excess > 0) {
    const bySize = floors
      .map((units, index) => ({ index, units }))
      .sort((a, b) => b.units - a.units || a.index - b.index);
    for (const entry of bySize) {
      if (excess <= 0) break;
      // An entry may give up more than one unit: taking only a single unit
      // per entry leaves the total above the target whenever the excess is
      // larger than the number of entries.
      const removable = floors[entry.index] - 1;
      const take = Math.min(removable, excess);
      if (take > 0) {
        floors[entry.index] -= take;
        excess -= take;
      }
    }
    currentFloorSum = floors.reduce((sum, f) => sum + f, 0);
  }

  const remainder = Math.max(0, totalUnits - currentFloorSum);

  const order = exactUnits
    .map((u, i) => ({ index: i, remainder: u - Math.floor(u) }))
    .sort((a, b) => b.remainder - a.remainder);

  const allocated = [...floors];
  for (let i = 0; i < remainder && i < order.length; i++) {
    allocated[order[i].index] += 1;
  }

  return items.map((item, i) => ({
    ...item,
    weight: Number((allocated[i] / factor).toFixed(safeDecimals)),
  }));
}


export interface BasketWeightRepair {
  ticker: string;
  /** The weight the basket carried before the repair (null when unusable). */
  from: number | null;
  /** The positive weight assigned instead. */
  to: number;
}

export interface BasketSanitizationResult {
  /** Items that satisfy the Worker's strict `/api/calculate` contract. */
  basket: BasketItem[];
  /** Original ticker labels that could not be repaired (invalid or duplicate). */
  dropped: string[];
  /** Constituents whose weight was missing/non-positive and had to be rebuilt. */
  repaired: BasketWeightRepair[];
}

export interface BasketSanitizationOptions {
  /**
   * Keep a constituent whose weight is missing or non-positive by assigning a
   * positive weight instead of dropping it.
   *
   * The save path (`buildSaveIndexRequest`) must use this: dropping a legacy
   * `weight: 0` row deleted the constituent from the index on the next save
   * (DATA-09/DATA-17). The calculation path keeps the historical drop
   * behavior so a single unusable row cannot silently change the displayed
   * index.
   */
  repairMissingWeights?: boolean;
}

/** Smallest weight the Worker's `weight > 0` contract accepts. */
const MIN_REQUEST_WEIGHT = 0.01;

/**
 * Repairs a basket so it always satisfies the Worker contract
 * (`POST /api/calculate` rejects the whole request on a single bad entry:
 * ticker `^[A-Za-z0-9.^=_-]{1,20}$`, 1-100 char name, theme ≤ 100 chars,
 * `0 < weight <= 100`; see `src/lib/apiContract.ts` for the single definition
 * of that boundary).
 *
 * The client can receive baskets the Worker itself would refuse to write:
 * legacy D1 rows carry NULL weights that `GET /api/indices` coerces to `0`,
 * imports can produce full-width tickers or weights above 100, and
 * localStorage copies can be hand-edited. Sending such a basket verbatim
 * turned one malformed constituent into a permanently broken dashboard, so
 * each field is normalized here and only unrepairable items are dropped.
 * A basket whose weights are *all* invalid (e.g. a single legacy zero-weight
 * row) is re-balanced instead of dropped, because an empty request would be
 * rejected as well and would leave the user with no calculation at all.
 *
 * `options.repairMissingWeights` additionally keeps a constituent whose weight
 * is missing/non-positive by rebuilding a positive weight for it (DATA-17). The
 * save path uses it so a legacy `weight: 0` row is not deleted on save; the
 * calculation path keeps the historical drop behavior.
 */
export function sanitizeBasketForRequest(
  items: readonly BasketItem[],
  options: BasketSanitizationOptions = {},
): BasketSanitizationResult {
  const dropped: string[] = [];
  const repaired: (BasketItem & { originalWeight: number | null })[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const rawTicker = typeof item?.ticker === "string" ? item.ticker : "";
    const ticker = normalizeTicker(rawTicker);
    if (!isValidTicker(ticker)) {
      dropped.push(rawTicker.trim() || "(ティッカーなし)");
      continue;
    }
    if (seen.has(ticker)) {
      dropped.push(ticker);
      continue;
    }
    seen.add(ticker);

    const rawName = typeof item.name === "string" ? item.name.trim() : "";
    const name = rawName ? rawName.slice(0, 100) : ticker;
    const rawTheme = typeof item.theme === "string" ? item.theme.trim() : "";
    const theme = (rawTheme ? rawTheme : "カスタム").slice(0, 100);
    const weight = item.weight;

    // Weights above 100 are clamped rather than dropped so a single mistyped
    // row cannot delete a constituent from the index; only non-positive or
    // non-finite weights (the legacy NULL case) are treated as missing.
    const normalizedWeight =
      typeof weight === "number" && Number.isFinite(weight) && weight > 0
        ? Math.min(weight, 100)
        : Number.NaN;

    repaired.push({
      ticker,
      name,
      theme,
      weight: normalizedWeight,
      originalWeight: typeof weight === "number" && Number.isFinite(weight) ? weight : null,
    });
  }

  const withWeight = repaired.filter((item) => !Number.isNaN(item.weight));
  if (withWeight.length === 0 && repaired.length > 0) {
    // Every weight is unusable: fall back to an exact equal split so the
    // index stays computable instead of being rejected or silently empty.
    return {
      basket: equalizeWeightsExact(
        repaired.map((item) => ({ ticker: item.ticker, name: item.name, theme: item.theme, weight: 100 })),
      ),
      dropped,
      repaired: [],
    };
  }

  if (options.repairMissingWeights !== true) {
    for (const item of repaired) {
      if (Number.isNaN(item.weight)) dropped.push(item.ticker);
    }
    return { basket: withWeight.map(toBasketItem), dropped, repaired: [] };
  }

  // DATA-17: keep every usable constituent. Legacy/imported `weight: 0` rows
  // are assigned an equal share of the remaining 100% budget (at least the minimum
  // the Worker accepts) instead of being silently deleted on save.
  const missingItems = repaired.filter((item) => Number.isNaN(item.weight));
  const missingCount = missingItems.length;
  const validWeightTotal = withWeight.reduce((sum, item) => sum + item.weight, 0);
  const remainingBudget = Number((100 - validWeightTotal).toFixed(2));
  const perItemBudget =
    missingCount > 0 ? Number((remainingBudget / missingCount).toFixed(2)) : remainingBudget;
  const repairWeight =
    perItemBudget >= MIN_REQUEST_WEIGHT ? Math.min(perItemBudget, 100) : MIN_REQUEST_WEIGHT;

  const weightRepairs: BasketWeightRepair[] = [];
  const basket = repaired.map((item) => {
    if (!Number.isNaN(item.weight)) return toBasketItem(item);
    weightRepairs.push({ ticker: item.ticker, from: item.originalWeight, to: repairWeight });
    return { ticker: item.ticker, name: item.name, theme: item.theme, weight: repairWeight };
  });

  return { basket, dropped, repaired: weightRepairs };
}

/** Drop the internal bookkeeping field before the item leaves this module. */
function toBasketItem(item: BasketItem & { originalWeight?: number | null }): BasketItem {
  return { ticker: item.ticker, name: item.name, theme: item.theme, weight: item.weight };
}

/** How one matrix cell was produced for one constituent on one date. */
export type PriceFillKind = "real" | "pre" | "gap" | "trailing";

/** One constituent row of the shared price matrix. */
export interface IndexMatrixRow {
  ticker: string;
  weight: number;
  /** Base price: the first valid close of this constituent. */
  basePrice: number;
  /** Per-date close actually used (real or filled, exactly as calculated). */
  values: number[];
  /** How each cell of `values` was produced. */
  fills: PriceFillKind[];
}

/** The single price matrix both the index values and the coverage use. */
export interface IndexPriceMatrix {
  dates: string[];
  rows: IndexMatrixRow[];
  tickerIndex: Map<string, number>;
}

/** A price is usable only when it is a positive finite number. */
function isUsableClose(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Build the date × constituent price matrix both consumers share.
 *
 * `calculateCustomIndex` used to own this loop and silently forward-filled
 * every gap with the previous close, so a delisted constituent stayed frozen
 * at its last price forever with no record of the substitution. Extracting
 * the builder keeps the values byte-identical while recording, per cell,
 * whether the price is real or filled — and, for fills, whether the
 * constituent had not started yet (`pre`, anchored at its base price by
 * design), missed a date mid-series (`gap`) or has not printed since
 * (`trailing`). `computeIndexCoverage` reads the same matrix, so the
 * disclosed gaps can never drift from the calculated values.
 */
export function buildIndexPriceMatrix(
  basket: BasketItem[],
  stockUniverse: StockSeries[],
): IndexPriceMatrix {
  const normalized = normalizeWeights(basket);
  const stockByTicker = new Map(stockUniverse.map((stock) => [normalizeTicker(stock.ticker), stock]));
  const consolidated = new Map<string, StockSeries & { weight: number }>();
  for (const item of normalized) {
    const norm = normalizeTicker(item.ticker);
    const stock = stockByTicker.get(norm);
    if (!stock || stock.series.length === 0) continue;
    const existing = consolidated.get(norm);
    if (existing) {
      existing.weight += item.weight;
    } else {
      consolidated.set(norm, { ...stock, weight: item.weight });
    }
  }
  const selected = Array.from(consolidated.values());

  const empty: IndexPriceMatrix = { dates: [], rows: [], tickerIndex: new Map() };
  if (selected.length === 0) return empty;

  const initialBasePrices = selected.map((stock) => {
    const sorted = [...stock.series].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted.find((p) => isUsableClose(p.close));
    return first ? (first.close as number) : 0;
  });

  const validIndices = initialBasePrices
    .map((bp, i) => (bp > 0 ? i : -1))
    .filter((i) => i >= 0);
  if (validIndices.length === 0) return empty;

  const validStocks = validIndices.map((i) => selected[i]);
  const basePrices = validIndices.map((i) => initialBasePrices[i]);
  const tickerIndexMap = new Map(validStocks.map((s, i) => [normalizeTicker(s.ticker), i]));

  const allDates = Array.from(new Set(
    validStocks.flatMap((stock) => stock.series.map((p) => p.date)),
  )).sort();
  if (allDates.length === 0) return empty;

  const rows: IndexMatrixRow[] = validStocks.map((stock, stockIndex) => {
    const priceMap = new Map(stock.series.map((p) => [p.date, p.close]));
    const sortedCloses = [...stock.series]
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter((p) => isUsableClose(p.close));
    const firstRealDate = sortedCloses.length > 0 ? sortedCloses[0].date : null;
    const lastRealDate = sortedCloses.length > 0 ? sortedCloses[sortedCloses.length - 1].date : null;
    const firstPrice = basePrices[stockIndex];
    let lastPrice = firstPrice;

    const values: number[] = [];
    const fills: PriceFillKind[] = [];
    for (const date of allDates) {
      const price = priceMap.get(date);
      if (isUsableClose(price)) {
        lastPrice = price;
        values.push(price);
        fills.push("real");
        continue;
      }
      values.push(lastPrice);
      if (firstRealDate !== null && date < firstRealDate) {
        fills.push("pre");
      } else if (lastRealDate !== null && date > lastRealDate) {
        fills.push("trailing");
      } else {
        fills.push("gap");
      }
    }
    return { ticker: stock.ticker, weight: stock.weight, basePrice: firstPrice, values, fills };
  });

  return { dates: allDates, rows, tickerIndex: tickerIndexMap };
}

export function calculateCustomIndex(
  basket: BasketItem[],
  stockUniverse: StockSeries[],
  baseValue = 1000,
): PricePoint[] {
  const safeBase = typeof baseValue === "number" && Number.isFinite(baseValue) && baseValue > 0 ? baseValue : 1000;
  // Values and coverage read one shared matrix: the fill behavior can no
  // longer drift between the two.
  const { dates: allDates, rows } = buildIndexPriceMatrix(basket, stockUniverse);
  if (allDates.length === 0 || rows.length === 0) return [];

  return allDates.map((date, dateIndex) => {
    // この日付で有効なデータ（価格 > 0 かつ 基準価格が存在する）を持つ銘柄を抽出
    // Matrix cells are always positive (a real close, or the base price
    // carried forward), so every row participates exactly as before.
    const availableRows = rows.filter(
      (row) => row.values[dateIndex] > 0 && row.basePrice > 0,
    );

    if (availableRows.length === 0) {
      return { date, value: safeBase, close: safeBase };
    }

    // 利用可能な銘柄の合計ウェイトを計算して再正規化
    const totalWeightOfAvailable = availableRows.reduce((sum, row) => sum + row.weight, 0);

    const weightedRelative = availableRows.reduce((sum, row) => {
      // ウェイトを再正規化して適用 (合計ウェイトが0の場合は均等配分)
      const normalizedWeight = totalWeightOfAvailable > 0
        ? row.weight / totalWeightOfAvailable
        : 1 / availableRows.length;
      return sum + (row.values[dateIndex] / row.basePrice) * normalizedWeight;
    }, 0);

    const calculatedValue = Number((safeBase * weightedRelative).toFixed(2));
    return { date, value: calculatedValue, close: calculatedValue };
  });
}

/** One date of the coverage report: how much of the index is real prices. */
export interface IndexCoveragePoint {
  date: string;
  /** Constituents participating in the value on this date. */
  total: number;
  /** Constituents with a real print on this date. */
  available: number;
  /** Tickers whose price was carried forward on this date (gap/trailing). */
  filledTickers: string[];
}

/** Missing-data disclosure for one calculation, computed from the same matrix. */
export interface IndexCoverage {
  points: IndexCoveragePoint[];
  /** Latest date of the calculation window (`""` when empty). */
  latestDate: string;
  /** gap + trailing cells over total cells (pre-start anchoring excluded). */
  filledCellRatio: number;
  /** Tickers carried forward on the latest date (the displayed value is stale for them). */
  trailingFilledTickers: string[];
}

/**
 * Disclose which parts of an index value are carried-forward prices.
 *
 * The forward fill itself is kept (a single gap must not make a whole index
 * uncomputable), but it used to be invisible: a delisted constituent stayed
 * frozen at its last print forever while `syncStatus {total,found}` only
 * counted tickers with *some* data. This reads the shared matrix, so the
 * reported gaps are exactly the substitutions the values contain.
 *
 * `pre` fills (before a constituent's first print, anchored at its base
 * price by design) are not missing data and are excluded from the fill
 * counts; `gap` (mid-series) and `trailing` (no print since) fills are.
 */
export function computeIndexCoverage(
  basket: BasketItem[],
  stockUniverse: StockSeries[],
): IndexCoverage {
  const empty: IndexCoverage = {
    points: [],
    latestDate: "",
    filledCellRatio: 0,
    trailingFilledTickers: [],
  };
  const { dates, rows } = buildIndexPriceMatrix(basket, stockUniverse);
  if (dates.length === 0 || rows.length === 0) return empty;

  let filledCells = 0;
  const points = dates.map((date, dateIndex) => {
    const filledTickers: string[] = [];
    let available = 0;
    for (const row of rows) {
      const fill = row.fills[dateIndex];
      if (fill === "real") {
        available += 1;
      } else if (fill === "gap" || fill === "trailing") {
        filledCells += 1;
        filledTickers.push(row.ticker);
      }
    }
    return { date, total: rows.length, available, filledTickers };
  });
  const latestPoint = points[points.length - 1];
  return {
    points,
    latestDate: latestPoint ? latestPoint.date : "",
    filledCellRatio: rows.length > 0 && dates.length > 0 ? filledCells / (rows.length * dates.length) : 0,
    trailingFilledTickers: latestPoint ? [...latestPoint.filledTickers] : [],
  };
}

/** Maximum tickers named inline before a warning compacts the rest. */
const COVERAGE_WARNING_TICKER_LIMIT = 5;

function formatTickerList(tickers: string[]): string {
  if (tickers.length <= COVERAGE_WARNING_TICKER_LIMIT) return tickers.join("、");
  const head = tickers.slice(0, COVERAGE_WARNING_TICKER_LIMIT).join("、");
  return `${head}（他${tickers.length - COVERAGE_WARNING_TICKER_LIMIT}件）`;
}

/**
 * Human-readable missing-data warnings for the calculation result.
 *
 * Pure (no React, no I/O) so hooks and tests share it: the dashboard appends
 * these to its sync warnings, and the simulator uses the same wording.
 * Empty when every participating price is real.
 */
export function getIndexCoverageWarnings(
  basket: BasketItem[],
  stockUniverse: StockSeries[],
): string[] {
  const coverage = computeIndexCoverage(basket, stockUniverse);
  if (coverage.points.length === 0) return [];
  const warnings: string[] = [];
  if (coverage.trailingFilledTickers.length > 0) {
    warnings.push(
      `最新日（${coverage.latestDate}）時点で次の${coverage.trailingFilledTickers.length}銘柄の価格が欠測のため、直近の価格で補完して計算しています：${formatTickerList(coverage.trailingFilledTickers)}`,
    );
  }
  const gapDays = coverage.points.filter(
    (point) => point.date !== coverage.latestDate && point.filledTickers.length > 0,
  ).length;
  if (gapDays > 0) {
    const percent = Number((coverage.filledCellRatio * 100).toFixed(1));
    warnings.push(
      `期間中に価格の欠測を補完した日が${gapDays}日あります（補完セル率 ${percent}%）。対象銘柄はチャート上で直近値のまま推移します`,
    );
  }
  return warnings;
}
