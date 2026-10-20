import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_INDICES } from "../data/indices";

/**
 * DATA-15: the client-side fallback of `nikkei-175` must stay identical to the
 * seeded index.
 *
 * `seed.sql` is the server-side source of truth (175 constituents, weights
 * summing to 100). `src/data/indices.ts` reproduces it so the UI can render
 * the index before (or instead of) the API response. When the two drift, the
 * user sees a different index than the one the database holds, so the parity is
 * asserted here instead of being left to a comment.
 */
interface SeedRow {
  ticker: string;
  name: string;
  weight: number;
  theme: string;
}

function readSeedBasketRows(indexId: string): SeedRow[] {
  const seedPath = path.resolve(__dirname, "../../seed.sql");
  const sql = fs.readFileSync(seedPath, "utf-8");
  const rowPattern = new RegExp(
    `\\('${indexId}',\\s*'([^']*)',\\s*'([^']*)',\\s*([0-9.]+),\\s*'([^']*)'\\)`,
    "g",
  );
  const rows: SeedRow[] = [];
  for (const match of sql.matchAll(rowPattern)) {
    rows.push({
      ticker: match[1],
      name: match[2],
      weight: Number(match[3]),
      theme: match[4],
    });
  }
  return rows;
}

describe("nikkei-175: client fallback vs seed.sql", () => {
  const seedRows = readSeedBasketRows("nikkei-175");

  it("seeds 175 constituents", () => {
    expect(seedRows).toHaveLength(175);
  });

  it("matches the client fallback exactly (ticker, name, weight, theme, order)", () => {
    const fallback = DEFAULT_INDICES.find((index) => index.id === "nikkei-175");
    expect(fallback).toBeDefined();
    const clientRows = (fallback?.basket ?? []).map((item) => ({
      ticker: item.ticker,
      name: item.name,
      weight: Number(item.weight),
      theme: item.theme ?? "",
    }));

    expect(clientRows).toHaveLength(seedRows.length);
    expect(clientRows).toEqual(seedRows);
  });

  it("keeps the seeded weights summing to 100", () => {
    const total = seedRows.reduce((sum, row) => sum + row.weight, 0);
    expect(Math.round(total * 100) / 100).toBe(100);
  });

  it("keeps every built-in index's weights summing to 100", () => {
    for (const index of DEFAULT_INDICES) {
      const total = index.basket.reduce((sum, item) => sum + Number(item.weight), 0);
      expect(
        Math.round(total * 100) / 100,
        `${index.id} の重み合計が100ではありません`,
      ).toBe(100);
    }
  });
});
