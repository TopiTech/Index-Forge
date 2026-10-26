import { describe, it, expect } from "vitest";
import { isPricePoint, sanitizePriceSeries } from "../../worker/internal-impl";
import {
  VOLUME_DOMAIN_FALLBACK_MAX,
  VOLUME_DOMAIN_SCALE,
  volumeYAxisDomainMax,
} from "../components/StockTechnicalChart";

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

  describe("StockTechnicalChart Volume YAxis Domain Safeguard (behavioral)", () => {
    it("scales a positive finite maximum instead of collapsing the domain", () => {
      expect(volumeYAxisDomainMax(1000)).toBe(1000 * VOLUME_DOMAIN_SCALE);
      expect(volumeYAxisDomainMax(0.5)).toBe(0.5 * VOLUME_DOMAIN_SCALE);
    });

    it("falls back for zero, negative or non-finite maxima", () => {
      // A [0, 0] or NaN domain breaks the SVG scale; the volume-less chart
      // (e.g. close-only snapshot windows) must still render.
      expect(volumeYAxisDomainMax(0)).toBe(VOLUME_DOMAIN_FALLBACK_MAX);
      expect(volumeYAxisDomainMax(-50)).toBe(VOLUME_DOMAIN_FALLBACK_MAX);
      expect(volumeYAxisDomainMax(Number.NaN)).toBe(VOLUME_DOMAIN_FALLBACK_MAX);
      expect(volumeYAxisDomainMax(Number.POSITIVE_INFINITY)).toBe(VOLUME_DOMAIN_FALLBACK_MAX);
      expect(volumeYAxisDomainMax(undefined)).toBe(VOLUME_DOMAIN_FALLBACK_MAX);
    });

    // No-synthesis is covered behaviorally by
    // `src/components/stockTechnicalChartSeries.test.ts` (close-only series
    // carry no volume key; zero/non-finite volumes are dropped) and by the
    // Bar gating render tests in
    // `src/components/stockTechnicalChartVolume.test.tsx`, so the
    // `not.toContain("pointVolume"/"dynamicVol")` and `<Bar …>` source pins
    // are deleted without coverage loss.
  });
});
