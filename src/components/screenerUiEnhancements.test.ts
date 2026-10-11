import { describe, it, expect } from "vitest";
import { runStockScreener, getStockFundamentals } from "../lib/marketDataService";
import { escapeCsvCell } from "../lib/csv";
import fs from "fs";
import path from "path";

describe("Screener UI/UX Enhancements", () => {
  const screenerTsx = fs.readFileSync(
    path.resolve(__dirname, "ScreenerPage.tsx"),
    "utf-8"
  );

  describe("Sorting by Extended Columns", () => {
    it("sorts stocks by price correctly in ascending and descending orders", () => {
      const desc = runStockScreener({ sortBy: "price", sortOrder: "desc" });
      const asc = runStockScreener({ sortBy: "price", sortOrder: "asc" });

      expect(desc.length).toBeGreaterThan(1);
      expect(desc[0].price).toBeGreaterThanOrEqual(desc[1].price);
      expect(asc[0].price).toBeLessThanOrEqual(asc[1].price);
    });

    it("sorts stocks by roe correctly", () => {
      const desc = runStockScreener({ sortBy: "roe", sortOrder: "desc" });
      expect(desc.length).toBeGreaterThan(1);
      expect(desc[0].roe ?? 0).toBeGreaterThanOrEqual(desc[1].roe ?? 0);
    });

    it("sorts stocks by company name alphabetically using localeCompare", () => {
      const asc = runStockScreener({ sortBy: "name", sortOrder: "asc" });
      expect(asc.length).toBeGreaterThan(1);
      expect(asc[0].name.localeCompare(asc[1].name, "ja")).toBeLessThanOrEqual(0);
    });
  });

  describe("Sparkline Momentum Data", () => {
    it("attaches 5-step sparkline points to stock quote fundamentals", () => {
      const stock = getStockFundamentals("7203");
      expect(stock.sparkline).toBeDefined();
      expect(stock.sparkline?.length).toBe(5);
      expect(stock.sparkline?.[4]).toBe(stock.price);
    });
  });

  describe("ScreenerPage Code & UI Structure", () => {
    it("includes active-preset-pill dynamic class for preset buttons", () => {
      expect(screenerTsx).toContain("active-preset-pill");
      expect(screenerTsx).toContain("activePreset");
      expect(screenerTsx).toContain("handleResetFilters");
    });

    it("contains interactive sortable headers with accessibility attributes", () => {
      expect(screenerTsx).toContain("sortable-col-header");
      expect(screenerTsx).toContain('role="columnheader"');
      expect(screenerTsx).toContain("aria-sort");
      expect(screenerTsx).toContain("handleSortColumn");
      expect(screenerTsx).toContain("tabIndex={0}");
      expect(screenerTsx).toMatch(/onKeyDown=\{.*handleSortColumn/s);
    });

    it("isolates checkbox button keyboard events from parent row navigation", () => {
      expect(screenerTsx).toMatch(/onKeyDown=\{\(e\)\s*=>\s*\{[^}]*e\.stopPropagation\(\)/);
    });

    it("does not import unused AnimatePresence", () => {
      expect(screenerTsx).not.toContain("AnimatePresence");
    });

    it("includes multi-selection checkboxes and CSV export button", () => {
      expect(screenerTsx).toContain("selectedTickers");
      expect(screenerTsx).toContain("handleToggleSelectAll");
      expect(screenerTsx).toContain("handleExportCsv");
      expect(screenerTsx).toContain("CSV出力");
    });

    it("includes active filter pills with dismiss action buttons", () => {
      expect(screenerTsx).toContain("activeFilters");
      expect(screenerTsx).toContain("適用中フィルター:");
      expect(screenerTsx).toContain("filter.onRemove");
    });
  });

  describe("CSV Export Safety", () => {
    it("safely escapes formulas and handles punctuation in screener rows", () => {
      expect(escapeCsvCell("NVIDIA")).toBe('"NVIDIA"');
      expect(escapeCsvCell("=CMD()")).toBe('"\'=CMD()"');
      expect(escapeCsvCell(417)).toBe('"417"');
    });
  });
});
