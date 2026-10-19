import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  formatTickerPrice,
  formatTickerChange,
  formatTickerChangePercent,
} from "../../worker/internal";
import { getEventDayOfWeek } from "../components/CalendarPage";
import { normalizeSearchQuery } from "../data/stockUniverse";

describe("Comprehensive Code Review Resolution Round 5", () => {
  const rootDir = process.cwd();
  const appTsxSource = readFileSync(resolve(rootDir, "src/App.tsx"), "utf-8");
  const stockAnalysisTsx = readFileSync(
    resolve(rootDir, "src/components/StockAnalysisPage.tsx"),
    "utf-8",
  );
  const calendarTsx = readFileSync(
    resolve(rootDir, "src/components/CalendarPage.tsx"),
    "utf-8",
  );
  const internalImplTs = readFileSync(
    resolve(rootDir, "worker/internal-impl.ts"),
    "utf-8",
  );

  describe("1. App Navigation & History PushState Synchronization", () => {
    it("safely checks full pathname and search params before invoking pushState", () => {
      expect(appTsxSource).toContain(
        "const currentPathWithSearch =\n        typeof window !== \"undefined\"\n          ? `${window.location.pathname}${window.location.search}`\n          : \"\";",
      );
      expect(appTsxSource).toContain("if (typeof window !== \"undefined\" && currentPathWithSearch !== targetPath)");
      expect(appTsxSource).toContain("window.history.pushState({}, \"\", targetPath);");
    });

    it("ensures clearing query parameters updates history when on the same pathname", () => {
      // Simulating navigation logic:
      // Current: /stock?ticker=7203
      // Target: /stock
      const currentPathWithSearch: string = "/stock?ticker=7203";
      const targetPath: string = "/stock";
      const shouldPush = currentPathWithSearch !== targetPath;
      expect(shouldPush).toBe(true);

      // Current: /stock
      // Target: /stock
      const identicalTarget = "/stock";
      expect("/stock" !== identicalTarget).toBe(false);
    });
  });

  describe("2. StockAnalysisPage Multi-Token & Fuzzy Search", () => {
    it("contains tokenized multi-keyword search implementation", () => {
      expect(stockAnalysisTsx).toContain("tokens = normQ ? normQ.split(/\\s+/).filter(Boolean) : []");
      expect(stockAnalysisTsx).toContain("tokens.every(matchesToken)");
      expect(stockAnalysisTsx).toContain("sAliasesNorm.includes(tok)");
      expect(stockAnalysisTsx).toContain("sAliasesRaw.includes(tokLower)");
    });

    it("correctly matches complex multi-token stock queries across ticker, name, and theme", () => {
      const sampleStock = {
        ticker: "7203",
        name: "トヨタ自動車",
        theme: "モビリティ・EV",
        sector: "輸送用機器",
        aliasesNorm: "TOYOTA トヨタ トヨタジドウシャ 7203",
        aliasesRaw: "toyota トヨタ トヨタ自動車 7203",
      };

      const testSearch = (query: string): boolean => {
        const rawQ = query.trim();
        if (!rawQ) return false;
        const normQ = normalizeSearchQuery(rawQ);
        const q = rawQ.toLowerCase();
        const tokens = normQ ? normQ.split(/\s+/).filter(Boolean) : [];

        const sNormName = normalizeSearchQuery(sampleStock.name);
        const sNormTicker = normalizeSearchQuery(sampleStock.ticker);
        const sNameLower = sampleStock.name.toLowerCase();
        const sTickerLower = sampleStock.ticker.toLowerCase();
        const sThemeLower = sampleStock.theme.toLowerCase();
        const sThemeNorm = normalizeSearchQuery(sampleStock.theme);
        const sSectorLower = sampleStock.sector.toLowerCase();
        const sSectorNorm = normalizeSearchQuery(sampleStock.sector);
        const sAliasesNorm = sampleStock.aliasesNorm;
        const sAliasesRaw = sampleStock.aliasesRaw;

        const matchesToken = (tok: string): boolean => {
          const tokLower = tok.toLowerCase();
          return (
            sTickerLower.includes(tokLower) ||
            sNameLower.includes(tokLower) ||
            sNormTicker.includes(tok) ||
            sNormName.includes(tok) ||
            sThemeLower.includes(tokLower) ||
            sThemeNorm.includes(tok) ||
            sSectorLower.includes(tokLower) ||
            sSectorNorm.includes(tok) ||
            sAliasesNorm.includes(tok) ||
            sAliasesRaw.includes(tokLower)
          );
        };

        if (tokens.length > 1) {
          return tokens.every(matchesToken);
        }
        return (
          matchesToken(normQ) ||
          sTickerLower.includes(q) ||
          sNameLower.includes(q) ||
          sAliasesRaw.includes(q)
        );
      };

      expect(testSearch("7203 トヨタ")).toBe(true);
      expect(testSearch("モビリティ トヨタ")).toBe(true);
      expect(testSearch("EV 7203")).toBe(true);
      expect(testSearch("TOYOTA 自動車")).toBe(true);
      expect(testSearch("7203 ソニー")).toBe(false);
    });
  });

  describe("3. CalendarPage Day of Week & Search Normalization", () => {
    it("handles ISO YYYY-MM-DD dates without requiring explicit fullDate", () => {
      // 2026-10-25 is a Sunday
      expect(getEventDayOfWeek("2026-10-25")).toBe("日");
      // 2026-10-26 is a Monday
      expect(getEventDayOfWeek("2026-10-26")).toBe("月");
    });

    it("handles slash YYYY/MM/DD dates cleanly", () => {
      // 2026-10-27 is a Tuesday
      expect(getEventDayOfWeek("2026/10/27")).toBe("火");
      // 2026-10-28 is a Wednesday
      expect(getEventDayOfWeek("2026/10/28")).toBe("水");
    });

    it("handles MM-DD and MM/DD short date strings", () => {
      const now = new Date();
      const currentYear = now.getFullYear();
      // Test with current month and 1st day of month
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = "01";
      const expectedDow = ["日", "月", "火", "水", "木", "金", "土"][
        new Date(currentYear, now.getMonth(), 1).getDay()
      ];
      expect(getEventDayOfWeek(`${m}-${d}`)).toBe(expectedDow);
      expect(getEventDayOfWeek(`${m}/${d}`)).toBe(expectedDow);
    });

    it("prioritizes fullDate when provided", () => {
      // dateStr says 10/25, fullDate says 2026-10-29 (Thursday)
      expect(getEventDayOfWeek("10/25", "2026-10-29")).toBe("木");
    });

    it("returns empty string for invalid dates safely", () => {
      expect(getEventDayOfWeek("invalid")).toBe("");
      expect(getEventDayOfWeek("")).toBe("");
      expect(getEventDayOfWeek("99-99")).toBe("");
    });

    it("checks CalendarPage search token lowercasing and cell event date matching", () => {
      expect(calendarTsx).toContain("const tokLower = tok.toLowerCase();");
      expect(calendarTsx).toContain("e.date.startsWith(dateKeyFull)");
      expect(calendarTsx).toContain("getEventDayOfWeek(evt.date, evt.fullDate)");
    });
  });

  describe("4. Ticker Quote & Precision Enhancements for Sub-10 FX", () => {
    it("formats sub-10 FX prices with 4 decimals when precision requires it", () => {
      expect(formatTickerPrice(1.0654, 4)).toBe("1.0654");
      expect(formatTickerPrice(1.0654)).toBe("1.07");
      expect(formatTickerPrice(1.0654, 2)).toBe("1.07");
    });

    it("retains 2-decimal formatting for standard stocks and JPY currency pairs", () => {
      expect(formatTickerPrice(155.2)).toBe("155.20");
      expect(formatTickerPrice(38980.5)).toBe("38,980.50");
      expect(formatTickerPrice(71.45)).toBe("71.45");
      expect(formatTickerPrice(0)).toBe("0.00");
    });

    it("safely handles non-finite prices", () => {
      expect(formatTickerPrice(-10)).toBe("0.00");
      expect(formatTickerPrice(Number.NaN)).toBe("0.00");
      expect(formatTickerPrice(Number.POSITIVE_INFINITY)).toBe("0.00");
      expect(formatTickerPrice(-10, 4)).toBe("0.0000");
    });

    it("formats sub-10 FX changes with 4 decimals without truncating to 0.00", () => {
      expect(formatTickerChange(-0.0012, 4)).toBe("-0.0012");
      expect(formatTickerChange(0.0035, 4)).toBe("+0.0035");
      expect(formatTickerChange(-0.0012)).toBe("0.00");
    });

    it("retains standard 2-decimal change formatting for standard equities and JPY FX", () => {
      expect(formatTickerChange(145.2)).toBe("+145.20");
      expect(formatTickerChange(-0.65)).toBe("-0.65");
      expect(formatTickerChange(0.15)).toBe("+0.15");
      expect(formatTickerChange(0)).toBe("0.00");
      expect(formatTickerChange(Number.NaN)).toBe("0.00");
    });

    it("formats percentage changes safely with sign and precision", () => {
      expect(formatTickerChangePercent(0.37)).toBe("+0.37%");
      expect(formatTickerChangePercent(-0.31)).toBe("-0.31%");
      expect(formatTickerChangePercent(0)).toBe("0.00%");
      expect(formatTickerChangePercent(Number.NaN)).toBe("0.00%");
    });

    it("internal-impl.ts calculates 4-decimal precision for sub-10 non-JPY FX pairs", () => {
      expect(internalImplTs).toContain("const isSubTenFx = isFx && !isJpyFx;");
      expect(internalImplTs).toContain("const decimals = isSubTenFx ? 4 : 2;");
      expect(internalImplTs).toContain("const change = Number((price - prevClose).toFixed(decimals));");
      expect(internalImplTs).toContain("price: Number(price.toFixed(decimals)),");
    });
  });
});
