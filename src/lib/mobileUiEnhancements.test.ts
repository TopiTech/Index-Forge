import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const portfolioTsx = readFileSync(
  resolve(__dirname, "../components/PortfolioManagerPage.tsx"),
  "utf8",
);
const screenerTsx = readFileSync(
  resolve(__dirname, "../components/ScreenerPage.tsx"),
  "utf8",
);
const marketOverviewTsx = readFileSync(
  resolve(__dirname, "../components/MarketOverviewPage.tsx"),
  "utf8",
);
const calendarTsx = readFileSync(
  resolve(__dirname, "../components/CalendarPage.tsx"),
  "utf8",
);
const indexCss = readFileSync(resolve(__dirname, "../index.css"), "utf8");

describe("Mobile UI & Responsive Design Enhancements", () => {
  describe("PortfolioManagerPage Mobile Responsive Structure", () => {
    it("wraps desktop table with portfolio-desktop-table-container", () => {
      expect(portfolioTsx).toContain("portfolio-desktop-table-container");
    });

    it("renders dedicated portfolio-mobile-list for smartphone screens", () => {
      expect(portfolioTsx).toContain('className="portfolio-mobile-list"');
      expect(portfolioTsx).toContain('className="portfolio-mobile-card"');
    });

    it("includes mobile action buttons with accessible targets and aria-labels", () => {
      expect(portfolioTsx).toContain("portfolio-header-actions");
      expect(portfolioTsx).toContain('aria-label={`${p.name} (${p.ticker}) の詳細を見る`}');
      expect(portfolioTsx).toContain('aria-label={`保有銘柄「${p.name}」を削除`}');
    });

    it("displays complete position metrics in mobile card view", () => {
      expect(portfolioTsx).toContain("portfolio-mobile-card-header");
      expect(portfolioTsx).toContain("portfolio-mobile-card-grid");
      expect(portfolioTsx).toContain("portfolio-mobile-stat");
      expect(portfolioTsx).toContain("保有数量 / 取得単価");
      expect(portfolioTsx).toContain("含み損益 (損益率)");
    });
  });

  describe("ScreenerPage Mobile Responsive Structure", () => {
    it("wraps desktop results table with screener-desktop-table-container", () => {
      expect(screenerTsx).toContain("screener-desktop-table-container");
    });

    it("renders dedicated screener-mobile-list with card layout", () => {
      expect(screenerTsx).toContain('className="screener-mobile-list"');
      expect(screenerTsx).toContain('className={`screener-mobile-card ${isSelected ? "selected-card" : ""}`}');
    });

    it("provides horizontal scroll for strategy presets on mobile", () => {
      expect(screenerTsx).toContain('className="screener-presets-group"');
    });

    it("ensures mobile cards feature accessible checkbox, financial metrics, and AI signals", () => {
      expect(screenerTsx).toContain("screener-mobile-checkbox");
      expect(screenerTsx).toContain('aria-label={`${stock.name} の選択切り替え`}');
      expect(screenerTsx).toContain("screener-mobile-card-grid");
      expect(screenerTsx).toContain("予想配当利回り");
      expect(screenerTsx).toContain("PER / PBR");
    });
  });

  describe("MarketOverviewPage & CalendarPage Responsive Enhancements", () => {
    it("applies responsive classes to MarketOverview header actions and breadth counters", () => {
      expect(marketOverviewTsx).toContain("market-overview-header-actions");
      expect(marketOverviewTsx).toContain("market-breadth-counts");
      expect(marketOverviewTsx).toContain("market-breadth-action-group");
      expect(marketOverviewTsx).toContain("market-sectors-card");
      expect(marketOverviewTsx).toContain("market-news-card");
    });

    it("applies responsive classes to Calendar toolbar, filters, and event lists", () => {
      expect(calendarTsx).toContain("calendar-header-actions");
      expect(calendarTsx).toContain("calendar-filter-bar");
      expect(calendarTsx).toContain("calendar-event-item");
      expect(calendarTsx).toContain("calendar-month-header");
    });
  });

  describe("CSS Media Queries & Touch Ergonomics in index.css", () => {
    it("swaps desktop table with mobile card list at 768px breakpoint", () => {
      expect(indexCss).toContain(".portfolio-desktop-table-container");
      expect(indexCss).toContain(".portfolio-mobile-list");
      expect(indexCss).toContain(".screener-desktop-table-container");
      expect(indexCss).toContain(".screener-mobile-list");

      // Verify desktop tables are hidden on mobile <= 768px
      expect(indexCss).toMatch(/\.portfolio-desktop-table-container\s*\{\s*display:\s*none\s*!important;/);
      expect(indexCss).toMatch(/\.screener-desktop-table-container\s*\{\s*display:\s*none\s*!important;/);

      // Verify mobile card lists are shown on mobile <= 768px
      expect(indexCss).toMatch(/\.portfolio-mobile-list\s*\{\s*display:\s*flex\s*!important;/);
      expect(indexCss).toMatch(/\.screener-mobile-list\s*\{\s*display:\s*flex\s*!important;/);
    });

    it("prevents iOS Safari form control zoom by enforcing 16px font-size on mobile", () => {
      expect(indexCss).toMatch(/font-size:\s*16px\s*!important;/);
      expect(indexCss).toContain("-webkit-text-size-adjust: 100%;");
    });

    it("supports smooth touch scrolling on preset containers", () => {
      expect(indexCss).toContain("-webkit-overflow-scrolling: touch;");
      expect(indexCss).toContain(".screener-presets-group");
    });

    it("defines compact layouts for ultra-narrow screens (480px and 380px)", () => {
      expect(indexCss).toContain("@media (max-width: 480px)");
      expect(indexCss).toContain("@media (max-width: 380px)");
    });
  });
});
