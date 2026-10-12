/**
 * Integer weight allocation helpers.
 *
 * Index baskets, portfolio exports and screener batch exports all need
 * weights that add up to exactly 100. Rounding each share independently
 * (e.g. `Math.round(100 / n)`) drifts away from 100 for many sizes (n = 3
 * yields 99, n = 6 yields 98), which downstream normalization then has to
 * absorb silently. These helpers use the largest-remainder method so the
 * total is exact, and guarantee at least 1 unit per entry so a constituent
 * never disappears from a basket.
 */

/**
 * Distributes `total` across `values` proportionally to their positive
 * magnitude, returning integers whose sum is exactly `total`.
 * Non-positive or non-finite values are treated as zero magnitude.
 */
export function allocateIntegerWeights(
    values: readonly number[],
    total: number = 100,
): number[] {
    const n = values.length;
    if (n === 0) return [];

    const safeTotal = Number.isFinite(total) ? Math.max(n, Math.round(total)) : 100;
    const magnitudes = values.map((value) =>
        Number.isFinite(value) && value > 0 ? value : 0,
    );
    const sum = magnitudes.reduce((acc, value) => acc + value, 0);

    // Reserve 1 unit per entry so every constituent keeps a non-zero weight,
    // then proportionally split what remains.
    const reserve = n;
    const pool = Math.max(0, safeTotal - reserve);
    const shares = magnitudes.map((value) =>
        sum > 0 ? (value / sum) * pool : pool / n,
    );

    const result = shares.map((share) => 1 + Math.floor(share));
    let remainder =
        safeTotal - result.reduce((acc, weight) => acc + weight, 0);

    // Hand the leftover units to the entries with the largest fractional part.
    const order = shares
        .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
        .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let i = 0; i < order.length && remainder > 0; i++) {
        result[order[i].index] += 1;
        remainder--;
    }
    // If `total` was smaller than the number of entries we still owe units;
    // wrap around so the sum matches `total` exactly in every case.
    for (let i = 0; remainder > 0; i = (i + 1) % n) {
        result[i] += 1;
        remainder--;
    }
    return result;
}

/** Even split of `total` across `count` entries (sum is exactly `total`). */
export function allocateEvenWeights(count: number, total: number = 100): number[] {
    return allocateIntegerWeights(new Array(Math.max(0, count)).fill(1), total);
}

/**
 * Distributes `total` proportionally to market capitalizations (時価総額加重).
 * Non-positive values fall back to an equal share of the remaining pool.
 */
export function allocateMarketCapWeights(
    marketCaps: readonly number[],
    total: number = 100,
): number[] {
    return allocateIntegerWeights(marketCaps, total);
}

/**
 * Distributes `total` proportionally to dividend yields (高配当加重).
 * Non-positive yields receive the guaranteed minimum 1% unit.
 */
export function allocateDividendYieldWeights(
    yields: readonly number[],
    total: number = 100,
): number[] {
    return allocateIntegerWeights(yields, total);
}

/**
 * Distributes `total` inversely proportional to volatility (リスクパリティ/リスク抑制加重).
 * Lower volatility stocks receive higher weights. Non-positive or infinite values
 * receive an equal baseline share.
 */
export function allocateInverseVolatilityWeights(
    volatilities: readonly number[],
    total: number = 100,
): number[] {
    const inverse = volatilities.map((v) =>
        Number.isFinite(v) && v > 0 ? 1 / v : 0,
    );
    return allocateIntegerWeights(inverse, total);
}

