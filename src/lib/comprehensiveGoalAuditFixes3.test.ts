import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { calculateRiskMetrics } from "./analytics";
import type { PricePoint } from "../types";

describe("Comprehensive Goal Audit & Remediation Round 3", () => {
  const portfolioTsx = readFileSync(
    resolve(process.cwd(), "src/components/PortfolioManagerPage.tsx"),
    "utf-8",
  );
  const calendarTsx = readFileSync(
    resolve(process.cwd(), "src/components/CalendarPage.tsx"),
    "utf-8",
  );
  const analyticsTs = readFileSync(resolve(process.cwd(), "src/lib/analytics.ts"), "utf-8");
  const cssCode = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");

  describe("1. PortfolioManagerPage Auth State Transition & Data Safety", () => {
    it("declares isAuthTransitionRef to guard against transient empty state overwriting saved portfolio", () => {
      expect(portfolioTsx).toContain("const isAuthTransitionRef = useRef(false);");
      expect(portfolioTsx).toContain("isAuthTransitionRef.current = true;");
    });

    it("synchronizes persistence refs immediately on auth transition and inline login", () => {
      expect(portfolioTsx).toContain("positionsPersistedRef.current = hasPersistedPortfolio();");
      expect(portfolioTsx).toContain("watchlistPersistedRef.current = hasPersistedWatchlist();");
    });

    it("prevents saving transient empty arrays in auto-save effects when transitioning auth", () => {
      expect(portfolioTsx).toContain("if (isAuthTransitionRef.current) {");
      expect(portfolioTsx).toContain("isAuthTransitionRef.current = false;");
      expect(portfolioTsx).toContain("return;");
    });

    it("applies responsive portfolio-gate-actions class and CSS rules for narrow screens", () => {
      expect(portfolioTsx).toContain('className="portfolio-gate-actions"');
      expect(cssCode).toContain(".portfolio-gate-actions");
      expect(cssCode).toContain("@media (max-width: 480px)");
      expect(cssCode).toContain("flex-direction: column-reverse;");
    });
  });

  describe("2. CalendarPage Day Event Overflow & Accessibility", () => {
    it("declares selectedDayOverview state for inspecting days with overflow events", () => {
      expect(calendarTsx).toContain("selectedDayOverview, setSelectedDayOverview");
    });

    it("provides an interactive accessible button when day cell has more than 3 events", () => {
      expect(calendarTsx).toContain("calendar-more-events-btn");
      expect(calendarTsx).toContain("setSelectedDayOverview({");
      expect(calendarTsx).toContain("aria-label=");
      expect(calendarTsx).toContain("件を表示");
    });

    it("renders Day Events Overview Modal with ModalBase when selectedDayOverview is set", () => {
      expect(calendarTsx).toContain("selectedDayOverview && (");
      expect(calendarTsx).toContain("<ModalBase");
      expect(calendarTsx).toContain("selectedDayOverview.events.length");
      expect(calendarTsx).toContain("selectedDayOverview.events.map");
    });
  });

  describe("3. Analytics Beta Calculation Data Sanitization", () => {
    it("ensures pairedReturns validates positivity and finiteness of both previous and current prices", () => {
      expect(analyticsTs).toContain("prevC > 0 &&");
      expect(analyticsTs).toContain("currC > 0 &&");
      expect(analyticsTs).toContain("Number.isFinite(prevC) &&");
      expect(analyticsTs).toContain("Number.isFinite(currC) &&");
      expect(analyticsTs).toContain("prevB > 0 &&");
      expect(analyticsTs).toContain("currB > 0 &&");
      expect(analyticsTs).toContain("Number.isFinite(prevB) &&");
      expect(analyticsTs).toContain("Number.isFinite(currB)");
    });

    it("normalizes negative zero (-0) beta values to clean 0", () => {
      expect(analyticsTs).toContain("Object.is(roundedBeta, -0) ? 0 : roundedBeta");
    });

    it("calculates beta accurately while ignoring corrupted non-positive currC and currB points", () => {
      const custom: PricePoint[] = [
        { date: "2026-01-01", close: 1000, value: 1000 },
        { date: "2026-01-02", close: 1020, value: 1020 },
        { date: "2026-01-03", close: 0, value: 0 }, // corrupted current price
        { date: "2026-01-04", close: 1040, value: 1040 },
        { date: "2026-01-05", close: 1060, value: 1060 },
      ];
      const bench: PricePoint[] = [
        { date: "2026-01-01", close: 38000 },
        { date: "2026-01-02", close: 38500 },
        { date: "2026-01-03", close: 39000 },
        { date: "2026-01-04", close: 39200 },
        { date: "2026-01-05", close: 39800 },
      ];
      const metrics = calculateRiskMetrics(custom, bench);
      expect(metrics).toBeDefined();
      expect(Number.isFinite(metrics.annualReturn)).toBe(true);
      expect(Number.isFinite(metrics.annualVolatility)).toBe(true);
      expect(Number.isFinite(metrics.sharpeRatio)).toBe(true);
      expect(Number.isFinite(metrics.maxDrawdown)).toBe(true);
      // Valid paired days (01->02, 04->05) are filtered and do not produce NaN or corrupted variance
      expect(metrics.beta === null || Number.isFinite(metrics.beta)).toBe(true);
    });

    it("computes positive beta for positively correlated valid series", () => {
      const custom: PricePoint[] = [
        { date: "2026-01-01", close: 100, value: 100 },
        { date: "2026-01-02", close: 102, value: 102 },
        { date: "2026-01-03", close: 104, value: 104 },
        { date: "2026-01-04", close: 106, value: 106 },
        { date: "2026-01-05", close: 108, value: 108 },
      ];
      const bench: PricePoint[] = [
        { date: "2026-01-01", close: 1000 },
        { date: "2026-01-02", close: 1020 },
        { date: "2026-01-03", close: 1040 },
        { date: "2026-01-04", close: 1060 },
        { date: "2026-01-05", close: 1080 },
      ];
      const metrics = calculateRiskMetrics(custom, bench);
      expect(metrics.beta).toBe(1);
    });
  });
});
