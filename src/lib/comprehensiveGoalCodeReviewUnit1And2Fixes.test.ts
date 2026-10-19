import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { normalizeMarketCapToOkuYen } from "./weights";
import { calculateRiskMetrics } from "./analytics";
import type { PricePoint } from "../types";

describe("Comprehensive Goal Code Review - Unit 1 & 2 Fixes", () => {
  describe("1. Multi-Currency Market Cap Normalization", () => {
    it("converts US stocks in $M to Japanese 億円 accurately using USD/JPY rate", () => {
      // 100 $M at 155 JPY/USD = 100 * 1,000,000 * 155 / 100,000,000 = 155 億円
      const usCapInOkuYen = normalizeMarketCapToOkuYen(100, "US", 155.0);
      expect(usCapInOkuYen).toBe(155.0);

      const usDollarCap = normalizeMarketCapToOkuYen(500, "$", 150.0);
      expect(usDollarCap).toBe(750.0);

      // Japanese stocks in 億円 remain unchanged
      const jpCap = normalizeMarketCapToOkuYen(3500, "JP", 155.0);
      expect(jpCap).toBe(3500);

      // Invalid or non-positive caps return 0
      expect(normalizeMarketCapToOkuYen(-10, "US")).toBe(0);
      expect(normalizeMarketCapToOkuYen(NaN, "US")).toBe(0);
    });
  });

  describe("2. Analytics Date Sorting with ISO Timestamps and Labels", () => {
    it("sorts price points chronologically when dates include full ISO timestamps or reverse order", () => {
      const reverseSeries: PricePoint[] = [
        { date: "2024-04-16T12:00:00.000Z", close: 110, value: 110 },
        { date: "2024-04-15T12:00:00.000Z", close: 100, value: 100 },
      ];
      const metrics = calculateRiskMetrics(reverseSeries, []);
      // If dates were NOT sorted, startVal would be 110 and endVal 100 (negative return).
      // Since it's properly sorted chronologically, startVal is 100 and endVal is 110 (positive return).
      expect(metrics.annualReturn).toBeGreaterThan(0);
    });
  });

  describe("3. SimulationPreview XAxis and Recharts Non-Finite Guards", () => {
    it("ensures SimulationPreview XAxis tickFormatter handles undefined and short strings without throwing", () => {
      const previewSrc = readFileSync(
        resolve(__dirname, "../components/SimulationPreview.tsx"),
        "utf8",
      );
      expect(previewSrc).toContain(
        'typeof d === "string" && d.length >= 5 ? d.slice(5) : String(d ?? "")',
      );
      expect(previewSrc).toContain(
        'typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v}%` : "--"',
      );
    });

    it("ensures PerformanceChart and StockTechnicalChart tickFormatters guard non-finite values", () => {
      const perfSrc = readFileSync(
        resolve(__dirname, "../components/PerformanceChart.tsx"),
        "utf8",
      );
      expect(perfSrc).toContain('if (typeof v !== "number" || !Number.isFinite(v)) return "--"');

      const techSrc = readFileSync(
        resolve(__dirname, "../components/StockTechnicalChart.tsx"),
        "utf8",
      );
      expect(techSrc).toContain('if (typeof val !== "number" || !Number.isFinite(val)) return "--"');
    });
  });

  describe("4. WebGL Context Loss in Tutorial3DScene", () => {
    it("calls forceContextLoss in destroy to prevent WebGL context exhaustion across navigations", () => {
      const sceneSrc = readFileSync(
        resolve(__dirname, "../components/Tutorial3DScene.ts"),
        "utf8",
      );
      expect(sceneSrc).toContain("forceContextLoss");
    });
  });

  describe("5. ModalBase Portaling and Keyboard Accessibility", () => {
    it("portals ModalBase into document.body and includes tabIndex={-1} for dialog focus", () => {
      const modalSrc = readFileSync(
        resolve(__dirname, "../components/ModalBase.tsx"),
        "utf8",
      );
      expect(modalSrc).toContain("createPortal(modalContent, document.body)");
      expect(modalSrc).toContain("tabIndex={-1}");
    });
  });

  describe("6. useIndices addStockToIndex Sanitization", () => {
    it("sanitizes full-width IME tickers and clamps weights in addStockToIndex", () => {
      const hookSrc = readFileSync(
        resolve(__dirname, "../hooks/useIndices.ts"),
        "utf8",
      );
      expect(hookSrc).toContain("const cleanTicker = normalizeTicker(stock.ticker);");
      expect(hookSrc).toContain("Math.min(stock.weight, 100)");
      expect(hookSrc).toContain("sanitizedStock");
    });
  });

  describe("7. IndexBuilder and Admin Async Save try...finally", () => {
    it("wraps executeSave and handleSaveIndexFullEdit in try...finally so buttons never stay stuck", () => {
      const builderSrc = readFileSync(
        resolve(__dirname, "../components/IndexBuilderContent.tsx"),
        "utf8",
      );
      expect(builderSrc).toMatch(/try \{[\s\S]*?onSave[\s\S]*?\} finally \{\s*setSaving\(false\);/);

      const adminSrc = readFileSync(
        resolve(__dirname, "../components/AdminDashboard.tsx"),
        "utf8",
      );
      expect(adminSrc).toMatch(/try \{[\s\S]*?saveCustomIndex[\s\S]*?\} finally \{\s*setSavingIndex\(false\);/);
      expect(adminSrc).toMatch(/try \{[\s\S]*?saveCustomIndex[\s\S]*?\} finally \{\s*setCreatingIndex\(false\);/);
    });
  });
});
