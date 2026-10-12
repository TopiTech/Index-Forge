import { describe, it, expect } from "vitest";
import {
  serializePortfolioToCsv,
  deserializePortfolioFromCsv,
  calculateDiversificationScore,
} from "../lib/indexSerialization";
import {
  calculatePortfolioSummary,
  type PortfolioPosition,
} from "../lib/portfolioStorage";
import fs from "fs";
import path from "path";

describe("Portfolio Manager UI/UX & Feature Enhancements", () => {
  const portfolioTsx = fs.readFileSync(
    path.resolve(__dirname, "PortfolioManagerPage.tsx"),
    "utf-8"
  );

  const samplePositions: PortfolioPosition[] = [
    {
      id: "pos-1",
      ticker: "7203",
      name: "トヨタ自動車",
      shares: 200,
      averageCost: 2450,
      acquiredAt: "2024-01-15",
    },
    {
      id: "pos-2",
      ticker: "8035",
      name: "東京エレクトロン",
      shares: 50,
      averageCost: 23800,
      acquiredAt: "2024-02-10",
    },
    {
      id: "pos-3",
      ticker: "NVDA",
      name: "NVIDIA",
      shares: 30,
      averageCost: 120,
      acquiredAt: "2024-03-01",
    },
  ];

  describe("Portfolio CSV Export & Import", () => {
    it("serializes portfolio positions to CSV accurately", () => {
      const csv = serializePortfolioToCsv(samplePositions);
      expect(csv).toContain("コード,銘柄名,保有株数,取得単価,取得日,メモ");
      expect(csv).toContain('"7203"');
      expect(csv).toContain('"トヨタ自動車"');
      expect(csv).toContain('"8035"');
      expect(csv).toContain('"NVDA"');
    });

    it("deserializes CSV back into portfolio positions with round-trip fidelity", () => {
      const csv = serializePortfolioToCsv(samplePositions);
      const parsed = deserializePortfolioFromCsv(csv);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.data).toHaveLength(3);
        expect(parsed.data[0].ticker).toBe("7203");
        expect(parsed.data[0].shares).toBe(200);
        expect(parsed.data[0].averageCost).toBe(2450);
        expect(parsed.data[1].ticker).toBe("8035");
        expect(parsed.data[2].ticker).toBe("NVDA");
      }
    });

    it("handles empty or malformed CSV without crashing", () => {
      expect(deserializePortfolioFromCsv("").ok).toBe(false);
      expect(deserializePortfolioFromCsv("ヘッダーのみでデータ行なし").ok).toBe(false);
    });
  });

  describe("Sector Allocation & Diversification HHI Scoring", () => {
    it("aggregates portfolio summary into sector allocation percentages", () => {
      const summary = calculatePortfolioSummary(samplePositions);
      expect(summary.positions.length).toBe(3);
      expect(summary.totalMarketValue).toBeGreaterThan(0);

      // Compute sector allocation similar to PortfolioManagerPage
      const sectorMap = new Map<string, number>();
      for (const pos of summary.positions) {
        const sec = pos.sector || pos.theme || "その他";
        sectorMap.set(sec, (sectorMap.get(sec) || 0) + (pos.marketValueJpy ?? pos.marketValue));
      }

      const total = summary.totalMarketValue;
      const sectors = Array.from(sectorMap.entries()).map(([name, val]) => ({
        name,
        val,
        pct: Number(((val / total) * 100).toFixed(1)),
      }));

      const sumPct = sectors.reduce((acc, s) => acc + s.pct, 0);
      expect(sumPct).toBeGreaterThanOrEqual(99.0);
      expect(sumPct).toBeLessThanOrEqual(101.0);
    });

    it("calculates diversification score for portfolio weightings", () => {
      const summary = calculatePortfolioSummary(samplePositions);
      const div = calculateDiversificationScore(
        summary.positions.map((p) => p.weightPercent)
      );

      expect(div.hhi).toBeGreaterThan(0);
      expect(div.hhi).toBeLessThanOrEqual(10000);
      expect(["HIGH", "MODERATE", "CONCENTRATED"]).toContain(div.level);
      expect(div.label).toBeTruthy();
    });
  });

  describe("PortfolioManagerPage UI Components & Markup", () => {
    it("contains CSV export and import buttons and file input", () => {
      expect(portfolioTsx).toContain("handleExportCsv");
      expect(portfolioTsx).toContain("handleImportCsv");
      expect(portfolioTsx).toContain("serializePortfolioToCsv");
      expect(portfolioTsx).toContain("deserializePortfolioFromCsv");
      expect(portfolioTsx).toContain('type="file"');
      expect(portfolioTsx).toContain('accept=".csv,text/csv"');
    });

    it("contains sector allocation breakdown and dividend projection cards", () => {
      expect(portfolioTsx).toContain("業種・セクター配分比率");
      expect(portfolioTsx).toContain("SECTOR_COLORS");
      expect(portfolioTsx).toContain("calculateDiversificationScore");
      expect(portfolioTsx).toContain("badge-diversification-high");
      expect(portfolioTsx).toContain("インカム & 年間配当受取予測");
      expect(portfolioTsx).toContain("年間予想受取総額");
      expect(portfolioTsx).toContain("月平均換算");
    });

    it("applies table-sticky-col and tabular-nums for modern mobile layout", () => {
      expect(portfolioTsx).toContain("table-sticky-col");
      expect(portfolioTsx).toContain("tabular-nums");
    });
  });
});
