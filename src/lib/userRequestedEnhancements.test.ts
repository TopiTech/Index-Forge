import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("User Requested Enhancements: Portfolio Tooltip, Menu Button, Builder Mobile & Fullscreen, TradingView Popup", () => {
  describe("1. Portfolio Button Tooltip Fix", () => {
    it("updates tooltip and aria-label to developer portfolio / self-introduction", () => {
      const headerCode = readFileSync(
        resolve(__dirname, "../components/Header.tsx"),
        "utf8",
      );
      // Ensure the incorrect string "ポートフォリオ・保有銘柄確認" is removed
      expect(headerCode).not.toContain("ポートフォリオ・保有銘柄確認");
      // Ensure the correct developer profile string is present
      expect(headerCode).toContain('title="開発者ポートフォリオ・自己紹介"');
      expect(headerCode).toContain('aria-label="開発者ポートフォリオ・自己紹介へ移動"');
    });
  });

  describe("2. Responsive Menu Button (Desktop Hidden)", () => {
    it("strictly hides mobile menu button on desktop with !important", () => {
      const cssCode = readFileSync(resolve(__dirname, "../index.css"), "utf8");
      // Desktop rule must enforce display: none !important
      expect(cssCode).toMatch(/\.header-mobile-menu-btn,\s*\.btn\.header-mobile-menu-btn\s*\{[^}]*display:\s*none\s*!important/);
      // Media query (max-width: 768px) must show it with inline-flex !important
      expect(cssCode).toContain("@media (max-width: 768px)");
      expect(cssCode).toMatch(/\.header-mobile-menu-btn,\s*\.btn\.header-mobile-menu-btn\s*\{[^}]*display:\s*inline-flex\s*!important/);
    });
  });

  describe("3. Index Builder Mobile Enhancement & Fullscreen Mode", () => {
    it("adds fullscreen toggle to IndexBuilderPage", () => {
      const pageCode = readFileSync(
        resolve(__dirname, "../components/IndexBuilderPage.tsx"),
        "utf8",
      );
      expect(pageCode).toContain("isFullscreen");
      expect(pageCode).toContain("builder-fullscreen-btn");
      expect(pageCode).toContain("全画面表示");
      expect(pageCode).toContain("全画面解除");
      expect(pageCode).toContain("is-fullscreen");
    });

    it("enhances mobile tabs and basket rows in IndexBuilderContent", () => {
      const contentCode = readFileSync(
        resolve(__dirname, "../components/IndexBuilderContent.tsx"),
        "utf8",
      );
      expect(contentCode).toContain("mobile-builder-tabs-segmented");
      expect(contentCode).toContain("mobile-builder-tab-btn");
      expect(contentCode).toContain("builder-basket-info");
      expect(contentCode).toContain("builder-basket-controls");
      expect(contentCode).toContain("builder-weight-slider");
    });

    it("has fullscreen and mobile builder CSS definitions", () => {
      const cssCode = readFileSync(resolve(__dirname, "../index.css"), "utf8");
      expect(cssCode).toContain(".index-builder-page.is-fullscreen");
      expect(cssCode).toContain(".mobile-builder-tabs-segmented");
      expect(cssCode).toContain(".builder-basket-controls");
    });
  });

  describe("4. TradingView Ticker Hover Delayed Chart Popup", () => {
    it("features hover delay chart popup and retains required ticker symbols", () => {
      const tvCode = readFileSync(
        resolve(__dirname, "../components/TradingViewTickerTape.tsx"),
        "utf8",
      );
      // Ensure required symbols exist
      expect(tvCode).toContain("INDEX:NKY");
      expect(tvCode).toContain("FOREXCOM:DJI");
      expect(tvCode).toContain("FOREXCOM:SPXUSD");
      expect(tvCode).toContain("FOREXCOM:NSXUSD");
      expect(tvCode).toContain("FX_IDC:USDJPY");
      expect(tvCode).toContain("FX_IDC:XAUUSD");
      expect(tvCode).toContain("TVC:USOIL");
      expect(tvCode).toContain("BITSTAMP:BTCUSD");
      expect(tvCode).toContain("BITSTAMP:ETHUSD");

      // Verify hover delay logic and TradingViewChartModal mounting
      expect(tvCode).toContain("HOVER_TRIGGER_DELAY_MS");
      expect(tvCode).toContain("TradingViewChartModal");
      expect(tvCode).toContain("tv-ticker-hover-progress");
      expect(tvCode).toContain("activePopupSymbol");
    });

    it("implements TradingViewChartModal with embed widget and persistent sizing", () => {
      const modalCode = readFileSync(
        resolve(__dirname, "../components/TradingViewChartModal.tsx"),
        "utf8",
      );
      expect(modalCode).toContain("TradingViewChartModal");
      expect(modalCode).toContain("embed-widget-symbol-overview.js");
      expect(modalCode).toContain("tv-chart-popover-card");
      expect(modalCode).toContain("tv_chart_popup_custom_size");
      expect(modalCode).toContain("ResizeObserver");
      expect(modalCode).toContain("isMaximized");
      expect(modalCode).toContain("handleToggleMaximize");
      expect(modalCode).toContain("handleResetSize");
    });
  });
});
