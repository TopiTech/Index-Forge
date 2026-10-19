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
 * magnitude, returning integers.
 *
 * Two invariants apply, and they are only jointly satisfiable when the number
 * of entries does not exceed the number of units available:
 *
 *  - every entry receives at least one unit, so a constituent never
 *    disappears from a basket;
 *  - the returned integers sum to `max(entries, total)`: the requested
 *    `total` when it can be satisfied, otherwise the smallest feasible total
 *    (one unit per entry). A basket with more constituents than percentage
 *    points cannot sum to `total` without giving an entry a zero weight.
 *
 * Non-positive or non-finite values are treated as zero magnitude.
 */
export function allocateIntegerWeights(
    values: readonly number[],
    total: number = 100,
): number[] {
    const n = values.length;
    if (n === 0) return [];

    const effectiveTotal = Number.isFinite(total) ? Math.max(n, Math.round(total)) : 100;
    const magnitudes = values.map((value) =>
        Number.isFinite(value) && value > 0 ? value : 0,
    );
    const sum = magnitudes.reduce((acc, value) => acc + value, 0);

    // Reserve 1 unit per entry so every constituent keeps a non-zero weight,
    // then proportionally split what remains.
    const reserve = n;
    const pool = Math.max(0, effectiveTotal - reserve);
    const shares = magnitudes.map((value) =>
        sum > 0 ? (value / sum) * pool : pool / n,
    );

    const result = shares.map((share) => 1 + Math.floor(share));
    let remainder =
        effectiveTotal - result.reduce((acc, weight) => acc + weight, 0);

    // Hand the leftover units to the entries with the largest fractional part.
    const order = shares
        .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
        .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let i = 0; i < order.length && remainder > 0; i++) {
        result[order[i].index] += 1;
        remainder--;
    }
    return result;
}

/** Even split of `total` across `count` entries (sum is exactly `total`). */
export function allocateEvenWeights(count: number, total: number = 100): number[] {
    return allocateIntegerWeights(new Array(Math.max(0, count)).fill(1), total);
}

/**
 * Normalizes multi-currency market capitalizations to Japanese 億円.
 * - Japanese stocks are already denominated in 億円 (100,000,000 JPY).
 * - US stocks are denominated in millions of USD ($M). At usdJpyRate (default 155),
 *   1 $M = 1,000,000 * 155 JPY = 1.55 億円.
 */
export function normalizeMarketCapToOkuYen(
    marketCap: number,
    currencyOrMarket?: string | null,
    usdJpyRate: number = 155.0,
): number {
    if (typeof marketCap !== "number" || !Number.isFinite(marketCap) || marketCap <= 0) {
        return 0;
    }
    const isUs =
        currencyOrMarket === "USD" ||
        currencyOrMarket === "US" ||
        currencyOrMarket === "$" ||
        currencyOrMarket === "USA";
    return isUs ? (marketCap * usdJpyRate) / 100 : marketCap;
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

