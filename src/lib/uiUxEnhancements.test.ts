import { describe, it, expect } from "vitest";
import { searchPopularStocks } from "../data/popularStocks";
import { normalizeWeights } from "./indexEngine";

describe("UI/UX Enhancements Unit Tests", () => {
  describe("Popular Stocks Search", () => {
    it("returns empty array for empty or whitespace query", () => {
      expect(searchPopularStocks("")).toEqual([]);
      expect(searchPopularStocks("   ")).toEqual([]);
    });

    it("finds stocks by ticker code (case insensitive)", () => {
      const results = searchPopularStocks("7203");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].ticker).toBe("7203");
      expect(results[0].name).toBe("トヨタ自動車");

      const appleResults = searchPopularStocks("aapl");
      expect(appleResults.length).toBeGreaterThan(0);
      expect(appleResults[0].ticker).toBe("AAPL");
    });

    it("finds stocks by company name", () => {
      const results = searchPopularStocks("ソフトバンク");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "9984")).toBe(true);
    });

    it("finds stocks by theme", () => {
      const results = searchPopularStocks("半導体");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.theme.includes("半導体"))).toBe(true);
    });

    it("respects the limit argument", () => {
      const results = searchPopularStocks("半導体", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Weight Normalization Assist Logic", () => {
    it("normalizes arbitrary weights to exactly 100%", () => {
      const basket = [
        { ticker: "7203", name: "トヨタ", theme: "車", weight: 50 },
        { ticker: "9984", name: "SBG", theme: "AI", weight: 150 },
      ];
      const normalized = normalizeWeights(basket);
      const total = normalized.reduce((sum, item) => sum + item.weight, 0);
      expect(total).toBeCloseTo(100, 2);
      expect(normalized[0].weight).toBe(25);
      expect(normalized[1].weight).toBe(75);
    });

    it("handles zero or negative weights defensively without crashing", () => {
      const basket = [
        { ticker: "7203", name: "トヨタ", theme: "車", weight: 0 },
        { ticker: "9984", name: "SBG", theme: "AI", weight: 0 },
      ];
      const normalized = normalizeWeights(basket);
      expect(normalized.length).toBe(2);
      expect(normalized[0].weight).toBe(0);
      expect(normalized[1].weight).toBe(0);
    });
  });

  describe("UI Layout & Accent Theming Regressions", () => {
    it("ensures index-item does not shrink and index-selector-content has clearance for hover", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const css = readFileSync(resolve("src/index.css"), "utf8");

      const indexItemBlock = css.match(/\.index-item\s*\{([\s\S]*?)\n\}/)?.[1] || "";
      expect(indexItemBlock).toContain("flex-shrink: 0");
      expect(indexItemBlock).toContain("min-height: fit-content");

      const selectorContentBlock = css.match(/\.index-selector-content\s*\{([\s\S]*?)\n\}/)?.[1] || "";
      expect(selectorContentBlock).toContain("padding: 4px 2px 0");
    });

    it("defines CSS variables for all 5 accent palettes in dark and light modes", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      // Accent and theme tokens live in styles/tokens.css since the P0 split.
      const css = readFileSync(resolve("src/styles/tokens.css"), "utf8");

      const accents = ["cyan", "emerald", "violet", "amber", "rose"];
      for (const accent of accents) {
        expect(css).toContain(`[data-accent="${accent}"]`);
        expect(css).toContain(`[data-theme="light"][data-accent="${accent}"]`);
      }

      // Check key variables exist in root
      expect(css).toContain("--accent-color:");
      expect(css).toContain("--accent-text:");
      expect(css).toContain("--accent-border:");
      expect(css).toContain("--accent-subtle:");
      expect(css).toContain("--accent-glow:");
    });
  });
});

