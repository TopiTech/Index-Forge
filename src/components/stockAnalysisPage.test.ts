import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { StockAnalysisPage, type StockAnalysisPageProps } from "./StockAnalysisPage";
import type { PageView } from "../lib/navigation";

/** Compile-time contract probe: `From extends To ? true : false`. */
type IsAssignable<From, To> = From extends To ? true : false;

describe("StockAnalysisPage & Navigation Refinement Tests", () => {
  const stockAnalysisPath = resolve(__dirname, "StockAnalysisPage.tsx");
  const stockDetailPath = resolve(__dirname, "StockDetailPage.tsx");
  const appPath = resolve(__dirname, "../App.tsx");
  const indexCssPath = resolve(__dirname, "../index.css");

  const stockAnalysisTsx = readFileSync(stockAnalysisPath, "utf-8");
  const stockDetailTsx = readFileSync(stockDetailPath, "utf-8");
  const appTsx = readFileSync(appPath, "utf-8");
  const indexCss = readFileSync(indexCssPath, "utf-8");

  describe("1. Dedicated Stock Analysis Hub Component", () => {
    it("exports StockAnalysisPage component with full interactive props", () => {
      // N-7 転換: props 宣言のテキスト固定 (実装文字列ピン) を、実装テキストに
      // 依存しない型契約の検証へ置き換えた。存在・シグネチャ・optionality は
      // コンパイラ (npm run build の tsc) が保証する。
      expect(typeof StockAnalysisPage).toBe("function");
      const navContract: IsAssignable<
        StockAnalysisPageProps["onNavigate"],
        (view: PageView, searchParams?: string) => void
      > = true;
      const openContract: IsAssignable<
        StockAnalysisPageProps["onOpenStockDetail"],
        (ticker: string) => void
      > = true;
      const addIndexContract: IsAssignable<
        NonNullable<StockAnalysisPageProps["onAddToIndex"]>,
        (ticker: string, name: string, theme: string) => void
      > = true;
      const addWatchContract: IsAssignable<
        NonNullable<StockAnalysisPageProps["onAddToWatchlist"]>,
        (ticker: string) => void
      > = true;
      const addPortfolioContract: IsAssignable<
        NonNullable<StockAnalysisPageProps["onAddToPortfolio"]>,
        (ticker: string, currentPrice: number, stockName?: string) => void
      > = true;
      const optionalContract: undefined extends StockAnalysisPageProps["onAddToIndex"] ? true : false = true;
      expect(
        [navContract, openContract, addIndexContract, addWatchContract, addPortfolioContract, optionalContract].every(
          Boolean,
        ),
      ).toBe(true);
    });

    it("includes rich interactive search input and quick popular chips", () => {
      expect(stockAnalysisTsx).toContain('className="stock-analysis-search-form"');
      expect(stockAnalysisTsx).toContain('role="search"');
      expect(stockAnalysisTsx).toContain('aria-label="銘柄検索"');
      expect(stockAnalysisTsx).toContain("POPULAR_SEARCH_CHIPS");
      expect(stockAnalysisTsx).toContain("7203");
      expect(stockAnalysisTsx).toContain("NVDA");
      expect(stockAnalysisTsx).toContain("8035");
    });

    it("features curated theme tabs with accessible ARIA tablist semantics", () => {
      expect(stockAnalysisTsx).toContain('role="tablist"');
      expect(stockAnalysisTsx).toContain('role="tab"');
      expect(stockAnalysisTsx).toContain("THEME_TABS");
      expect(stockAnalysisTsx).toContain("SEMICONDUCTOR");
      expect(stockAnalysisTsx).toContain("AI_TECH");
      expect(stockAnalysisTsx).toContain("MOBILITY_DEFENSE");
      expect(stockAnalysisTsx).toContain("FINANCE_TRADING");
      expect(stockAnalysisTsx).toContain("HIGH_DIVIDEND");
      expect(stockAnalysisTsx).toContain("US_TECH");
    });

    it("displays top gainers, losers, and high-dividend spotlight columns", () => {
      expect(stockAnalysisTsx).toContain("topGainers");
      expect(stockAnalysisTsx).toContain("topLosers");
      expect(stockAnalysisTsx).toContain("highYieldPicks");
      expect(stockAnalysisTsx).toContain("本日の値上がり上位");
      expect(stockAnalysisTsx).toContain("本日の値下がり上位");
      expect(stockAnalysisTsx).toContain("高配当・バリュー注目株");
    });

    it("provides quick access to major market indices and forex assets", () => {
      expect(stockAnalysisTsx).toContain("MACRO_QUICK_PICKS");
      expect(stockAnalysisTsx).toContain("^N225");
      expect(stockAnalysisTsx).toContain("^TOPX");
      expect(stockAnalysisTsx).toContain("^GSPC");
      expect(stockAnalysisTsx).toContain("USDJPY=X");
    });
  });

  describe("2. Navigation Routing & App.tsx Integration", () => {
    // ソース構造ガード (N-7 明示的整理): 「StockAnalysisPage がコード分割
    // (React.lazy + 動的 import) で遅延ロードされる」はバンドル構造の契約で
    // あり、jsdom 上の振る舞いでは検証できない (静的バンドルが分割される
    // こと自体の保証)。ここではソース構造ガードとして明示的に維持する。
    it("lazy-loads StockAnalysisPage alongside StockDetailPage", () => {
      expect(appTsx).toContain("const StockAnalysisPage = lazy(");
      expect(appTsx).toContain('import("./components/StockAnalysisPage")');
    });

    it("initializes activeStockTicker as string | null without locking to 7203", () => {
      expect(appTsx).toMatch(
        /const\s*\[activeStockTicker,\s*setActiveStockTicker\]\s*=\s*useState<string\s*\|\s*null>\(\(\)\s*=>\s*\{/,
      );
      expect(appTsx).toContain("if (typeof window === \"undefined\") return null;");
      expect(appTsx).toContain("resolveStockTicker(window.location.pathname, window.location.search) || null");
    });

    it("resets activeStockTicker to null when navigating to stock without ticker parameters", () => {
      expect(appTsx).toMatch(
        /if\s*\(view\s*===\s*"stock"\)\s*\{\s*const\s+ticker\s*=\s*resolveStockTicker\(basePath,\s*searchParams\);\s*setActiveStockTicker\(ticker\s*\|\|\s*null\);\s*\}/,
      );
    });

    it("renders StockDetailPage when activeStockTicker is present, otherwise StockAnalysisPage", () => {
      expect(appTsx).toContain("{activeStockTicker ? (");
      expect(appTsx).toContain("<StockDetailPage");
      expect(appTsx).toContain("<StockAnalysisPage");
      expect(appTsx).toContain('navigateTo("stock", `?ticker=${t}`);');
    });

    it("updates activeStockTicker on popstate navigation between hub and detail", () => {
      expect(appTsx).toMatch(
        /if\s*\(newView\s*===\s*"stock"\)\s*\{[\s\S]*?setActiveStockTicker\(ticker\s*\|\|\s*null\);/,
      );
    });
  });

  describe("3. StockDetailPage Breadcrumb & Back Navigation", () => {
    it("includes 銘柄分析 in the breadcrumb list linking back to stock hub", () => {
      expect(stockDetailTsx).toContain('onClick={() => onNavigate("stock")}');
      expect(stockDetailTsx).toContain("銘柄分析");
      // Preserves existing breadcrumb links for backward compatibility
      expect(stockDetailTsx).toContain('onClick={() => onNavigate("dashboard")}');
      expect(stockDetailTsx).toContain('onClick={() => onNavigate("market")}');
      expect(stockDetailTsx).toContain('onClick={() => onNavigate("screener")}');
    });

    it("configures top back button to return to stock hub", () => {
      expect(stockDetailTsx).toMatch(
        /<button[\s\S]*?onClick=\{\(\)\s*=>\s*onNavigate\("stock"\)\}[\s\S]*?銘柄分析へ戻る/,
      );
    });
  });

  describe("4. Styling and Responsive Design", () => {
    it("defines styles for stock analysis hub page, cards, and theme tabs", () => {
      expect(indexCss).toContain(".stock-analysis-hub-page");
      expect(indexCss).toContain(".stock-analysis-hero-card");
      expect(indexCss).toContain(".stock-analysis-search-input-wrapper");
      expect(indexCss).toContain(".stock-analysis-cards-grid");
      expect(indexCss).toContain(".stock-analysis-theme-tabs");
      expect(indexCss).toContain(".stock-analysis-movers-grid");
      expect(indexCss).toContain(".stock-analysis-macro-grid");
    });
  });
});
