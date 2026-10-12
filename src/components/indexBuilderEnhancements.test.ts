import { describe, it, expect } from "vitest";
import {
  allocateMarketCapWeights,
  allocateDividendYieldWeights,
  allocateInverseVolatilityWeights,
} from "../lib/weights";
import {
  serializeIndexToJson,
  deserializeIndexFromJson,
  serializeBasketToCsv,
  deserializeBasketFromCsv,
  calculateDiversificationScore,
} from "../lib/indexSerialization";
import type { CustomIndex } from "../data/indices";
import fs from "fs";
import path from "path";

describe("IndexBuilder UI/UX & Weighting Strategy Enhancements", () => {
  const indexBuilderTsx = fs.readFileSync(
    path.resolve(__dirname, "IndexBuilderContent.tsx"),
    "utf-8"
  );

  const sampleIndex: CustomIndex = {
    id: "idx-test-1",
    name: "テスティング戦略指数",
    description: "テスト用の均等および時価総額指数",
    baseDate: "2024-01-01",
    baseValue: 1000,
    basket: [
      { ticker: "7203", name: "トヨタ自動車", theme: "モビリティ", weight: 40 },
      { ticker: "8035", name: "東京エレクトロン", theme: "半導体", weight: 35 },
      { ticker: "8306", name: "三菱UFJ FG", theme: "金融", weight: 25 },
    ],
  };

  describe("Weighting Algorithms & Math Exactness", () => {
    it("allocates market cap weights summing to exactly 100%", () => {
      const marketCaps = [45000000, 15000000, 12000000];
      const weights = allocateMarketCapWeights(marketCaps);
      expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
      expect(weights[0]).toBeGreaterThan(weights[1]);
      expect(weights[1]).toBeGreaterThan(weights[2]);
    });

    it("allocates dividend yield weights summing to exactly 100%", () => {
      const yields = [2.8, 1.9, 3.5];
      const weights = allocateDividendYieldWeights(yields);
      expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
      expect(weights[2]).toBeGreaterThan(weights[0]);
      expect(weights[0]).toBeGreaterThan(weights[1]);
    });

    it("allocates inverse volatility weights (lower risk gets higher weight)", () => {
      const volatilities = [0.15, 0.35, 0.20];
      const weights = allocateInverseVolatilityWeights(volatilities);
      expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
      expect(weights[0]).toBeGreaterThan(weights[2]);
      expect(weights[2]).toBeGreaterThan(weights[1]);
    });
  });

  describe("Index Definition Serialization & Recovery", () => {
    it("exports and imports index definition via JSON without loss", () => {
      const json = serializeIndexToJson(sampleIndex);
      const res = deserializeIndexFromJson(json);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.name).toBe(sampleIndex.name);
        expect(res.data.baseValue).toBe(sampleIndex.baseValue);
        expect(res.data.basket).toHaveLength(3);
        expect(res.data.basket[0].ticker).toBe("7203");
        expect(res.data.basket[0].weight).toBe(40);
      }
    });

    it("exports and imports basket constituents via CSV", () => {
      const csv = serializeBasketToCsv(sampleIndex.basket);
      expect(csv).toContain("コード,銘柄名,テーマ,比率(%)");
      expect(csv).toContain('"7203"');

      const res = deserializeBasketFromCsv(csv);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toHaveLength(3);
        expect(res.data[0].ticker).toBe("7203");
        expect(res.data[0].weight).toBe(40);
        expect(res.data[1].ticker).toBe("8035");
        expect(res.data[2].ticker).toBe("8306");
      }
    });

    it("evaluates HHI diversification metrics", () => {
      const div = calculateDiversificationScore(sampleIndex.basket.map((b) => b.weight));
      expect(div.hhi).toBe(40 * 40 + 35 * 35 + 25 * 25); // 1600 + 1225 + 625 = 3450
      expect(div.level).toBe("CONCENTRATED");
      expect(div.label).toBe("特定銘柄に集中");
    });
  });

  describe("IndexBuilderContent UI Controls & Markup", () => {
    it("contains strategy selector presets (均等, 時価総額, 高配当, 100%再配分)", () => {
      expect(indexBuilderTsx).toContain("handleEqualWeight");
      expect(indexBuilderTsx).toContain("handleMarketCapWeight");
      expect(indexBuilderTsx).toContain("handleDividendYieldWeight");
      expect(indexBuilderTsx).toContain("handleNormalizeWeights");
    });

    it("contains export & import toolbar for JSON and CSV", () => {
      expect(indexBuilderTsx).toContain("handleExportJson");
      expect(indexBuilderTsx).toContain("handleExportCsv");
      expect(indexBuilderTsx).toContain("handleImportFile");
      expect(indexBuilderTsx).toContain("calculateDiversificationScore");
      expect(indexBuilderTsx).toContain("provenance-pill");
    });
  });
});
