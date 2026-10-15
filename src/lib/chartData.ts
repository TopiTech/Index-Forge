import type { PricePoint } from "../types";

export type ChartPoint = {
  date: string;
  value: number;
  nikkei: number;
  close: number;
};

export function buildChartData(
  nikkeiSeries: PricePoint[],
  customSeries: PricePoint[],
  baseValue: number,
): ChartPoint[] {
  if (nikkeiSeries.length === 0 || customSeries.length === 0) return [];
  const safeBase = typeof baseValue === "number" && Number.isFinite(baseValue) && baseValue > 0 ? baseValue : 1000;

  const sortedNikkei = [...nikkeiSeries].sort((a, b) => a.date.localeCompare(b.date));
  const sortedCustom = [...customSeries].sort((a, b) => a.date.localeCompare(b.date));

  // Filter customSeries to start from the benchmark start date to avoid flat dummy lines
  // when customSeries has older historical data than nikkeiSeries.
  const minNikkeiDate = sortedNikkei[0]?.date;
  const alignedCustom = minNikkeiDate
    ? sortedCustom.filter((p) => p.date >= minNikkeiDate)
    : sortedCustom;

  if (alignedCustom.length === 0) return [];

  const nikkeiMap = new Map(sortedNikkei.map((p) => [p.date, p.close]));

  // Find the benchmark baseline price corresponding to the first date of alignedCustom.
  // If the benchmark market was closed on startDate (e.g. US market holiday for S&P 500),
  // pick the most recent benchmark price on or immediately before startDate.
  const startDate = alignedCustom[0]?.date;
  let firstNikkei = 0;
  if (startDate) {
    for (const p of sortedNikkei) {
      if (p.date <= startDate && p.close > 0) {
        firstNikkei = p.close;
      } else if (p.date > startDate) {
        break;
      }
    }
  }
  if (firstNikkei <= 0) {
    firstNikkei = sortedNikkei.find((p) => p.close > 0)?.close || safeBase;
  }

  let lastKnownClose: number = firstNikkei;
  return alignedCustom.map((point) => {
    const nikkeiClose = nikkeiMap.get(point.date);
    if (nikkeiClose !== undefined && nikkeiClose > 0) {
      lastKnownClose = nikkeiClose;
    }
    const nikkeiPoint = nikkeiClose && nikkeiClose > 0 ? nikkeiClose : lastKnownClose;
    const rawVal = point.value ?? point.close;
    const customVal = typeof rawVal === "number" && Number.isFinite(rawVal) && rawVal > 0 ? rawVal : safeBase;

    return {
      date: point.date,
      value: customVal,
      close: customVal,
      nikkei: Number((safeBase * (nikkeiPoint / firstNikkei)).toFixed(2)),
    };
  });
}

/**
 * Downsample timeseries points using Largest-Triangle-Three-Buckets (LTTB) algorithm.
 * Preserves visual peaks, troughs, and overall trend while significantly reducing SVG path / DOM node count.
 */
export function downsampleLTTB<T extends { date: string; value: number }>(
  data: T[],
  threshold: number = 200,
): T[] {
  if (data.length <= threshold || threshold < 3) return data;

  const sampled: T[] = [];
  const bucketSize = (data.length - 2) / (threshold - 2);

  let aIndex = 0;
  sampled.push(data[aIndex]); // Always add the first point

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate average for the next bucket (c)
    const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);

    let avgX = 0;
    let avgY = 0;
    const nextBucketLength = nextBucketEnd - nextBucketStart;

    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      avgX += j;
      const val = data[j]?.value;
      avgY += Number.isFinite(val) ? (val as number) : 0;
    }
    if (nextBucketLength > 0) {
      avgX /= nextBucketLength;
      avgY /= nextBucketLength;
    }

    // Find the point in current bucket (b) that has the largest triangle area with a and avg(c)
    const currentBucketStart = Math.floor(i * bucketSize) + 1;
    const currentBucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length);

    const aPoint = data[aIndex];
    const aVal = Number.isFinite(aPoint?.value) ? aPoint.value : 0;
    let maxArea = -1;
    let maxAreaIndex = Math.min(currentBucketStart, data.length - 1);

    for (let j = currentBucketStart; j < currentBucketEnd; j++) {
      const bPoint = data[j];
      if (!bPoint) continue;
      const bVal = Number.isFinite(bPoint.value) ? bPoint.value : 0;
      const area = Math.abs(
        (aIndex - avgX) * (bVal - aVal) -
        (aIndex - j) * (avgY - aVal),
      ) * 0.5;

      if (Number.isFinite(area) && area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    sampled.push(data[maxAreaIndex]);
    aIndex = maxAreaIndex; // Next a is this bucket's chosen point
  }

  sampled.push(data[data.length - 1]); // Always add the last point
  return sampled;
}
