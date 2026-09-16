import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("UI Major Enhancements: Header 2-row Fix, Light Mode Visibility, Mobile Polish", () => {
  const cssCode = readFileSync(resolve(__dirname, "../index.css"), "utf8");
  const headerCode = readFileSync(resolve(__dirname, "../components/Header.tsx"), "utf8");
  const tvCode = readFileSync(resolve(__dirname, "../components/TradingViewTickerTape.tsx"), "utf8");
  const chartCode = readFileSync(resolve(__dirname, "../components/PerformanceChart.tsx"), "utf8");

  describe("1. Header 2-row Fix & Layout Optimization", () => {
    it("uses header-inner-row with flex-wrap: nowrap to prevent 2-row wrapping on desktop", () => {
      expect(headerCode).toContain('className="header-inner-row"');
      expect(cssCode).toContain(".header-inner-row {");
      expect(cssCode).toMatch(/\.header-inner-row\s*\{[^}]*flex-wrap:\s*nowrap;/s);
    });

    it("hides header-desc when viewport is narrower to preserve clean 1-row header", () => {
      expect(cssCode).toContain("@media (max-width: 1260px)");
      expect(cssCode).toContain(".header-desc");
    });

    it("streamlines mobile header and moves DataFreshness and Auth into mobile drawer", () => {
      expect(headerCode).toContain("header-status-desktop");
      expect(headerCode).toContain("header-status-mobile");
      expect(headerCode).toContain("header-mobile-meta-section");
      expect(headerCode).toContain("header-mobile-auth-section");
    });
  });

  describe("2. Light Mode Visibility & Black Remnant Removal", () => {
    it("provides light theme override for .portfolio-cta-box so it is not black", () => {
      expect(cssCode).toContain('[data-theme="light"] .portfolio-cta-box');
      expect(cssCode).toMatch(/\[data-theme="light"\]\s+\.portfolio-cta-box\s*\{[^}]*background:\s*linear-gradient/s);
    });

    it("provides light theme override for TradingView ticker fade overlay so right edge is not black", () => {
      expect(tvCode).toContain("tv-ticker-overlay-right");
      expect(cssCode).toContain(".tv-ticker-overlay-right");
      expect(cssCode).toContain('[data-theme="light"] .tv-ticker-overlay-right');
      expect(cssCode).toMatch(/\[data-theme="light"\]\s+\.tv-ticker-overlay-right\s*\{[^}]*rgba\(255,\s*255,\s*255/s);
    });

    it("provides light theme overrides for .toast-item to prevent black background with dark text", () => {
      expect(cssCode).toContain('[data-theme="light"] .toast-item');
      expect(cssCode).toContain('[data-theme="light"] .toast-item.toast-success');
      expect(cssCode).toContain('[data-theme="light"] .toast-item.toast-error');
    });
  });

  describe("3. Mobile UI Polish & Responsiveness", () => {
    it("ensures benchmark selector displays all 4 options in a 4-column balanced grid on mobile", () => {
      expect(cssCode).toContain(".benchmark-options {");
      expect(cssCode).toMatch(/\.benchmark-options\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/s);
    });

    it("hierarchically organizes chart controls into timeframe row and mode row for compact mobile presentation", () => {
      expect(chartCode).toContain("chart-timeframe-row");
      expect(chartCode).toContain("chart-mode-row");
      expect(cssCode).toMatch(/\.chart-timeframe-row\s+\.timeframe-group\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s);
    });

    it("improves mobile dashboard toolbar with balanced padding and rounded glass styling", () => {
      expect(cssCode).toContain(".mobile-dashboard-toolbar");
      expect(cssCode).toContain('[data-theme="light"] .mobile-dashboard-toolbar');
    });
  });
});
