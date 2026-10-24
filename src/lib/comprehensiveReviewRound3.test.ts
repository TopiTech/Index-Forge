import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { equalizeWeightsExact, redistributeWeightsExact } from "./indexEngine";
import { safeRandomId } from "./randomId";

describe("Comprehensive Review Round 3 Hardening & Verification", () => {
  describe("1. ID Entropy and Collision Prevention Across Index Creation", () => {
    it("verifies App.tsx generates unique random-salted IDs for portfolio and screener indices", () => {
      const appCode = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
      expect(appCode).toMatch(/id:\s*`portfolio-\$\{Date\.now\(\)\}-\$\{safeRandomId\(6\)\}`/);
      expect(appCode).toMatch(/id:\s*`screener-\$\{Date\.now\(\)\}-\$\{safeRandomId\(6\)\}`/);
      expect(appCode).toContain('import { safeRandomId } from "./lib/randomId";');
    });

    it("verifies AdminDashboard.tsx generates random-salted IDs for admin custom indices", () => {
      const adminCode = readFileSync(
        resolve(__dirname, "../components/AdminDashboard.tsx"),
        "utf8",
      );
      expect(adminCode).toMatch(/const newId =\s*`idx-admin-\$\{Date\.now\(\)\}-\$\{safeRandomId\(6\)\}`/);
      expect(adminCode).toContain('import { safeRandomId } from "../lib/randomId";');
    });

    it("verifies IndexBuilderContent.tsx generates random-salted IDs for export and preview", () => {
      const builderCode = readFileSync(
        resolve(__dirname, "../components/IndexBuilderContent.tsx"),
        "utf8",
      );
      expect(builderCode).toMatch(/id:\s*`custom-export-\$\{Date\.now\(\)\}-\$\{safeRandomId\(6\)\}`/);
      expect(builderCode).toMatch(/id:\s*`temp-\$\{Date\.now\(\)\}-\$\{safeRandomId\(6\)\}`/);
    });

    it("generates 1000 IDs in tight loop without any collision", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        const id = `idx-${Date.now()}-${safeRandomId(6)}`;
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      expect(seen.size).toBe(1000);
    });
  });

  describe("2. Tutorial3DScene Global Window Resilience", () => {
    it("guards window.devicePixelRatio against missing window object", () => {
      const sceneCode = readFileSync(
        resolve(__dirname, "../components/Tutorial3DScene.ts"),
        "utf8",
      );
      expect(sceneCode).toContain(
        'const pixelRatio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;',
      );
      expect(sceneCode).toContain("this.renderer.setPixelRatio(Math.min(pixelRatio, 2));");
    });
  });

  describe("3. Weight Apportionment Exactness with Large Baskets & Low Decimals", () => {
    it("dynamically elevates precision when constituent count exceeds total units at requested decimals", () => {
      const basket150 = Array.from({ length: 150 }, (_, i) => ({
        ticker: `STK${i}`,
        weight: (i % 7) + 1,
      }));

      // At decimals = 0, totalUnits is 100, which cannot allocate >= 1 integer unit to 150 items.
      // Dynamic precision escalation ensures all items have positive weight and sum is strictly 100.
      const equalized = equalizeWeightsExact(basket150, 0);
      expect(equalized.length).toBe(150);
      expect(equalized.every((x) => x.weight > 0)).toBe(true);
      const eqSum = Number(equalized.reduce((sum, x) => sum + x.weight, 0).toFixed(4));
      expect(eqSum).toBe(100);

      const redistributed = redistributeWeightsExact(basket150, 0);
      expect(redistributed.length).toBe(150);
      expect(redistributed.every((x) => x.weight > 0)).toBe(true);
      const redSum = Number(redistributed.reduce((sum, x) => sum + x.weight, 0).toFixed(4));
      expect(redSum).toBe(100);
    });

    it("preserves standard 2-decimal precision for normal baskets", () => {
      const basket = [
        { ticker: "7203", weight: 50 },
        { ticker: "6758", weight: 30 },
        { ticker: "9984", weight: 20 },
      ];
      const equalized = equalizeWeightsExact(basket);
      expect(equalized.map((x) => x.weight)).toEqual([33.34, 33.33, 33.33]);
      expect(equalized.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(100, 2);

      const redistributed = redistributeWeightsExact(basket);
      expect(redistributed.map((x) => x.weight)).toEqual([50, 30, 20]);
      expect(redistributed.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(100, 2);
    });
  });
});
