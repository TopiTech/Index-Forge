import { describe, it, expect } from "vitest";
import { allocateIntegerWeights, allocateEvenWeights } from "./weights";

describe("allocateIntegerWeights", () => {
    it("sums to exactly 100 for sizes where naive rounding drifts", () => {
        for (let n = 1; n <= 13; n++) {
            const values = Array.from({ length: n }, (_, i) => (i + 1) * 1000);
            const weights = allocateIntegerWeights(values);
            expect(weights).toHaveLength(n);
            expect(weights.reduce((sum, w) => sum + w, 0)).toBe(100);
            expect(weights.every((w) => w >= 1)).toBe(true);
        }
    });

    it("splits proportional to magnitude", () => {
        const [big, small] = allocateIntegerWeights([900, 100]);
        expect(big).toBeGreaterThan(small);
        expect(big + small).toBe(100);
    });

    it("distributes evenly when all values are equal or zero", () => {
        const equal = allocateIntegerWeights([5, 5, 5]);
        // The remainder unit goes to the earliest index on ties.
        expect(equal).toEqual([34, 33, 33]);
        expect(equal.reduce((sum, w) => sum + w, 0)).toBe(100);

        const zeros = allocateIntegerWeights([0, 0, 0, 0]);
        expect(zeros.reduce((sum, w) => sum + w, 0)).toBe(100);
        expect(zeros.every((w) => w >= 1)).toBe(true);
    });

    it("keeps every entry non-zero even for a tiny total", () => {
        // More entries than the requested total cannot each get a unit of 100;
        // the function still returns one positive weight per entry.
        const weights = allocateIntegerWeights([1, 2, 3, 4, 5], 3);
        expect(weights).toHaveLength(5);
        expect(weights.every((w) => w >= 1)).toBe(true);
    });

    it("ignores non-finite magnitudes without producing NaN", () => {
        const weights = allocateIntegerWeights([Number.NaN, 50, Number.POSITIVE_INFINITY]);
        expect(weights.every((w) => Number.isFinite(w) && w >= 1)).toBe(true);
        expect(weights.reduce((sum, w) => sum + w, 0)).toBe(100);
    });

    it("returns an empty list for no entries", () => {
        expect(allocateIntegerWeights([])).toEqual([]);
    });
});

describe("allocateEvenWeights", () => {
    it("splits evenly with an exact total", () => {
        expect(allocateEvenWeights(3)).toEqual([34, 33, 33]);
        expect(allocateEvenWeights(7).reduce((sum, w) => sum + w, 0)).toBe(100);
        expect(allocateEvenWeights(1)).toEqual([100]);
        expect(allocateEvenWeights(0)).toEqual([]);
    });
});
