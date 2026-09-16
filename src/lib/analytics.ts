import type { BasketItem, PricePoint, RiskMetrics, StockDetail, StockSeries } from "../types";
import { normalizeWeights } from "./indexEngine";

const CANONICAL_PRICE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeAnalyticsSeries(
  series: PricePoint[] | undefined,
  useValue: boolean,
): PricePoint[] {
  if (!Array.isArray(series)) return [];
  const byDate = new Map<string, PricePoint>();

  for (const point of series) {
    if (!point || typeof point.date !== "string") {
      continue;
    }
    const value = useValue ? (point.value ?? point.close) : point.close;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      continue;
    }
    byDate.set(point.date, point);
  }

  const normalized = Array.from(byDate.values());
  // API data uses canonical ISO dates, for which lexical ordering is safe.
  // Keep the original order for legacy callers that use a looser date label
  // format; this preserves the existing time-series contract for those inputs.
  return normalized.every((point) => CANONICAL_PRICE_DATE_PATTERN.test(point.date))
    ? normalized.sort((a, b) => a.date.localeCompare(b.date))
    : normalized;
}

/**
 * 単純移動平均線 (SMA) を計算
 *
 * Returns null for any window that contains a non-finite value (NaN,
 * Infinity, undefined). A single corrupted data point would otherwise
 * propagate through the sliding-window sum and permanently corrupt all
 * later SMA values (NaN + x = NaN).
 */
export function calculateSMA(data: number[], window: number): (number | null)[] {
  const win = Math.floor(window);
  if (!Number.isFinite(win) || win <= 0 || data.length === 0) return data.map(() => null);
  const result: (number | null)[] = [];
  let sum = 0;
  let validCount = 0;

  for (let i = 0; i < data.length; i++) {
    const val = data[i];
    const isFinite = typeof val === "number" && Number.isFinite(val);
    if (isFinite) {
      sum += val;
      validCount += 1;
    }
    if (i >= win) {
      const outgoing = data[i - win];
      const wasFinite = typeof outgoing === "number" && Number.isFinite(outgoing);
      if (wasFinite) {
        sum -= outgoing;
        validCount -= 1;
      }
    }
    if (i >= win - 1) {
      // Only emit a value when every element in the window is finite.
      result.push(validCount === win ? Number((sum / win).toFixed(2)) : null);
    } else {
      result.push(null);
    }
  }

  return result;
}

/**
 * 指数系列とベンチマーク系列からクオンツ・リスク指標を算出
 */
