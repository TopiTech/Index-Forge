import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import path from "path";
import { DataFreshness } from "../components/DataFreshness";
import {
  FreshnessProvider,
  useActiveFreshness,
  VIEW_DEFAULT_TYPE_LABELS,
  type TabFreshness,
} from "../contexts/FreshnessContext";

describe("Tab Data Freshness Enhancement & Permanent Loading Fix", () => {
  describe("1. DataFreshness Component Flexibility & Loading Fix", () => {
    it("renders formatted timestamp and LIVE badge when numeric updatedAt is provided", () => {
      // Use explicit JST (+09:00) ISO string to avoid local timezone drift in CI runners (e.g. UTC)
      const fixedTimestamp = Date.parse("2026-10-18T11:30:00+09:00");
      const html = renderToStaticMarkup(
        React.createElement(DataFreshness, {
          updatedAt: fixedTimestamp,
          typeLabel: "市況サマリー",
        })
      );

      expect(html).toContain("LIVE");
      expect(html).toContain("市況サマリー");
      expect(html).toContain("2026/10/18 11:30");
      expect(html).not.toContain("更新情報を取得中");
      expect(html).not.toContain("animate-spin");
    });

    it("accepts ISO string updatedAt and formats it properly", () => {
      const isoStr = "2026-10-18T02:30:00.000Z";
      const html = renderToStaticMarkup(
        React.createElement(DataFreshness, {
          updatedAt: isoStr,
          typeLabel: "銘柄分析",
        })
      );

      expect(html).toContain("LIVE");
      expect(html).toContain("銘柄分析");
      expect(html).toContain("最終更新");
      expect(html).not.toContain("更新情報を取得中");
    });

    it("defaults typeLabel to 日足終値 for backwards compatibility", () => {
      const html = renderToStaticMarkup(
        React.createElement(DataFreshness, {
          benchmarkUpdatedAt: 1700000000000,
        })
      );
      expect(html).toContain("日足終値");
    });

    it("shows データ更新中 and spinner when loading or syncing", () => {
      const htmlLoading = renderToStaticMarkup(
        React.createElement(DataFreshness, {
          loading: true,
          typeLabel: "スクリーナー",
        })
      );
      expect(htmlLoading).toContain("データ更新中");
      expect(htmlLoading).toContain("animate-spin");
      expect(htmlLoading).toContain("スクリーナー");

      const htmlSyncing = renderToStaticMarkup(
        React.createElement(DataFreshness, {
          syncing: true,
          typeLabel: "ポートフォリオ",
        })
      );
      expect(htmlSyncing).toContain("データ更新中");
      expect(htmlSyncing).toContain("animate-spin");
      expect(htmlSyncing).toContain("ポートフォリオ");
    });

    it("shows STANDBY when stale", () => {
      const html = renderToStaticMarkup(
        React.createElement(DataFreshness, {
          stale: true,
          typeLabel: "経済カレンダー",
        })
      );
      expect(html).toContain("STANDBY");
      expect(html).toContain("最新データを取得できず、古いキャッシュを表示中");
      expect(html).toContain("経済カレンダー");
    });

    it("CRITICAL FIX: displays normal standby state rather than permanent loading when timestamps are empty and not updating", () => {
      // In previous versions, empty timestamps with loading=false rendered '更新情報を取得中'
      // causing tabs outside dashboard to be permanently locked in a pseudo-loading state.
      const html = renderToStaticMarkup(
        React.createElement(DataFreshness, {
          benchmarkUpdatedAt: null,
          calculationUpdatedAt: null,
          updatedAt: null,
          loading: false,
          syncing: false,
          stale: false,
          typeLabel: "市況サマリー",
        })
      );

      expect(html).not.toContain("更新情報を取得中");
      expect(html).not.toContain("animate-spin");
      expect(html).toContain("最新データ準備完了");
      expect(html).toContain("市況サマリー");
    });

    it("honors customStatusText when supplied", () => {
      const html = renderToStaticMarkup(
        React.createElement(DataFreshness, {
          loading: false,
          customStatusText: "外部ソース待機中",
          typeLabel: "指数試算",
        })
      );
      expect(html).toContain("外部ソース待機中");
      expect(html).toContain("指数試算");
    });
  });

  describe("2. Tab-Aware Freshness Context & Resolution", () => {
    it("provides predefined type labels for all application views", () => {
      expect(VIEW_DEFAULT_TYPE_LABELS.dashboard).toBe("日足終値");
      expect(VIEW_DEFAULT_TYPE_LABELS.market).toBe("市況サマリー");
      expect(VIEW_DEFAULT_TYPE_LABELS.stock).toBe("銘柄分析");
      expect(VIEW_DEFAULT_TYPE_LABELS.calendar).toBe("経済カレンダー");
      expect(VIEW_DEFAULT_TYPE_LABELS.screener).toBe("スクリーナー");
      expect(VIEW_DEFAULT_TYPE_LABELS.portfolio).toBe("ポートフォリオ");
      expect(VIEW_DEFAULT_TYPE_LABELS.builder).toBe("指数試算");
    });

    function TestFreshnessConsumer({
      view,
      explicitProps,
      onResolved,
    }: {
      view: any;
      explicitProps?: Partial<TabFreshness>;
      onResolved: (f: TabFreshness) => void;
    }) {
      const freshness = useActiveFreshness(view, explicitProps);
      onResolved(freshness);
      return React.createElement("div", null, freshness.typeLabel);
    }

    it("resolves default typeLabel and global fallback timestamp when view has no explicit registration", () => {
      let resolved: TabFreshness | undefined;
      renderToStaticMarkup(
        React.createElement(
          FreshnessProvider,
          null,
          React.createElement(TestFreshnessConsumer, {
            view: "market",
            onResolved: (f: TabFreshness) => {
              resolved = f;
            },
          })
        )
      );

      expect(resolved).toBeDefined();
      expect(resolved?.typeLabel).toBe("市況サマリー");
      expect(resolved?.loading).toBe(false);
      // Must not be empty, falls back to global timestamp so it doesn't freeze in loading
      expect(resolved?.updatedAt).toBeTruthy();
    });

    it("prioritizes dashboard benchmark & calculation props when on dashboard view", () => {
      let resolved: TabFreshness | undefined;
      const benchmarkTs = 1710000000000;
      const calcTs = 1710000050000;

      renderToStaticMarkup(
        React.createElement(
          FreshnessProvider,
          null,
          React.createElement(TestFreshnessConsumer, {
            view: "dashboard",
            explicitProps: {
              benchmarkUpdatedAt: benchmarkTs,
              calculationUpdatedAt: calcTs,
              loading: true,
            },
            onResolved: (f: TabFreshness) => {
              resolved = f;
            },
          })
        )
      );

      expect(resolved?.typeLabel).toBe("日足終値");
      expect(resolved?.benchmarkUpdatedAt).toBe(benchmarkTs);
      expect(resolved?.calculationUpdatedAt).toBe(calcTs);
      expect(resolved?.loading).toBe(true);
    });
  });

  describe("3. Static Architecture & Page Integration Audit", () => {
    const srcDir = path.resolve(__dirname, "..");
    const readSrc = (file: string) => readFileSync(path.join(srcDir, file), "utf-8");

    it("verifies App.tsx wraps the app with FreshnessProvider and PageLayout uses useActiveFreshness", () => {
      const appTsx = readSrc("App.tsx");
      expect(appTsx).toContain("FreshnessProvider");
      expect(appTsx).toContain("useActiveFreshness");
      expect(appTsx).toContain("<FreshnessProvider>");
      expect(appTsx).toContain("resolvedHeaderProps");
      expect(appTsx).toContain("freshnessProps={resolvedHeaderProps}");
    });

    it("verifies PageLayout passes tab-specific typeLabel across views in App.tsx", () => {
      const appTsx = readSrc("App.tsx");
      expect(appTsx).toContain('typeLabel: "市況サマリー"');
      expect(appTsx).toContain('typeLabel: "銘柄分析"');
      expect(appTsx).toContain('typeLabel: "ポートフォリオ"');
      expect(appTsx).toContain('typeLabel: "スクリーナー"');
      expect(appTsx).toContain('typeLabel: "経済カレンダー"');
      expect(appTsx).toContain('typeLabel: "指数試算"');
      expect(appTsx).toContain('typeLabel: "日足終値"');
    });

    it("verifies Header.tsx and Sidebar.tsx support typeLabel and updatedAt", () => {
      const headerTsx = readSrc("components/Header.tsx");
      const sidebarTsx = readSrc("components/Sidebar.tsx");

      expect(headerTsx).toContain("typeLabel");
      expect(headerTsx).toContain("updatedAt");
      expect(sidebarTsx).toContain("typeLabel");
      expect(sidebarTsx).toContain("updatedAt");
    });

    it("verifies all page components register their freshness status", () => {
      const marketTsx = readSrc("components/MarketOverviewPage.tsx");
      const stockAnalysisTsx = readSrc("components/StockAnalysisPage.tsx");
      const stockDetailTsx = readSrc("components/StockDetailPage.tsx");
      const calendarTsx = readSrc("components/CalendarPage.tsx");
      const screenerTsx = readSrc("components/ScreenerPage.tsx");
      const portfolioTsx = readSrc("components/PortfolioManagerPage.tsx");
      const builderTsx = readSrc("components/IndexBuilderPage.tsx");
      const disclaimerTsx = readSrc("components/DisclaimerPage.tsx");
      const aboutPortfolioTsx = readSrc("components/PortfolioPage.tsx");
      const tutorialTsx = readSrc("components/TutorialPage.tsx");

      expect(marketTsx).toContain("useRegisterFreshness");
      expect(stockAnalysisTsx).toContain("useRegisterFreshness");
      expect(stockDetailTsx).toContain("useRegisterFreshness");
      expect(calendarTsx).toContain("useRegisterFreshness");
      expect(screenerTsx).toContain("useRegisterFreshness");
      expect(portfolioTsx).toContain("useRegisterFreshness");
      expect(builderTsx).toContain("useRegisterFreshness");
      expect(disclaimerTsx).toContain("useRegisterFreshness");
      expect(aboutPortfolioTsx).toContain("useRegisterFreshness");
      expect(tutorialTsx).toContain("useRegisterFreshness");
    });
  });
});
