import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

describe("Comprehensive Goal Audit Fixes 2: Accessibility & Security Enhancements", () => {
  const portfolioTsx = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/PortfolioManagerPage.tsx"),
    "utf-8",
  );
  const calendarTsx = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/CalendarPage.tsx"),
    "utf-8",
  );
  const screenerTsx = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/ScreenerPage.tsx"),
    "utf-8",
  );
  const stockDetailTsx = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/StockDetailPage.tsx"),
    "utf-8",
  );

  describe("PortfolioManagerPage Accessibility & Modal Standards", () => {
    it("imports and uses ModalBase for Add Position dialog", () => {
      expect(portfolioTsx).toContain('import { ModalBase } from "./ModalBase";');
      expect(portfolioTsx).toContain("<ModalBase");
      expect(portfolioTsx).toContain("isOpen={isAddModalOpen}");
      expect(portfolioTsx).toContain('title="保有銘柄の新規登録"');
      expect(portfolioTsx).not.toContain(
        '<div className="modal-backdrop" onClick={() => setIsAddModalOpen(false)}>',
      );
    });

    it("wires label htmlFor to input/select IDs in Add Position modal", () => {
      expect(portfolioTsx).toContain('htmlFor="position-ticker-select"');
      expect(portfolioTsx).toContain('id="position-ticker-select"');
      expect(portfolioTsx).toContain('htmlFor="position-shares-input"');
      expect(portfolioTsx).toContain('id="position-shares-input"');
      expect(portfolioTsx).toContain('htmlFor="position-avg-cost-input"');
      expect(portfolioTsx).toContain('id="position-avg-cost-input"');
    });

    it("makes holdings ticker link accessible with role button, tabIndex, and keyboard handler", () => {
      expect(portfolioTsx).toMatch(
        /<div\s+role="button"\s+tabIndex=\{0\}\s+style=\{\{\s*cursor:\s*"pointer"\s*\}\}\s+onClick=\{\(\)\s*=>\s*onOpenStockDetail\(p\.ticker\)\}\s+onKeyDown=\{/,
      );
      expect(portfolioTsx).toContain('title="銘柄詳細を見る"');
      expect(portfolioTsx).toContain("aria-label={`${p.name} (${p.ticker}) の詳細を見る`}");
    });

    it("makes watchlist cards accessible and stops keyboard propagation on delete button", () => {
      expect(portfolioTsx).toMatch(
        /<div\s+key=\{ticker\}\s+role="button"\s+tabIndex=\{0\}\s+className="card interactive-card"/,
      );
      expect(portfolioTsx).toContain("aria-label={`${fund.name} (${ticker}) の詳細を見る`}");
      expect(portfolioTsx).toContain("onKeyDown={(e) => e.stopPropagation()}");
      expect(portfolioTsx).toContain("aria-label={`${fund.name} をウォッチリストから削除`}");
    });
  });

  describe("CalendarPage Timeline Keyboard Navigation", () => {
    it("provides button role, tabIndex, and Enter/Space keyboard handlers on ticker events", () => {
      expect(calendarTsx).toContain('role={ticker ? "button" : undefined}');
      expect(calendarTsx).toContain("tabIndex={ticker ? 0 : undefined}");
      expect(calendarTsx).toContain(
        "aria-label={ticker ? `${evt.title} (${ticker}) の詳細を見る` : undefined}",
      );
      expect(calendarTsx).toMatch(/if \(e\.key === "Enter" \|\| e\.key === " "\)/);
    });
  });

  describe("ScreenerPage Table Row Accessibility", () => {
    it("makes screener table rows focusable and keyboard-interactive", () => {
      // A table row must keep its implicit `row` role: role="button" on a
      // <tr> is not an allowed ARIA override and orphans the <td> cells from
      // their required row parent, so screen readers announced each row as a
      // button and lost the column relationships.
      expect(screenerTsx).toMatch(
        /<tr\s+key=\{stock\.ticker\}\s+tabIndex=\{0\}\s+style=\{\{\s*cursor:\s*"pointer"\s*\}\}/,
      );
      expect(screenerTsx).toContain("aria-label={`${stock.name} (${stock.ticker}) の詳細を見る`}");
      expect(screenerTsx).toMatch(/if \(e\.key === "Enter" \|\| e\.key === " "\)/);
    });

    it("associates every screener filter control with its visible label", () => {
      for (const id of [
        "screener-market",
        "screener-min-dividend",
        "screener-max-pbr",
        "screener-max-per",
        "screener-search",
      ]) {
        expect(screenerTsx).toContain(`htmlFor="${id}"`);
        expect(screenerTsx).toContain(`id="${id}"`);
      }
      // The quick-sort select has a plain text caption, not a <label>.
      expect(screenerTsx).toContain('aria-label="クイック並び替え"');
    });
  });

  describe("StockDetailPage Security & Navigation Standards", () => {
    it("replaces window.open with a secure, semantic anchor tag using target=_blank and rel=noopener noreferrer", () => {
      expect(stockDetailTsx).not.toContain("window.open(");
      expect(stockDetailTsx).toContain('target="_blank"');
      expect(stockDetailTsx).toContain('rel="noopener noreferrer"');
      expect(stockDetailTsx).toContain(
        'href={getTradingViewWebUrl(stock.ticker, stock.market)}',
      );
    });
  });

  describe("Keyboard activation handler logic verification", () => {
    function createKeyboardHandler(onAction: () => void) {
      return (e: { key: string; preventDefault: () => void }) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAction();
        }
      };
    }

    it("triggers action and prevents default on Enter", () => {
      const onAction = vi.fn();
      const preventDefault = vi.fn();
      const handler = createKeyboardHandler(onAction);

      handler({ key: "Enter", preventDefault });
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalledTimes(1);
    });

    it("triggers action and prevents default on Space", () => {
      const onAction = vi.fn();
      const preventDefault = vi.fn();
      const handler = createKeyboardHandler(onAction);

      handler({ key: " ", preventDefault });
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalledTimes(1);
    });

    it("ignores other keys like Tab or Escape", () => {
      const onAction = vi.fn();
      const preventDefault = vi.fn();
      const handler = createKeyboardHandler(onAction);

      handler({ key: "Tab", preventDefault });
      handler({ key: "Escape", preventDefault });
      expect(onAction).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    });
  });
});
