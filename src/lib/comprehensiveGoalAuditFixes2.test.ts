// @vitest-environment jsdom
/**
 * Regression suite for the comprehensive goal audit fixes (accessibility &
 * security).
 *
 * The accessibility requirements are split in two:
 *
 * - the source-contract assertions below read the real production sources, so
 *   they fail as soon as the markup in `src/components/*.tsx` regresses;
 * - the keyboard-activation contract is a *behavioural* one, so it is checked
 *   against a rendered production component (`ThemeHeatmap`) instead of a
 *   copy of the handler that used to live in this file.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { ThemeHeatmap } from "../components/ThemeHeatmap";
import type { StockDetail } from "../types";

import portfolioTsx from "../components/PortfolioManagerPage.tsx?raw";
import calendarTsx from "../components/CalendarPage.tsx?raw";
import screenerTsx from "../components/ScreenerPage.tsx?raw";
import stockDetailTsx from "../components/StockDetailPage.tsx?raw";

describe("Comprehensive Goal Audit Fixes 2: Accessibility & Security Enhancements", () => {
  // The jsdom environment externalizes the Node built-ins, so the production
  // sources are read through Vite's `?raw` suffix instead of `fs`/`path`.

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
    /**
     * The Enter/Space activation contract is production code: a keyboard
     * activatable element (`role="button"`, `tabIndex={0}`) must run its action
     * and cancel the default browser behaviour for both keys, and must ignore
     * every other key. `ThemeHeatmap` implements that contract inline, so it
     * is rendered for real here — the previous version of this block re-implemented
     * the handler inside the test file, which could never fail when the
     * production handler broke.
     */
    const HEATMAP_STOCK: StockDetail = {
      ticker: "7203.T",
      name: "トヨタ",
      theme: "EV",
      weight: 100,
      currentPrice: 3000,
      previousPrice: 2900,
      change: 100,
      changePct: 3.45,
      contributionPt: 34.5,
      contributionPct: 34.5,
      sparkline: [2900, 2950, 3000],
    };

    function renderHeatmapTile(onSelectTheme: (theme: string | null) => void) {
      render(
        createElement(ThemeHeatmap, {
          stockDetails: [HEATMAP_STOCK],
          selectedTheme: null,
          onSelectTheme,
        }),
      );
      return screen.getByRole("button", { name: /トヨタ \(7203\.T\)/ });
    }

    it("triggers action and prevents default on Enter", () => {
      const onSelectTheme = vi.fn();
      const tile = renderHeatmapTile(onSelectTheme);

      const event = createEvent.keyDown(tile, { key: "Enter" });
      fireEvent(tile, event);

      expect(onSelectTheme).toHaveBeenCalledTimes(1);
      expect(onSelectTheme).toHaveBeenCalledWith("EV");
      expect(event.defaultPrevented).toBe(true);
    });

    it("triggers action and prevents default on Space", () => {
      const onSelectTheme = vi.fn();
      const tile = renderHeatmapTile(onSelectTheme);

      const event = createEvent.keyDown(tile, { key: " " });
      fireEvent(tile, event);

      expect(onSelectTheme).toHaveBeenCalledTimes(1);
      expect(onSelectTheme).toHaveBeenCalledWith("EV");
      expect(event.defaultPrevented).toBe(true);
    });

    it("ignores other keys like Tab or Escape", () => {
      const onSelectTheme = vi.fn();
      const tile = renderHeatmapTile(onSelectTheme);

      for (const key of ["Tab", "Escape"]) {
        const event = createEvent.keyDown(tile, { key });
        fireEvent(tile, event);
        expect(event.defaultPrevented).toBe(false);
      }

      expect(onSelectTheme).not.toHaveBeenCalled();
    });
  });
});
