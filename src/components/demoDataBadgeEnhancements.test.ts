import { describe, it, expect } from "vitest";
import { calculatePortfolioSummary, type PortfolioPosition } from "../lib/portfolioStorage";
import fs from "fs";
import path from "path";

describe("Demo Data Badge Enhancements (Phase 3)", () => {
  it("calculatePortfolioSummary propagates isDemoData flag from live quotes or fallback", () => {
    const mockPositions: PortfolioPosition[] = [
      {
        id: "p1",
        ticker: "7203",
        name: "トヨタ自動車",
        shares: 100,
        averageCost: 2000,
      },
      {
        id: "p2",
        ticker: "999999", // Unknown ticker
        name: "仮想デモ銘柄",
        shares: 50,
        averageCost: 1000,
      },
    ];

    const liveQuotesMap = new Map([
      [
        "7203",
        {
          price: 2500,
          change: 50,
          dps: 60,
          name: "トヨタ自動車",
          isDemoData: false,
        },
      ],
      [
        "999999",
        {
          price: 1200,
          change: 10,
          dps: 20,
          name: "仮想デモ銘柄",
          isDemoData: true,
        },
      ],
    ]);

    const summary = calculatePortfolioSummary(mockPositions, liveQuotesMap, 150);
    const toyota = summary.positions.find((p) => p.ticker === "7203");
    const demoStock = summary.positions.find((p) => p.ticker === "999999");

    expect(toyota?.isDemoData).toBe(false);
    expect(demoStock?.isDemoData).toBe(true);
  });

  it("ConstituentsTable.tsx contains 参考値 badge markup and logic for isDemoData", () => {
    const filePath = path.resolve(__dirname, "ConstituentsTable.tsx");
    const code = fs.readFileSync(filePath, "utf-8");

    expect(code).toContain("item.isDemoData");
    expect(code).toContain("参考値");
    expect(code).toContain("実データ未取得のため推計デモ値を表示しています");
  });

  it("PortfolioManagerPage.tsx contains 参考値 badge markup in positions and watchlist", () => {
    const filePath = path.resolve(__dirname, "PortfolioManagerPage.tsx");
    const code = fs.readFileSync(filePath, "utf-8");

    expect(code).toContain("p.isDemoData");
    expect(code).toContain("fund.isDemoData");
    expect(code).toContain("参考値");
  });
});
