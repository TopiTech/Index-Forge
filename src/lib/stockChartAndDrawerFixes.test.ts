import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("TradingView Chart Sizing, Auto Fallback, and Portrait Drawer Overflow Fixes", () => {
  const chartTsx = fs.readFileSync(
    path.resolve(__dirname, "../components/StockTechnicalChart.tsx"),
    "utf-8"
  );
  const modalTsx = fs.readFileSync(
    path.resolve(__dirname, "../components/TradingViewChartModal.tsx"),
    "utf-8"
  );
  const freshnessTsx = fs.readFileSync(
    path.resolve(__dirname, "../components/DataFreshness.tsx"),
    "utf-8"
  );
  const indexCss = fs.readFileSync(
    path.resolve(__dirname, "../index.css"),
    "utf-8"
  );

  describe("1. TV Chart Sizing & Full-Height Container Fix", () => {
    it("ensures stock-technical-chart-canvas-area has explicit height and min-height to prevent iframe collapse", () => {
      expect(chartTsx).toContain("stock-technical-chart-canvas-area");
      expect(chartTsx).toMatch(/height:\s*activeIsMobile\s*\?\s*["']380px["']\s*:\s*["']500px["']/);
      expect(chartTsx).toMatch(/minHeight:\s*activeIsMobile\s*\?\s*["']340px["']\s*:\s*["']460px["']/);
    });

    it("ensures TradingView widget container and iframe have min-height in CSS", () => {
      expect(indexCss).toContain(".stock-technical-chart-canvas-area");
      expect(indexCss).toMatch(/\.stock-technical-chart-canvas-area\s*\{[^}]*height:\s*500px;/);
      expect(indexCss).toMatch(/\.stock-technical-chart-canvas-area\s*\{[^}]*min-height:\s*460px;/);
      expect(indexCss).toMatch(
        /\.stock-technical-chart-canvas-area\s+\.tradingview-widget-container\s+iframe\s*\{[^}]*min-height:\s*460px\s*!important;/
      );
    });

    it("dispatches window resize events on TradingView load to adapt canvas dimensions to container", () => {
      expect(chartTsx).toContain("window.dispatchEvent(new Event(\"resize\"))");
    });
  });

  describe("2. Portrait Mode Data Status Display Containment (データ状態 枠はみ出し防止)", () => {
    it("DataFreshness component provides data-freshness-text class for flexible text wrapping", () => {
      expect(freshnessTsx).toContain("className=\"data-freshness-text\"");
    });

    it("ensures global sidebar drawer utility section has strict width and overflow containment", () => {
      expect(indexCss).toMatch(
        /\.global-sidebar-drawer\s+\.sidebar-utility\s*\{[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/s
      );
    });

    it("enables wrapping and prevents nowrap overflow on data-freshness inside sidebar drawer", () => {
      expect(indexCss).toMatch(
        /\.global-sidebar-drawer\s+\.sidebar-utility\s+\.data-freshness\s*\{[^}]*white-space:\s*normal;/s
      );
      expect(indexCss).toMatch(
        /\.global-sidebar-drawer\s+\.sidebar-utility\s+\.data-freshness\s*\{[^}]*flex-wrap:\s*wrap;/s
      );
      expect(indexCss).toMatch(
        /\.global-sidebar-drawer\s+\.sidebar-utility\s+\.data-freshness\s*\{[^}]*word-break:\s*break-word;/s
      );
    });

    it("ensures mobile 768px media query also wraps data-freshness and word-breaks", () => {
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*768px\)\s*\{[^}]*\.data-freshness\s*\{[^}]*flex-wrap:\s*wrap;/s);
    });
  });

  describe("3. TradingView Chart Automatic Fallback on Error / Timeout", () => {
    it("implements tvFallbackActive state in StockTechnicalChart", () => {
      expect(chartTsx).toContain("tvFallbackActive");
      expect(chartTsx).toContain("setTvFallbackActive");
    });

    it("automatically falls back to LOCAL engine when tvFallbackActive, tvError, or tvTimedOut is set", () => {
      expect(chartTsx).toMatch(
        /if\s*\(\s*tvFallbackActive\s*\|\|\s*tvError\s*\|\|\s*tvTimedOut\s*\)\s*return\s*["']LOCAL["'];/
      );
    });

    it("activates fallback automatically on script.onerror and timeout", () => {
      expect(chartTsx).toMatch(/script\.onerror\s*=\s*\(\)\s*=>\s*\{[^}]*setTvFallbackActive\(true\);/s);
      expect(chartTsx).toMatch(/setTimeout\(\(\)\s*=>\s*\{[^}]*setTvFallbackActive\(true\);/s);
    });

    it("renders automatic fallback notice banner with retry button and clear status", () => {
      expect(chartTsx).toContain("tv-fallback-alert-banner");
      expect(chartTsx).toContain("TradingView自動フォールバック");
      expect(chartTsx).toContain("再読み込み");
      expect(chartTsx).toContain("handleRetryTV");
    });

    it("TradingViewChartModal includes timeout protection and fallback summary card on script failure", () => {
      expect(modalTsx).toContain("timeoutId");
      expect(modalTsx).toContain("clearTimeout(timeoutId)");
      expect(modalTsx).toContain("銘柄サマリーの自動フォールバックを表示しています");
    });
  });
});
