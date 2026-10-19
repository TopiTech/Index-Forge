/**
 * Regression tests for the persistence and weight-allocation hardening:
 *
 * - a stored position without an id gets a unique one, so two lots of the same
 *   stock no longer share an id (duplicate React keys, and a delete that
 *   removed both lots);
 * - the integer weight allocation documents and satisfies the sum it can
 *   actually reach;
 * - the exact redistribution never emits a zero weight, which the Worker
 *   rejects with a 400;
 * - a CSV round trip keeps a legitimate leading apostrophe;
 * - an index export written by a newer schema revision is refused instead of
 *   being silently re-weighted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeCsvCell, parseCsv } from "./csv";
import { redistributeWeightsExact } from "./indexEngine";
import {
  INDEX_EXPORT_VERSION,
  deserializeIndexFromJson,
  serializeIndexToJson,
} from "./indexSerialization";
import {
  STORAGE_KEY_PORTFOLIO,
  createPortfolioPositionId,
  loadPortfolioPositions,
} from "./portfolioStorage";
import { allocateIntegerWeights } from "./weights";
import type { CustomIndex } from "../data/indices";

let store: Record<string, string> = {};

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("portfolio position ids", () => {
  it("builds a different id for every position", () => {
    const first = createPortfolioPositionId("7203", 10);
    const second = createPortfolioPositionId("7203", 10);

    expect(first).not.toBe(second);
    expect(first.startsWith("pos-7203-10-")).toBe(true);
  });

  it("gives distinct ids to two stored lots of the same stock", () => {
    store[STORAGE_KEY_PORTFOLIO] = JSON.stringify([
      { ticker: "7203", name: "トヨタ自動車", shares: 10, averageCost: 2500 },
      { ticker: "7203", name: "トヨタ自動車", shares: 10, averageCost: 2500 },
    ]);

    const positions = loadPortfolioPositions();

    expect(positions).toHaveLength(2);
    expect(positions[0].id).not.toBe(positions[1].id);
  });
});

describe("allocateIntegerWeights", () => {
  it("sums to the requested total when it can be satisfied", () => {
    const weights = allocateIntegerWeights([15, 25, 35], 100);

    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(100);
    expect(weights.every((weight) => weight >= 1)).toBe(true);
  });

  it("keeps every entry non-zero and sums to the smallest feasible total", () => {
    const weights = allocateIntegerWeights([1, 2, 3, 4, 5], 3);

    // Five entries cannot share three units, so the smallest feasible total
    // (one unit each) is returned instead of a total that would require a
    // zero weight.
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(5);
    expect(weights.every((weight) => weight >= 1)).toBe(true);
  });

  it("returns an empty allocation for an empty input", () => {
    expect(allocateIntegerWeights([], 100)).toEqual([]);
  });
});

describe("redistributeWeightsExact", () => {
  it("never emits a zero weight", () => {
    // A basket with many tiny constituents used to floor some of them to zero,
    // which the Worker rejects (weight must be > 0).
    const items = [
      { weight: 99.99 },
      ...new Array(199).fill(0).map(() => ({ weight: 0.005 })),
    ];

    const redistributed = redistributeWeightsExact(items);

    expect(redistributed.every((item) => item.weight > 0)).toBe(true);
    const sum = redistributed.reduce((total, item) => total + item.weight, 0);
    expect(sum).toBeCloseTo(100, 2);
  });

  it("sums to exactly 100 for a normal basket", () => {
    const redistributed = redistributeWeightsExact([{ weight: 15 }, { weight: 25 }, { weight: 35 }]);

    const sum = redistributed.reduce((total, item) => total + item.weight, 0);
    expect(sum).toBeCloseTo(100, 2);
    expect(redistributed.every((item) => item.weight > 0)).toBe(true);
  });
});

describe("CSV round trip", () => {
  it("keeps a legitimate leading apostrophe", () => {
    const value = "'-review";
    const parsed = parseCsv(`${escapeCsvCell(value)}\n`);

    expect(parsed[0][0]).toBe(value);
  });

  it("keeps a leading apostrophe that is not followed by a formula character", () => {
    const value = "'Tis the season";
    const parsed = parseCsv(`${escapeCsvCell(value)}\n`);

    expect(parsed[0][0]).toBe(value);
  });

  it("still neutralizes a formula trigger", () => {
    const parsed = parseCsv(`${escapeCsvCell("=1+1")}\n`);

    // The guard apostrophe is removed on import, the formula itself is kept.
    expect(parsed[0][0]).toBe("=1+1");
  });

  it("keeps plain numbers unprefixed so they stay numeric", () => {
    expect(escapeCsvCell("-2.56")).toBe('"-2.56"');
  });
});

describe("index export version", () => {
  const index: CustomIndex = {
    id: "custom-1",
    name: "テスト指数",
    description: "説明",
    baseValue: 1000,
    basket: [{ ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 100 }],
  };

  it("stamps the current version on export", () => {
    const exported = JSON.parse(serializeIndexToJson(index)) as { version: number };
    expect(exported.version).toBe(INDEX_EXPORT_VERSION);
  });

  it("imports a file without a version (written before the field existed)", () => {
    const legacy = JSON.stringify({
      id: "custom-1",
      name: "テスト指数",
      description: "説明",
      baseValue: 1000,
      basket: [{ ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 100 }],
    });

    const result = deserializeIndexFromJson(legacy);
    expect(result.ok).toBe(true);
  });

  it("refuses a file written by a newer schema revision", () => {
    const future = JSON.stringify({
      version: INDEX_EXPORT_VERSION + 1,
      id: "custom-1",
      name: "テスト指数",
      description: "説明",
      baseValue: 1000,
      basket: [{ ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 100 }],
    });

    const result = deserializeIndexFromJson(future);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("バージョン");
    }
  });
});
