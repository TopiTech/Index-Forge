import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appTsx = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
const headerTsx = readFileSync(resolve(__dirname, "../components/Header.tsx"), "utf8");
const footerTsx = readFileSync(resolve(__dirname, "../components/Footer.tsx"), "utf8");
const indexCss = readFileSync(resolve(__dirname, "../index.css"), "utf8");

describe("Header, Footer and Layout Balance Enhancements", () => {
  describe("Header search button duplication fix", () => {
    it("renders quick search and mobile search button triggers in Header.tsx", () => {
      expect(headerTsx).toContain('className="header-search-btn"');
      expect(headerTsx).toContain("header-mobile-search-btn");
    });

    it("hides mobile search button on desktop with high specificity !important override", () => {
      expect(indexCss).toMatch(
        /\.header-mobile-search-btn,\s*\.btn\.header-mobile-search-btn\s*\{[\s\S]*?display:\s*none\s*!important;/,
      );
    });

    it("toggles search buttons cleanly at the mobile breakpoint (1080px)", () => {
      expect(indexCss).toMatch(
        /@media\s*\(max-width:\s*1080px\)\s*\{[\s\S]*?\.header-search-btn\s*\{[\s\S]*?display:\s*none\s*!important;[\s\S]*?\.header-mobile-search-btn,\s*\.btn\.header-mobile-search-btn\s*\{[\s\S]*?display:\s*inline-flex\s*!important;/,
      );
    });

    it("gives desktop search button appropriate proportional width in header", () => {
      expect(indexCss).toMatch(/\.header-search-btn\s*\{[\s\S]*?max-width:\s*300px;/);
    });
  });

  describe("Layout alignment and shell structure", () => {
    it("wraps app-shell and Footer in site-wrapper container in PageLayout", () => {
      expect(appTsx).toContain('<div className="site-wrapper">');
      expect(appTsx).toMatch(
        /<div className="site-wrapper">[\s\S]*?<div className="app-shell">[\s\S]*?<\/div>[\s\S]*?<Footer[\s\S]*?<\/div>/,
      );
    });

    it("defines site-wrapper with flex column and full viewport height", () => {
      expect(indexCss).toMatch(
        /\.site-wrapper\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?min-height:\s*100vh;/,
      );
    });

    it("eliminates duplicate desktop top padding in .app to align sidebar and header top edge", () => {
      expect(indexCss).toMatch(/\.app\s*\{[\s\S]*?padding:\s*0;[\s\S]*?position:\s*relative;/);
    });

    it("configures .app-shell with flex: 1 for sticky footer baseline", () => {
      expect(indexCss).toMatch(/\.app-shell\s*\{[\s\S]*?flex:\s*1;/);
    });
  });

  describe("Footer layout and presentation balance", () => {
    it("aligns footer-inner with shell max width", () => {
      expect(indexCss).toMatch(/\.footer-inner\s*\{[\s\S]*?max-width:\s*var\(--shell-max-width\);/);
    });

    it("displays footer navigation list in a balanced 2-column grid to reduce vertical footprint", () => {
      expect(indexCss).toMatch(
        /\.footer-nav-list\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
      );
    });

    it("preserves all required platform navigation links in Footer.tsx", () => {
      const views = ["market", "stock", "calendar", "screener", "dashboard", "builder", "portfolio", "tutorial", "disclaimer"];
      for (const v of views) {
        expect(footerTsx).toContain(`view="${v}"`);
      }
    });
  });
});
