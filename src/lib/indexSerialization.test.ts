import { describe, it, expect } from "vitest";
import {
  serializeIndexToJson,
  deserializeIndexFromJson,
  serializeBasketToCsv,
  deserializeBasketFromCsv,
  serializePortfolioToCsv,
  deserializePortfolioFromCsv,
  calculateDiversificationScore,
} from "./indexSerialization";
import type { CustomIndex } from "../data/indices";
import type { PortfolioPosition } from "./portfolioStorage";

describe("indexSerialization", () => {
  const sampleIndex: CustomIndex = {
    id: "sample-semi",
    name: "半導体厳選指数",
    description: "テスト用独自指数",
    baseValue: 1000,
    basket: [
      { ticker: "8035", name: "東京エレクトロン", theme: "製造装置", weight: 60 },
      { ticker: "6857", name: "アドバンテスト", theme: "検査装置", weight: 40 },
    ],
  };

  it("serializes and deserializes CustomIndex JSON losslessly", () => {
    const json = serializeIndexToJson(sampleIndex);
    expect(json).toContain("半導体厳選指数");
    expect(json).toContain("8035");

    const result = deserializeIndexFromJson(json);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.name).toBe("半導体厳選指数");
    expect(result.data?.basket.length).toBe(2);
    expect(result.data?.basket[0].ticker).toBe("8035");
    expect(result.data?.basket[0].weight).toBe(60);
  });

  it("rejects invalid JSON inputs with friendly error messages", () => {
    expect(deserializeIndexFromJson("").ok).toBe(false);
    expect(deserializeIndexFromJson("invalid json{").ok).toBe(false);
    expect(deserializeIndexFromJson(JSON.stringify({ name: "" })).ok).toBe(false);
    expect(deserializeIndexFromJson(JSON.stringify({ name: "テスト", basket: [] })).ok).toBe(false);
  });

  it("serializes and deserializes basket CSV", () => {
    const csv = serializeBasketToCsv(sampleIndex.basket);
    expect(csv).toContain("8035");
    expect(csv).toContain("東京エレクトロン");

    const parsed = deserializeBasketFromCsv(csv);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.length).toBe(2);
    expect(parsed.data?.[0].ticker).toBe("8035");
    expect(parsed.data?.[0].weight).toBe(60);
  });

  it("serializes and deserializes portfolio CSV", () => {
    const samplePositions: PortfolioPosition[] = [
      {
        id: "pos-1",
        ticker: "7203",
        name: "トヨタ自動車",
        shares: 100,
        averageCost: 2800,
        acquiredAt: "2024-01-15",
        notes: "NISA枠",
      },
      {
        id: "pos-2",
        ticker: "9984",
        name: "ソフトバンクグループ",
        shares: 50,
        averageCost: 8500,
      },
    ];

    const csv = serializePortfolioToCsv(samplePositions);
    expect(csv).toContain("7203");
    expect(csv).toContain("トヨタ自動車");
    expect(csv).toContain("NISA枠");

    const parsed = deserializePortfolioFromCsv(csv);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.length).toBe(2);
    expect(parsed.data?.[0].ticker).toBe("7203");
    expect(parsed.data?.[0].shares).toBe(100);
    expect(parsed.data?.[0].averageCost).toBe(2800);
    expect(parsed.data?.[0].notes).toBe("NISA枠");
  });

  it("calculates HHI diversification scores accurately", () => {
    // 10 stocks equally weighted (10% each): HHI = 10 * 10^2 = 1000 (Highly diversified)
    const diversified = calculateDiversificationScore([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
    expect(diversified.hhi).toBe(1000);
    expect(diversified.level).toBe("HIGH");
    expect(diversified.label).toBe("高度に分散");
    expect(diversified.effectiveConstituentCount).toBe(10);

    // 1 stock 100%: HHI = 100^2 = 10000 (Concentrated)
    const concentrated = calculateDiversificationScore([100]);
    expect(concentrated.hhi).toBe(10000);
    expect(concentrated.level).toBe("CONCENTRATED");
    expect(concentrated.effectiveConstituentCount).toBe(1);

    // 2 stocks (70%, 30%): HHI = 4900 + 900 = 5800 (Concentrated)
    const twoStocks = calculateDiversificationScore([70, 30]);
    expect(twoStocks.hhi).toBe(5800);
    expect(twoStocks.level).toBe("CONCENTRATED");

    // 5 stocks (20% each): HHI = 5 * 400 = 2000 (Moderately diversified)
    const moderate = calculateDiversificationScore([20, 20, 20, 20, 20]);
    expect(moderate.hhi).toBe(2000);
    expect(moderate.level).toBe("MODERATE");
  });
});
