import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { convertPortfolioToCustomIndexBasket, type PortfolioPosition } from "./portfolioStorage";
import { isMacroAsset } from "./marketDataService";

describe("Batch 3 Comprehensive Fixes Verification", () => {
  const readSrc = (relPath: string) =>
    readFileSync(resolve(process.cwd(), "src", relPath), "utf-8");

  describe("ISSUE-04: handleAddStockToIndex unauthenticated guard", () => {
    it("guards handleAddStockToIndex with isAuthenticated and opens auth modal", () => {
      const appSource = readSrc("App.tsx");
      expect(appSource).toMatch(
        /const handleAddStockToIndex = useCallback\(\s*\([^)]*\)\s*=>\s*\{[\s\S]*?if \(!isAuthenticated\) \{\s*setIsAuthModalOpen\(true\);\s*return;\s*\}/,
      );
    });

    it("shares isAuthModalOpen with Header through pageLayoutHeaderProps", () => {
      const appSource = readSrc("App.tsx");
      expect(appSource).toContain("isAuthModalOpen,");
      expect(appSource).toContain("onOpenAuthModal: () => setIsAuthModalOpen(true),");
      expect(appSource).toContain("onCloseAuthModal: () => setIsAuthModalOpen(false),");
    });
  });

  describe("ISSUE-05: IndexBuilderModal / TradingViewChartModal createPortal integration", () => {
    it("ports IndexBuilderModal via useOverlayRoot and createPortal", () => {
      const source = readSrc("components/IndexBuilderModal.tsx");
      expect(source).toContain('import { createPortal } from "react-dom";');
      expect(source).toContain('import { useOverlayRoot } from "./ModalBase";');
      expect(source).toContain("const overlayRoot = useOverlayRoot();");
      expect(source).toContain(
        "return overlayRoot ? createPortal(modalContent, overlayRoot) : modalContent;",
      );
    });

    it("ports TradingViewChartModal via useOverlayRoot and createPortal", () => {
      const source = readSrc("components/TradingViewChartModal.tsx");
      expect(source).toContain('import { createPortal } from "react-dom";');
      expect(source).toContain('import { useOverlayRoot } from "./ModalBase";');
      expect(source).toContain("const overlayRoot = useOverlayRoot();");
      expect(source).toContain(
        "return overlayRoot ? createPortal(modalContent, overlayRoot) : modalContent;",
      );
    });
  });

  describe("ISSUE-11: Macro asset portfolio registration guard & conversion protection", () => {
    it("disables add to portfolio button and guards handler for macro assets in StockDetailPage", () => {
      const source = readSrc("components/StockDetailPage.tsx");
      expect(source).toContain("disabled={isMacro}");
      expect(source).toContain("if (isMacro) return;");
      expect(source).toMatch(
        /title=\{isMacro \? "マクロ資産・指数・為替はポートフォリオ登録対象外です" : undefined\}/,
      );
    });

    it("filters out macro assets in convertPortfolioToCustomIndexBasket", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-1",
          ticker: "7203",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2500,
          currentPrice: 2800,
        },
        {
          id: "pos-2",
          ticker: "^N225",
          name: "日経平均株価",
          shares: 10,
          averageCost: 38000,
          currentPrice: 39000,
        },
        {
          id: "pos-3",
          ticker: "USDJPY=X",
          name: "米ドル / 円",
          shares: 1000,
          averageCost: 150,
          currentPrice: 155,
        },
        {
          id: "pos-4",
          ticker: "AAPL",
          name: "Apple Inc.",
          shares: 50,
          averageCost: 180,
          currentPrice: 220,
        },
      ];

      expect(isMacroAsset("^N225")).toBe(true);
      expect(isMacroAsset("USDJPY=X")).toBe(true);
      expect(isMacroAsset("7203")).toBe(false);
      expect(isMacroAsset("AAPL")).toBe(false);

      const basket = convertPortfolioToCustomIndexBasket(positions, 150);
      const tickers = basket.map((b) => b.ticker);

      expect(tickers).toContain("7203");
      expect(tickers).toContain("AAPL");
      expect(tickers).not.toContain("^N225");
      expect(tickers).not.toContain("USDJPY=X");
      expect(basket.reduce((sum, b) => sum + b.weight, 0)).toBe(100);
    });
  });

  describe("ISSUE-12: Mobile aside drawer WAI-ARIA landmark structure", () => {
    it("renders mobile drawer via createPortal to root overlay outside <main>", () => {
      const appSource = readSrc("App.tsx");
      expect(appSource).toContain("if (isMobileLayout) {");
      expect(appSource).toContain(
        "return overlayRoot ? createPortal(mobileContent, overlayRoot) : mobileContent;",
      );
    });
  });

  describe("ISSUE-13: Large search result clipping with MAX_SEARCH_RESULTS", () => {
    it("clips presets in AddStockModal with MAX_SEARCH_RESULTS and shows guidance message", () => {
      const source = readSrc("components/AddStockModal.tsx");
      expect(source).toContain("const MAX_SEARCH_RESULTS = 80;");
      expect(source).toContain("PRESET_STOCKS.slice(0, MAX_SEARCH_RESULTS)");
      expect(source).toContain("他 {PRESET_STOCKS.length - MAX_SEARCH_RESULTS} 件... 検索条件を絞り込んでください");
    });

    it("clips results in GlobalSearchModal with MAX_SEARCH_RESULTS and shows guidance message", () => {
      const source = readSrc("components/GlobalSearchModal.tsx");
      expect(source).toContain("const MAX_SEARCH_RESULTS = 80;");
      expect(source).toContain("filteredResults.slice(0, MAX_SEARCH_RESULTS)");
      expect(source).toContain("他 {remainingCount} 件... 検索条件を絞り込んでください");
    });
  });

  describe("ISSUE-16: SearchInput clear button 44px tap target", () => {
    it("configures minWidth and minHeight to 44px on SearchInput clear button", () => {
      const source = readSrc("components/ui.tsx");
      expect(source).toContain("minWidth: 44,");
      expect(source).toContain("minHeight: 44,");
      expect(source).toContain("paddingRight: 44");
    });

    it("defines 44px tap target styles in index.css", () => {
      const css = readSrc("index.css");
      expect(css).toContain(".input-search-clear-btn");
      expect(css).toMatch(/min-width:\s*44px/);
      expect(css).toMatch(/min-height:\s*44px/);
    });
  });

  describe("ISSUE-17: Japanese localeCompare with numeric: true", () => {
    it("specifies 'ja' locale with { numeric: true } in ConstituentsTable", () => {
      const source = readSrc("components/ConstituentsTable.tsx");
      expect(source).toContain('a.name.localeCompare(b.name, "ja", { numeric: true })');
    });

    it("specifies 'ja' locale with { numeric: true } in marketDataService", () => {
      const source = readSrc("lib/marketDataService.ts");
      expect(source).toContain('valA.localeCompare(valB, "ja", { numeric: true })');
    });

    it("specifies 'ja' locale with { numeric: true } in ThemeHeatmap", () => {
      const source = readSrc("components/ThemeHeatmap.tsx");
      expect(source).toContain('a[0].localeCompare(b[0], "ja", { numeric: true })');
    });

    it("specifies 'ja' locale with { numeric: true } in PortfolioManagerPage", () => {
      const source = readSrc("components/PortfolioManagerPage.tsx");
      expect(source).toContain('a.name.localeCompare(b.name, "ja", { numeric: true })');
    });
  });

  describe("ISSUE-18: Tiny weight inline text overflow prevention", () => {
    it("hides inline percentage weight when weight < 3% or width < 0.055 in ThemeHeatmap", () => {
      const source = readSrc("components/ThemeHeatmap.tsx");
      expect(source).toContain("const isWeightVisible = stock.weight >= 3 && layout.width >= 0.055;");
      expect(source).toContain("{isWeightVisible && (");
    });

    it("prevents overflow on theme bar segments and chips in ThemeBreakdown", () => {
      const source = readSrc("components/ThemeBreakdown.tsx");
      expect(source).toContain('overflow: "hidden"');
      expect(source).toContain('textOverflow: "ellipsis"');
      expect(source).toContain('whiteSpace: "nowrap"');
    });
  });
});
