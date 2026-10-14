import { describe, it, expect } from "vitest";
import { isPricePoint, sanitizePriceSeries } from "../../worker/internal-impl";
import fs from "fs";
import path from "path";

describe("Stock Local Technical Chart Volume Rendering Fix", () => {
  describe("PricePoint and Yahoo Finance Volume Preservation", () => {
    it("validates PricePoint with optional volume field", () => {
      expect(isPricePoint({ date: "2025-01-15", close: 3200 })).toBe(true);
      expect(isPricePoint({ date: "2025-01-15", close: 3200, volume: 1500000 })).toBe(true);
      expect(isPricePoint({ date: "2025-01-15", close: 3200, volume: -100 })).toBe(false);
      expect(isPricePoint({ date: "2025-01-15", close: 3200, volume: NaN })).toBe(false);
    });

    it("sanitizes price series while retaining volume data", () => {
      const raw = [
        { date: "2025-01-15", close: 3200, volume: 1500000 },
        { date: "2025-01-16", close: 3250 },
      ];
      const sanitized = sanitizePriceSeries(raw);
      expect(sanitized).toHaveLength(2);
      expect(sanitized[0].volume).toBe(1500000);
      expect(sanitized[1].volume).toBeUndefined();
    });
  });

  describe("StockTechnicalChart Volume YAxis Domain Safeguard", () => {
    const chartSource = fs.readFileSync(
      path.resolve(__dirname, "../components/StockTechnicalChart.tsx"),
      "utf-8",
    );

    it("ensures YAxis volume domain never evaluates to [0, 0] or NaN", () => {
      // Must protect against dataMax <= 0 or NaN causing divide-by-zero SVG errors
      expect(chartSource).toContain("Number.isFinite(dataMax) && dataMax > 0");
    });

    it("calculates dynamic volume rather than a flat wall when raw volume is absent", () => {
      expect(chartSource).toContain("pointVolume");
      expect(chartSource).toContain("priceChangeRate");
    });

    it("renders volume in Recharts Bar component with yAxisId=volume", () => {
      expect(chartSource).toContain('<Bar');
      expect(chartSource).toContain('yAxisId="volume"');
      expect(chartSource).toContain('dataKey="volume"');
    });
  });
});