export function calculateRiskMetrics(
  rawCustomSeries: PricePoint[],
  rawBenchmarkSeries: PricePoint[],
  riskFreeRate = 0.005, // 0.5% (日本国債等想定)
): RiskMetrics {
  const defaultMetrics: RiskMetrics = {
    annualReturn: 0,
    annualVolatility: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    beta: null,
    winRate: 0,
    bestDay: 0,
    worstDay: 0,
  };

  const customSeries = normalizeAnalyticsSeries(rawCustomSeries, true);
  const benchmarkSeries = normalizeAnalyticsSeries(rawBenchmarkSeries, false);

  if (!customSeries || customSeries.length < 2) {
    return defaultMetrics;
  }

  // 1. 日次リターン配列の計算
  // Guard: validate both prev and curr are finite positive numbers before
  // division. A single NaN/Infinity/null data point would otherwise
  // propagate through every downstream metric (volatility, Sharpe, etc.).
  const customReturns: number[] = [];
  for (let i = 1; i < customSeries.length; i++) {
    const prevRaw = customSeries[i - 1].value ?? customSeries[i - 1].close;
    const currRaw = customSeries[i].value ?? customSeries[i].close;
    const prev = typeof prevRaw === "number" && Number.isFinite(prevRaw) ? prevRaw : NaN;
    const curr = typeof currRaw === "number" && Number.isFinite(currRaw) ? currRaw : NaN;
    if (prev > 0 && Number.isFinite(curr)) {
      customReturns.push((curr - prev) / prev);
    }
  }

  if (customReturns.length === 0) return defaultMetrics;

  // 2. 期間リターンと年率換算リターン
  const startVal = customSeries[0].value ?? customSeries[0].close;
  const endVal =
    customSeries[customSeries.length - 1].value ?? customSeries[customSeries.length - 1].close;
  const totalReturn = startVal > 0 ? (endVal - startVal) / startVal : 0;

  // 年率換算 (CAGR: Compound Annual Growth Rate, 250営業日基準)
  // 短期間（250営業日未満）での幾何平均年率換算は (1+r)^(250/N) で指数爆発を引き起こすため、
  // 250営業日未満の場合は線形年率換算（単利年率）を用いて極端な歪みを防止する。
  // NOTE: 249日→250日の境界で年率値に小さな不連続が生じうるが、実用上は問題ない。
  const annualFactor = 250 / customReturns.length;
  let annualReturn: number;
  if (customReturns.length >= 250) {
    // Guard: Math.pow requires a positive base; a total loss (totalReturn <= -1)
    // would make the base non-positive, so cap at -100%.
    annualReturn = 1 + totalReturn > 0 ? (Math.pow(1 + totalReturn, annualFactor) - 1) * 100 : -100;
  } else {
    annualReturn = totalReturn * annualFactor * 100;
  }

  // 3. 年率ボラティリティ (標準偏差 * sqrt(250))
  const meanReturn = customReturns.reduce((sum, r) => sum + r, 0) / customReturns.length;
  const variance =
    customReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) /
    (customReturns.length - 1 || 1);
  const dailyVol = Math.sqrt(variance);
  const annualVolatility = dailyVol * Math.sqrt(250) * 100;

  // 4. シャープレシオ
  const excessReturn = annualReturn / 100 - riskFreeRate;
  const volFraction = annualVolatility / 100;
  const sharpeRatio = volFraction > 0 ? Number((excessReturn / volFraction).toFixed(2)) : 0;

  // 5. 最大ドローダウン (MDD)
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const pt of customSeries) {
    const rawVal = pt.value ?? pt.close;
    const val = typeof rawVal === "number" && Number.isFinite(rawVal) && rawVal > 0 ? rawVal : 0;
    if (val > 0) {
      if (val > peak) {
        peak = val;
      }
      if (peak > 0) {
        const dd = ((peak - val) / peak) * 100;
        if (dd > maxDrawdown) {
          maxDrawdown = dd;
        }
      }
    }
  }

  // 6. ベータ値 (対ベンチマーク)
  let beta: number | null = null;
  if (benchmarkSeries && benchmarkSeries.length >= 2) {
    const sortedBench = [...benchmarkSeries]
      .filter((p) => typeof p.close === "number" && Number.isFinite(p.close) && p.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    // ベンチマーク市場（例: 米国S&P 500や為替）と日本市場の祝日差異によるデータ脱落を防ぐため、
    // 自作指数の日付軸に沿ってベンチマーク価格をフォワードフィル（前営業日終値補完）する。
    const benchMap = new Map<string, number>();
    let lastBenchPrice: number | null = null;
    let bIdx = 0;
    for (const pt of customSeries) {
      while (bIdx < sortedBench.length && sortedBench[bIdx].date <= pt.date) {
        lastBenchPrice = sortedBench[bIdx].close;
        bIdx++;
      }
      if (lastBenchPrice !== null) {
        benchMap.set(pt.date, lastBenchPrice);
      }
    }

    const pairedReturns: { custom: number; bench: number }[] = [];

    for (let i = 1; i < customSeries.length; i++) {
      const prevDate = customSeries[i - 1].date;
      const currDate = customSeries[i].date;
      const prevC = customSeries[i - 1].value ?? customSeries[i - 1].close;
      const currC = customSeries[i].value ?? customSeries[i].close;

      const prevB = benchMap.get(prevDate);
      const currB = benchMap.get(currDate);

      if (prevC > 0 && prevB !== undefined && currB !== undefined && prevB > 0) {
        pairedReturns.push({
          custom: (currC - prevC) / prevC,
          bench: (currB - prevB) / prevB,
        });
      }
    }

    if (pairedReturns.length > 2) {
      const bMean = pairedReturns.reduce((s, p) => s + p.bench, 0) / pairedReturns.length;
      const cMean = pairedReturns.reduce((s, p) => s + p.custom, 0) / pairedReturns.length;

      let cov = 0;
      let bVar = 0;
      for (const p of pairedReturns) {
        cov += (p.custom - cMean) * (p.bench - bMean);
        bVar += Math.pow(p.bench - bMean, 2);
      }

      if (bVar > 0) {
        beta = Number((cov / bVar).toFixed(2));
      }
    }
  }

  // 7. 勝率・ベスト/ワースト日
  const winDays = customReturns.filter((r) => r > 0).length;
  const winRate = Number(((winDays / customReturns.length) * 100).toFixed(1));
  const bestDay =
    customReturns.length > 0
      ? Number((customReturns.reduce((max, r) => (r > max ? r : max), -Infinity) * 100).toFixed(2))
      : 0;
  const worstDay =
    customReturns.length > 0
      ? Number((customReturns.reduce((min, r) => (r < min ? r : min), Infinity) * 100).toFixed(2))
      : 0;

  const roundSafe = (n: number, decimals: number, fallback = 0) => {
    if (!Number.isFinite(n)) return fallback;
    const rounded = Number(n.toFixed(decimals));
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  return {
    annualReturn: roundSafe(annualReturn, 2),
    annualVolatility: roundSafe(annualVolatility, 2),
    sharpeRatio: roundSafe(sharpeRatio, 2),
    maxDrawdown: roundSafe(maxDrawdown, 2),
    beta: beta === null ? null : roundSafe(beta, 2),
    winRate: roundSafe(winRate, 1),
    bestDay: roundSafe(bestDay, 2),
    worstDay: roundSafe(worstDay, 2),
  };
}

/**
 * 個別銘柄の詳細情報（前日比、寄与度、スパークライン等）を算出
 */
export function calculateStockDetails(
  basket: BasketItem[],
  stockUniverse: StockSeries[],
  baseValue = 1000,
  customSeries: PricePoint[] = [],
): StockDetail[] {
  const normalized = normalizeWeights(basket);
  const stockMap = new Map(stockUniverse.map((s) => [s.ticker.trim().toUpperCase(), s]));
  const normalizedCustomSeries = normalizeAnalyticsSeries(customSeries, true);
  const safeBaseValue =
    typeof baseValue === "number" && Number.isFinite(baseValue) && baseValue > 0 ? baseValue : 1000;

  // 直近の前日・当日の指数値
  const latestIndexVal =
    normalizedCustomSeries.length > 0
      ? (normalizedCustomSeries[normalizedCustomSeries.length - 1].value ??
        normalizedCustomSeries[normalizedCustomSeries.length - 1].close)
      : safeBaseValue;
  const prevIndexVal =
    normalizedCustomSeries.length > 1
      ? (normalizedCustomSeries[normalizedCustomSeries.length - 2].value ??
        normalizedCustomSeries[normalizedCustomSeries.length - 2].close)
      : latestIndexVal;

  return normalized.map((item) => {
    const stock = stockMap.get(item.ticker.trim().toUpperCase());
    const series = normalizeAnalyticsSeries(stock?.series, false);
    const len = series.length;

    const fallbackPrice =
      typeof stock?.latestPrice === "number" &&
      Number.isFinite(stock.latestPrice) &&
      stock.latestPrice > 0
        ? stock.latestPrice
        : 0;
    const currentPrice = len > 0 ? series[len - 1].close : fallbackPrice;
    const previousPrice = len > 1 ? series[len - 2].close : currentPrice;

    const rawChange = currentPrice - previousPrice;
    const change =
      Math.abs(rawChange) < 0.005 || Object.is(rawChange, -0) ? 0 : Number(rawChange.toFixed(2));
    const rawChangePct =
      previousPrice > 0 ? ((currentPrice - previousPrice) / previousPrice) * 100 : 0;
    const changePct =
      Math.abs(rawChangePct) < 0.005 || Object.is(rawChangePct, -0)
        ? 0
        : Number(rawChangePct.toFixed(2));

    // 指数への寄与度 (pt): (銘柄の騰落率 / 100) * (ウェイト / 100) * 前日指数値
    const weightFraction = item.weight / 100;
    const rawContributionPt = (changePct / 100) * weightFraction * prevIndexVal;
    const contributionPt =
      Math.abs(rawContributionPt) < 0.005 || Object.is(rawContributionPt, -0)
        ? 0
        : Number(rawContributionPt.toFixed(2));
    const contributionPct =
      prevIndexVal > 0 && Math.abs(contributionPt) >= 0.005
        ? Number(((contributionPt / prevIndexVal) * 100).toFixed(2))
        : 0;

    // スパークライン（直近10営業日分）
    const sparkline = series.slice(-10).map((p) => p.close);

    return {
      ticker: item.ticker,
      name: item.name,
      theme: item.theme || "その他",
      weight: item.weight,
      currentPrice,
      previousPrice,
      change,
      changePct,
      contributionPt,
      contributionPct,
      sparkline,
    };
  });
}
