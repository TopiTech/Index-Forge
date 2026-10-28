import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { convertPortfolioToCustomIndexBasket, type PortfolioPosition } from "./portfolioStorage";
import { isMacroAsset } from "./marketDataService";

describe("Batch 3 Comprehensive Fixes Verification", () => {
  const readSrc = (relPath: string) =>
    readFileSync(resolve(process.cwd(), "src", relPath), "utf-8");

  // ISSUE-04 is covered behaviorally by
  // `src/components/batch3ModalAuthMacro.test.tsx` → "auth modal shared state
  // path": the real Header + AuthModal + ModalBase portal prove the
  // open/close state path App wires through pageLayoutHeaderProps.

  // ISSUE-05 is covered behaviorally by
  // `src/components/batch3ModalAuthMacro.test.tsx` → "modal overlay portal
  // placement": both dialogs are asserted in `document.body` (outside the
  // React container) and re-targeted into the fullscreen host.

  describe("ISSUE-11: Macro asset portfolio registration guard & conversion protection", () => {
    // The disabled-button/handler-guard pins lived here as source strings;
    // they now render in `src/components/batch3ModalAuthMacro.test.tsx` →
    // "macro asset portfolio guard" (disabled + tooltip + no-call + contrast).
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

  // ISSUE-13 (search result clipping) and the inline-style half of ISSUE-16
  // (44px clear-button tap target) were verified here through source-string
  // pins. They now have behavioural coverage on the rendered components in
  // `src/components/searchResultClipping.test.tsx` (N-7 conversion).

  describe("ISSUE-16: SearchInput clear button 44px tap target", () => {
    // ソース構造ガード (N-7): jsdom は外部スタイルシートの算出をしないため、
    // index.css のタップターゲット規約は CSS 文字列で契約を固定する。
    // 実 DOM 側の保証 (インラインスタイル 44px) は
    // `src/components/searchResultClipping.test.tsx` が振る舞いで検証する。
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
