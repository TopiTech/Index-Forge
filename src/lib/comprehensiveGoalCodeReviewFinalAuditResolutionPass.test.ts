import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getTechnicalSignalBadgeClass, buildScreenerCsvRows, type ScreenerCsvRow } from "../components/ScreenerPage";

describe("Comprehensive Goal Code Review Final Audit Resolution Verification", () => {
  describe("Unit 1: ScreenerPage Technical Signal Null-Safety & Badge Class Guard", () => {
    it("safely evaluates technicalSignal classes for all standard signals", () => {
      expect(getTechnicalSignalBadgeClass("STRONG_BUY")).toBe("badge-accent");
      expect(getTechnicalSignalBadgeClass("BUY")).toBe("badge-success");
      expect(getTechnicalSignalBadgeClass("SELL")).toBe("badge-danger");
      expect(getTechnicalSignalBadgeClass("STRONG_SELL")).toBe("badge-danger");
      expect(getTechnicalSignalBadgeClass("NEUTRAL")).toBe("badge-default");
    });

    it("safely handles undefined, null, non-string, or unknown values without TypeError", () => {
      expect(getTechnicalSignalBadgeClass(undefined)).toBe("badge-default");
      expect(getTechnicalSignalBadgeClass(null)).toBe("badge-default");
      expect(getTechnicalSignalBadgeClass("")).toBe("badge-default");
      expect(getTechnicalSignalBadgeClass("UNKNOWN_SIGNAL")).toBe("badge-default");
      expect(getTechnicalSignalBadgeClass(12345)).toBe("badge-default");
      expect(getTechnicalSignalBadgeClass(NaN)).toBe("badge-default");
      expect(getTechnicalSignalBadgeClass({})).toBe("badge-default");
      expect(getTechnicalSignalBadgeClass([])).toBe("badge-default");
      expect(getTechnicalSignalBadgeClass(true)).toBe("badge-default");
    });

    it("ensures buildScreenerCsvRows does not throw when technicalSignal is missing or irregular", () => {
      const mockRows: ScreenerCsvRow[] = [
        {
          ticker: "7203",
          name: "Toyota",
          market: "PRIME",
          theme: "Auto",
          price: 2500,
          changePercent: 1.5,
          dividendYield: 2.8,
          per: 10.5,
          pbr: 1.1,
          roe: 12.0,
          technicalSignal: "STRONG_BUY",
        },
        {
          ticker: "9999",
          name: "Corrupted Corp",
          market: "GROWTH",
          theme: "Tech",
          price: null,
          changePercent: null,
          dividendYield: null,
          per: null,
          pbr: null,
          roe: null,
          // Intentionally passing undefined/coerced signal to test export immunity
          technicalSignal: undefined as unknown as string,
        },
      ];

      const csvRows = buildScreenerCsvRows(mockRows);
      expect(csvRows).toHaveLength(2);
      expect(csvRows[0][10]).toBe('"STRONG_BUY"');
      expect(csvRows[1][10]).toBe('""');
    });

    it("verifies static code in ScreenerPage uses safe getTechnicalSignalBadgeClass and guards text display", () => {
      const screenerCode = readFileSync(
        resolve(__dirname, "../components/ScreenerPage.tsx"),
        "utf-8",
      );
      // Ensure no raw unguarded stock.technicalSignal.includes(...) exists in the component
      expect(screenerCode).not.toContain("stock.technicalSignal.includes");
      // Ensure getTechnicalSignalBadgeClass is invoked in both desktop table and mobile card
      const matches = screenerCode.match(/getTechnicalSignalBadgeClass\(stock\.technicalSignal\)/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
      // Ensure fallback text is guarded
      expect(screenerCode).toContain('typeof stock.technicalSignal === "string" && stock.technicalSignal');
    });
  });

  describe("Unit 2: Tutorial3DScene Type Rigor & Removal of Double Casts", () => {
    it("declares step3Beacon as THREE.Group | null and avoids as unknown as THREE.Mesh", () => {
      const tutorialCode = readFileSync(
        resolve(__dirname, "../components/Tutorial3DScene.ts"),
        "utf-8",
      );
      // step3Beacon field should be typed as THREE.Group | null
      expect(tutorialCode).toMatch(/private\s+step3Beacon:\s*THREE\.Group\s*\|\s*null\s*=\s*null;/);
      // No double cast should exist
      expect(tutorialCode).not.toContain("beaconGroup as unknown as THREE.Mesh");
      expect(tutorialCode).not.toContain("as unknown as THREE.Mesh");
      // Should assign beaconGroup directly
      expect(tutorialCode).toContain("this.step3Beacon = beaconGroup;");
    });
  });

  describe("Unit 3: IndexBuilderModal CSS Consolidation & Removal of Z-Index Double Cast", () => {
    it("delegates overlay styling to .modal-overlay CSS class and eliminates inline zIndex double cast", () => {
      const modalCode = readFileSync(
        resolve(__dirname, "../components/IndexBuilderModal.tsx"),
        "utf-8",
      );
      // Ensure the double type assertion is eliminated
      expect(modalCode).not.toContain("as unknown as number");
      // Ensure modalContent uses .modal-overlay class without duplicate inline position/zIndex styles
      expect(modalCode).toContain('className="modal-overlay"');
      expect(modalCode).not.toMatch(/className="modal-overlay"[\s\S]*?zIndex:\s*"var\(--z-modal-overlay\)"/);
    });
  });
});
