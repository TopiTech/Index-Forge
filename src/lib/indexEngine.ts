import type { BasketItem, PricePoint, StockSeries } from "../types";

export function normalizeTicker(ticker?: string | null): string {
  if (typeof ticker !== "string") return "";
  return ticker.trim().toUpperCase();
}

export function normalizeWeights(items: BasketItem[]): BasketItem[] {
  const safeItems = items.map((item) => ({
    ...item,
    weight: typeof item.weight === "number" && Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 0,
  }));
  const total = safeItems.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return safeItems;
  return safeItems.map((item) => ({
    ...item,
    weight: Number(((item.weight / total) * 100).toFixed(4)),
  }));
}

/**
 * Equalizes weights so that their sum is strictly 100.00% without rounding drift.
 * Uses integer remainder distribution across the first remainder items.
 */
export function equalizeWeightsExact<T extends { weight: number }>(items: T[], decimals = 2): T[] {
  const n = items.length;
  if (n === 0) return [];
  const factor = 10 ** decimals;
  const totalUnits = 100 * factor;
  const baseUnits = Math.floor(totalUnits / n);
  let remainder = totalUnits - baseUnits * n;

  return items.map((item) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    return {
      ...item,
      weight: Number(((baseUnits + extra) / factor).toFixed(decimals)),
    };
  });
}

/**
 * Normalizes weights proportionally using the Largest Remainder Method (Hare-Niemeyer method)
 * so that their sum strictly equals 100.00% without rounding drift.
 */
export function redistributeWeightsExact<T extends { weight: number }>(items: T[], decimals = 2): T[] {
  if (items.length === 0) return [];
  const factor = 10 ** decimals;
  const totalUnits = 100 * factor;
  const safeWeights = items.map((item) =>
    typeof item.weight === "number" && Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 0,
  );
  const currentTotal = safeWeights.reduce((sum, w) => sum + w, 0);
  if (currentTotal <= 0) {
    return equalizeWeightsExact(items, decimals);
  }

  const exactUnits = safeWeights.map((w) => (w / currentTotal) * totalUnits);
  const floors = exactUnits.map((u) => Math.floor(u));
  const currentFloorSum = floors.reduce((sum, f) => sum + f, 0);
  const remainder = Math.max(0, totalUnits - currentFloorSum);

  const order = exactUnits
    .map((u, i) => ({ index: i, remainder: u - floors[i] }))
    .sort((a, b) => b.remainder - a.remainder);

  const allocated = [...floors];
  for (let i = 0; i < remainder && i < order.length; i++) {
    allocated[order[i].index] += 1;
  }

  return items.map((item, i) => ({
    ...item,
    weight: Number((allocated[i] / factor).toFixed(decimals)),
  }));
}


export function calculateCustomIndex(
  basket: BasketItem[],
  stockUniverse: StockSeries[],
  baseValue = 1000,
): PricePoint[] {
  const safeBase = typeof baseValue === "number" && Number.isFinite(baseValue) && baseValue > 0 ? baseValue : 1000;
  const normalized = normalizeWeights(basket);
  const stockByTicker = new Map(stockUniverse.map((stock) => [normalizeTicker(stock.ticker), stock]));
  const selected = normalized
    .map((item) => {
      const stock = stockByTicker.get(normalizeTicker(item.ticker));
      return stock && stock.series.length > 0 ? { ...stock, weight: item.weight } : null;
    })
    .filter((stock): stock is StockSeries & { weight: number } => Boolean(stock));

  if (selected.length === 0) return [];

  // 基準日の価格（全銘柄の最初の有効な価格）を取得。
  // Stocks with no valid base price are excluded rather than aborting the
  // entire index: a single missing data point in a large basket should not
  // make the whole index uncomputable. The remaining stocks' weights are
  // re-normalized during the calculation loop below.
  const initialBasePrices = selected.map((stock) => {
    const sorted = [...stock.series].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted.find((p) => typeof p.close === "number" && Number.isFinite(p.close) && p.close > 0);
    return first ? first.close : 0;
  });

  // Filter out stocks that have no valid base price.
  const validIndices = initialBasePrices
    .map((bp, i) => (bp > 0 ? i : -1))
    .filter((i) => i >= 0);

  if (validIndices.length === 0) return [];

  const validStocks = validIndices.map((i) => selected[i]);
  const basePrices = validIndices.map((i) => initialBasePrices[i]);

  // Build ticker → index map for O(1) lookup instead of findIndex
  const tickerIndexMap = new Map(validStocks.map((s, i) => [normalizeTicker(s.ticker), i]));

  // 有効銘柄から存在する全日付を抽出してソート (YYYY-MM-DD sorts correctly as strings)
  const allDates = Array.from(new Set(
    validStocks.flatMap((stock) => stock.series.map((p) => p.date)),
  )).sort();

  if (allDates.length === 0) return [];

  // 各銘柄の各日付における価格をマッピング
  // データ開始前は初値（基準価格）でバックフィルし、データ欠落時は前日価格でフォワードフィル
  const stockPriceMatrix = validStocks.map((stock, stockIndex) => {
    const priceMap = new Map(stock.series.map((p) => [p.date, p.close]));
    const firstPrice = basePrices[stockIndex];
    let lastPrice = firstPrice;

    return allDates.map((date) => {
      const price = priceMap.get(date);
      if (price !== undefined && typeof price === "number" && Number.isFinite(price) && price > 0) {
        lastPrice = price;
        return price;
      }
      return lastPrice; // 前日または初値価格を流用
    });
  });

  return allDates.map((date, dateIndex) => {
    // この日付で有効なデータ（価格 > 0 かつ 基準価格が存在する）を持つ銘柄を抽出
    const availableStocks = validStocks.filter((_, stockIndex) => {
      const price = stockPriceMatrix[stockIndex][dateIndex];
      const start = basePrices[stockIndex];
      return price > 0 && start > 0;
    });

    if (availableStocks.length === 0) {
      return { date, value: safeBase, close: safeBase };
    }

    // 利用可能な銘柄の合計ウェイトを計算して再正規化
    const totalWeightOfAvailable = availableStocks.reduce((sum, s) => sum + s.weight, 0);

    const weightedRelative = availableStocks.reduce((sum, stock) => {
      const stockIndex = tickerIndexMap.get(normalizeTicker(stock.ticker))!;
      const start = basePrices[stockIndex];
      const current = stockPriceMatrix[stockIndex][dateIndex];

      // ウェイトを再正規化して適用 (合計ウェイトが0の場合は均等配分)
      const normalizedWeight = totalWeightOfAvailable > 0
        ? stock.weight / totalWeightOfAvailable
        : 1 / availableStocks.length;
      return sum + (current / start) * normalizedWeight;
    }, 0);

    const calculatedValue = Number((safeBase * weightedRelative).toFixed(2));
    return { date, value: calculatedValue, close: calculatedValue };
  });
}
