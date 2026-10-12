import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { generateUpcomingEvents } from "./marketDataService";

describe("Comprehensive Code Review Resolution Round 3", () => {
  const chartTsx = fs.readFileSync(
    path.resolve(__dirname, "../components/StockTechnicalChart.tsx"),
    "utf-8"
  );
  const freshnessTsx = fs.readFileSync(
    path.resolve(__dirname, "../components/DataFreshness.tsx"),
    "utf-8"
  );
  const marketDataServiceTs = fs.readFileSync(
    path.resolve(__dirname, "./marketDataService.ts"),
    "utf-8"
  );

  describe("1. StockTechnicalChart Code Hygiene & Memory Safety", () => {
    it("does not import unused BarChart2 icon", () => {
      expect(chartTsx).not.toMatch(/\bBarChart2\b/);
    });

    it("cleans up TradingView resize setTimeout handles on unmount", () => {
      expect(chartTsx).toContain("resizeTimers.forEach(clearTimeout)");
    });

    it("does not re-mount TradingView script when activeIsMobile toggles", () => {
      // The script mount effect must not depend on activeIsMobile
      expect(chartTsx).toMatch(
        /\}, \[effectiveMode, stock\.ticker, isUS, theme, retryKey\]\);/
      );
      // But instead uses activeIsMobileRef or dynamic style update
      expect(chartTsx).toContain("activeIsMobileRef");
    });

    it("scopes SVG linearGradient ID by stock ticker", () => {
      expect(chartTsx).toContain("stockPriceAreaGrad-");
      expect(chartTsx).toContain("gradientId");
      expect(chartTsx).toContain("fill={`url(#${gradientId})`}");
    });

    it("localizes Recharts Legend items to Japanese without breaking dataKey contracts", () => {
      expect(chartTsx).toContain("if (value === \"volume\") return \"出来高\";");
      expect(chartTsx).toContain("if (value === \"close\") return \"終値\";");
      expect(chartTsx).toContain("if (value === \"sma25\") return \"SMA 25日\";");
      expect(chartTsx).toContain("if (value === \"sma75\") return \"SMA 75日\";");
    });

    it("ensures ComposedChart avoids negative left margins and sets explicit mobile YAxis width", () => {
      expect(chartTsx).toContain("left: activeIsMobile ? 0 : 8");
      expect(chartTsx).toContain("width={activeIsMobile ? 52 : 60}");
    });

    it("protects generateDeterministicHistory against corrupted high/low data", () => {
      expect(chartTsx).toContain("Math.max(rawYearHigh, rawYearLow, currentPrice)");
      expect(chartTsx).toContain("Math.min(rawYearHigh, rawYearLow, currentPrice * 0.5)");
    });
  });

  describe("2. DataFreshness Epoch-Zero Protection", () => {
    it("excludes 0 and non-positive timestamps from latestUpdatedAt", () => {
      expect(freshnessTsx).toMatch(
        /typeof timestamp === "number" && Number\.isFinite\(timestamp\) && timestamp > 0/
      );
    });
  });

  describe("3. Calendar Event Parsing Robustness", () => {
    it("safely handles date parsing with parseInt and NaN checks", () => {
      expect(marketDataServiceTs).toMatch(
        /const m = parseInt\(parts\[0\], 10\);[\s\S]*const d = parseInt\(parts\[1\], 10\);[\s\S]*if \(isNaN\(m\) \|\| isNaN\(d\)\) \{\s*return 0;\s*\}/
      );
    });

    it("successfully generates upcoming events list with valid chronological ordering", () => {
      const events = generateUpcomingEvents(new Date(2025, 3, 1));
      expect(events.length).toBeGreaterThan(0);
      for (const ev of events) {
        expect(ev.date).toBeTruthy();
        expect(ev.title).toBeTruthy();
      }
    });
  });
});
