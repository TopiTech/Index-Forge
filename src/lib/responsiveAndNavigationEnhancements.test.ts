import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appTsx = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
const mobileBottomNavTsx = readFileSync(
  resolve(__dirname, "../components/MobileBottomNav.tsx"),
  "utf8",
);
const stockDetailTsx = readFileSync(
  resolve(__dirname, "../components/StockDetailPage.tsx"),
  "utf8",
);
const indexCss = readFileSync(resolve(__dirname, "../index.css"), "utf8");

describe("UI/UX & Responsive Navigation Enhancements", () => {
  describe("MobileBottomNav Component", () => {
    it("exports MobileBottomNav component with semantic navigation and ARIA landmarks", () => {
      expect(mobileBottomNavTsx).toContain("export function MobileBottomNav");
      expect(mobileBottomNavTsx).toContain('<nav\n      className="mobile-bottom-nav"');
      expect(mobileBottomNavTsx).toContain('aria-label="モバイル下部ナビゲーション"');
      expect(mobileBottomNavTsx).toContain('role="navigation"');
    });

    it("includes primary navigation tabs: market, screener, dashboard, portfolio, calendar", () => {
      expect(mobileBottomNavTsx).toContain('id: "market"');
      expect(mobileBottomNavTsx).toContain('id: "screener"');
      expect(mobileBottomNavTsx).toContain('id: "dashboard"');
      expect(mobileBottomNavTsx).toContain('id: "portfolio"');
      expect(mobileBottomNavTsx).toContain('id: "calendar"');
    });

    it("applies aria-current and active class for currently selected view", () => {
      expect(mobileBottomNavTsx).toContain('aria-current={isActive ? "page" : undefined}');
      expect(mobileBottomNavTsx).toContain('${isActive ? "active" : ""}');
      expect(mobileBottomNavTsx).toContain("mobile-bottom-nav-dot");
    });
  });

  describe("App.tsx PageLayout Integration", () => {
    it("imports MobileBottomNav", () => {
      expect(appTsx).toContain('import { MobileBottomNav } from "./components/MobileBottomNav";');
    });

    it("mounts MobileBottomNav inside PageLayout with currentView and onNavigate handler", () => {
      expect(appTsx).toMatch(
        /<MobileBottomNav\s+currentView=\{currentView\}\s+onNavigate=\{navigateTo\}\s*\/>/,
      );
    });

    it("preserves layout order and existing overlay contracts", () => {
      // Must maintain PageLayout sibling overlay contract for searchModal and overlays
      expect(appTsx).toMatch(/\{overlays\}\s*\{searchModal\}\s*<MobileBottomNav/);
      expect(appTsx).toMatch(
        /<div className="site-wrapper">[\s\S]*?<div className="app-shell">[\s\S]*?<\/div>[\s\S]*?<Footer[\s\S]*?<\/div>/,
      );
    });
  });

  describe("StockDetailPage Navigation & Responsive Flow", () => {
    it("renders semantic breadcrumb navigation bar", () => {
      expect(stockDetailTsx).toContain('aria-label="パンくずリスト"');
      expect(stockDetailTsx).toContain('className="stock-detail-breadcrumb-nav"');
      expect(stockDetailTsx).toContain('className="stock-breadcrumb-list"');
    });

    it("provides quick navigation back to dashboard, market overview, and screener", () => {
      expect(stockDetailTsx).toContain('onClick={() => onNavigate("dashboard")}');
      expect(stockDetailTsx).toContain('onClick={() => onNavigate("market")}');
      expect(stockDetailTsx).toContain('onClick={() => onNavigate("screener")}');
    });

    it("applies responsive layout classes to action bar, hero card, and fundamentals grid", () => {
      expect(stockDetailTsx).toContain('className="stock-detail-actions-bar"');
      expect(stockDetailTsx).toContain('className="stock-hero-inner"');
      expect(stockDetailTsx).toContain("stock-fundamentals-grid");
    });
  });

  describe("CSS Responsive Styles & Media Queries", () => {
    it("hides mobile bottom nav on desktop and displays fixed bottom nav on mobile (<= 768px)", () => {
      expect(indexCss).toMatch(/\.mobile-bottom-nav\s*\{[\s\S]*?display:\s*none;/);
      expect(indexCss).toMatch(
        /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.mobile-bottom-nav\s*\{[\s\S]*?display:\s*block;[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*0;/,
      );
    });

    it("pads site-wrapper on mobile to account for bottom navigation bar and safe-area-inset", () => {
      expect(indexCss).toMatch(
        /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.site-wrapper\s*\{[\s\S]*?padding-bottom:\s*calc\(/,
      );
    });

    it("adapts global search modal to mobile full viewport height on small screens (<= 768px)", () => {
      expect(indexCss).toMatch(
        /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.global-search-modal\s*\{[\s\S]*?width:\s*100vw\s*!important;[\s\S]*?height:\s*100dvh\s*!important;/,
      );
    });

    it("styles breadcrumb navigation and hover effects cleanly", () => {
      expect(indexCss).toContain(".stock-detail-breadcrumb-nav");
      expect(indexCss).toContain(".stock-breadcrumb-list");
      expect(indexCss).toContain(".stock-breadcrumb-link");
      expect(indexCss).toContain(".stock-breadcrumb-current-text");
    });

    it("adjusts fundamentals grid columns on <= 640px and <= 380px viewports", () => {
      expect(indexCss).toMatch(
        /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.stock-fundamentals-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important;/,
      );
      expect(indexCss).toMatch(
        /@media\s*\(max-width:\s*380px\)\s*\{[\s\S]*?\.stock-fundamentals-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr\s*!important;/,
      );
    });
  });
});
