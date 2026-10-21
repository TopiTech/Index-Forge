import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  registerUniverseLookup,
  getRegisteredUniverseStock,
  getStockFundamentals,
} from "./marketDataService";
import type { UniverseStock } from "../data/stockUniverse";

describe("stockUniverse Decoupling & Registration (PERF-01 / PERF-02)", () => {
  const sampleStock: UniverseStock = {
    ticker: "9999",
    name: "カスタムテスト銘柄",
    market: "STANDARD",
    sector: "テストセクター",
    aliases: "test alias",
  };

  beforeEach(() => {
    // Reset or register mock lookup
    registerUniverseLookup((ticker: string) => {
      if (ticker === "9999") {
        return sampleStock;
      }
      return undefined;
    });
  });

  it("resolves registered stock via getRegisteredUniverseStock", () => {
    const found = getRegisteredUniverseStock("9999");
    expect(found).toBeDefined();
    expect(found?.name).toBe("カスタムテスト銘柄");
    expect(found?.sector).toBe("テストセクター");

    const notFound = getRegisteredUniverseStock("UNKNOWN_TICKER");
    expect(notFound).toBeUndefined();
  });

  it("uses registered universe stock metadata in getStockFundamentals", () => {
    const fund = getStockFundamentals("9999");
    expect(fund.ticker).toBe("9999");
    expect(fund.name).toBe("カスタムテスト銘柄");
    expect(fund.theme).toBe("テストセクター");
    expect(fund.market).toBe("STANDARD");
  });

  it("gracefully falls back when ticker is unknown to the registry", () => {
    const fund = getStockFundamentals("8888");
    expect(fund.ticker).toBe("8888");
    expect(fund.name).toBe("銘柄 8888");
    expect(fund.theme).toBe("株式");
    expect(fund.market).toBe("PRIME");
  });

  it("ensures marketDataService.ts does NOT statically import from stockUniverse", () => {
    const filePath = resolve(__dirname, "marketDataService.ts");
    const content = readFileSync(filePath, "utf-8");

    // Match static imports like: import { ... } from "../data/stockUniverse"
    // Disallow static imports that pull value exports from stockUniverse
    const staticImportRegex = /^import\s+(?!type\s+).*\s+from\s+['"].*\/stockUniverse['"]/m;
    const match = content.match(staticImportRegex);
    expect(match).toBeNull();
  });
});
