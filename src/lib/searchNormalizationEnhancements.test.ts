import { describe, it, expect } from "vitest";
import { runStockScreener } from "./marketDataService";
import { normalizeSearchQuery, getUniverseStockByTicker } from "../data/stockUniverse";

describe("Search Normalization Enhancements", () => {
  describe("runStockScreener query normalization", () => {
    it("matches full-width Japanese ticker numbers (７２０３ -> 7203)", () => {
      const results = runStockScreener({ searchQuery: "７２０３" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("matches Hiragana queries against Katakana company names (とよた -> トヨタ自動車)", () => {
      const results = runStockScreener({ searchQuery: "とよた" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("matches Hiragana queries against Katakana themes (もびりてぃ -> モビリティ)", () => {
      const results = runStockScreener({ searchQuery: "もびりてぃ" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("matches full-width English ticker symbols (ＡＡＰＬ -> AAPL)", () => {
      const results = runStockScreener({ searchQuery: "ＡＡＰＬ" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "AAPL")).toBe(true);
    });

    it("matches half-width Katakana queries (ﾄﾖﾀ -> トヨタ自動車)", () => {
      const results = runStockScreener({ searchQuery: "ﾄﾖﾀ" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("supports multi-token AND matching (e.g. '7203 トヨタ')", () => {
      const results = runStockScreener({ searchQuery: "7203 トヨタ" });
      expect(results.length).toBe(1);
      expect(results[0].ticker).toBe("7203");
    });

    it("supports multi-token matching across theme and name (e.g. 'モビリティ トヨタ')", () => {
      const results = runStockScreener({ searchQuery: "モビリティ トヨタ" });
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("returns empty array for non-matching queries", () => {
      const results = runStockScreener({ searchQuery: "xyznonexistent9999" });
      expect(results).toHaveLength(0);
    });
  });

  describe("CalendarPage event search filtering logic", () => {
    const mockEvents = [
      {
        id: "ev-1",
        date: "04/25",
        type: "EARNINGS" as const,
        title: "トヨタ自動車 (7203) 決算発表",
        ticker: "7203",
        companyName: "トヨタ自動車",
        importance: "HIGH" as const,
        description: "2026年3月期 通期決算発表",
      },
      {
        id: "ev-2",
        date: "05/01",
        type: "MACRO" as const,
        title: "FOMC 政策金利発表",
        importance: "HIGH" as const,
        description: "米国連邦公開市場委員会 (FOMC) 声明公表",
      },
      {
        id: "ev-3",
        date: "05/10",
        type: "EARNINGS" as const,
        title: "ソニーグループ (6758) 決算発表",
        ticker: "6758",
        companyName: "ソニーグループ",
        importance: "HIGH" as const,
        description: "2026年3月期 決算発表",
      },
    ];

    function filterEvents(query: string) {
      const rawQ = query.trim().toLowerCase();
      const normQ = normalizeSearchQuery(query);
      const tokens = normQ ? normQ.split(/\s+/).filter(Boolean) : [];

      return mockEvents.filter((e) => {
        if (!rawQ) return true;
        const uStock = e.ticker ? getUniverseStockByTicker(e.ticker) : undefined;
        const titleNorm = normalizeSearchQuery(e.title);
        const titleLower = e.title.toLowerCase();
        const tickerUpper = e.ticker ? e.ticker.toUpperCase() : "";
        const tickerLower = e.ticker ? e.ticker.toLowerCase() : "";
        const compNorm = e.companyName ? normalizeSearchQuery(e.companyName) : "";
        const compLower = e.companyName ? e.companyName.toLowerCase() : "";
        const descNorm = e.description ? normalizeSearchQuery(e.description) : "";
        const descLower = e.description ? e.description.toLowerCase() : "";
        const aliasesNorm = uStock?.normAliases || "";
        const aliasesRaw = uStock?.rawAliasesLower || (uStock?.aliases ? uStock.aliases.toLowerCase() : "");

        const matchesToken = (tok: string): boolean => {
          const tokUpper = tok.toUpperCase();
          return (
            (tickerUpper.length > 0 &&
              (tickerUpper === tokUpper || tickerUpper.includes(tokUpper) || tickerLower.includes(tok))) ||
            titleNorm.includes(tok) ||
            titleLower.includes(tok) ||
            compNorm.includes(tok) ||
            compLower.includes(tok) ||
            descNorm.includes(tok) ||
            descLower.includes(tok) ||
            aliasesNorm.includes(tok) ||
            aliasesRaw.includes(tok)
          );
        };

        if (tokens.length > 1) {
          return tokens.every(matchesToken);
        }

        return (
          (tickerUpper.length > 0 &&
            (tickerUpper.includes(normQ.toUpperCase()) || tickerLower.includes(rawQ))) ||
          titleNorm.includes(normQ) ||
          titleLower.includes(rawQ) ||
          compNorm.includes(normQ) ||
          compLower.includes(rawQ) ||
          descNorm.includes(normQ) ||
          descLower.includes(rawQ) ||
          aliasesNorm.includes(normQ) ||
          aliasesRaw.includes(rawQ)
        );
      });
    }

    it("matches calendar earnings events with full-width ticker (７２０３)", () => {
      const matched = filterEvents("７２０３");
      expect(matched.some((e) => e.ticker === "7203")).toBe(true);
    });

    it("matches calendar earnings events with Hiragana (とよた)", () => {
      const matched = filterEvents("とよた");
      expect(matched.some((e) => e.ticker === "7203")).toBe(true);
    });

    it("matches calendar earnings events via aliases (toyota)", () => {
      const matched = filterEvents("toyota");
      expect(matched.some((e) => e.ticker === "7203")).toBe(true);
    });

    it("matches macro events with full-width letters (ｆｏｍｃ)", () => {
      const matched = filterEvents("ｆｏｍｃ");
      expect(matched.some((e) => e.title.includes("FOMC"))).toBe(true);
    });

    it("matches multi-token queries (FOMC 政策)", () => {
      const matched = filterEvents("FOMC 政策");
      expect(matched).toHaveLength(1);
      expect(matched[0].id).toBe("ev-2");
    });

    it("matches multi-token queries combining Hiragana and keywords (とよた 決算)", () => {
      const matched = filterEvents("とよた 決算");
      expect(matched).toHaveLength(1);
      expect(matched[0].id).toBe("ev-1");
    });
  });
});
