import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Comprehensive Project Review & Fixes Verification", () => {
  const indexCss = readFileSync(resolve(__dirname, "../index.css"), "utf8");
  const useSimTs = readFileSync(resolve(__dirname, "../hooks/useSimulation.ts"), "utf8");
  const canvasTsx = readFileSync(resolve(__dirname, "../components/Tutorial3DCanvas.tsx"), "utf8");
  const mobileTestTs = readFileSync(resolve(__dirname, "./mobileAndVisualEnhancements.test.ts"), "utf8");

  describe("1. ESLint Integrity & Clean Imports", () => {
    it("ensures mobileAndVisualEnhancements.test.ts contains no unused imports", () => {
      expect(mobileTestTs).not.toContain("beforeEach");
      expect(mobileTestTs).not.toContain("afterEach");
      expect(mobileTestTs).not.toContain(", vi");
      expect(mobileTestTs).toContain('import { describe, it, expect } from "vitest";');
    });
  });

  describe("2. useSimulation Unmount Cleanup & Resource Safety", () => {
    it("registers an unmount effect to abort inflight simulation fetch requests", () => {
      expect(useSimTs).toContain("// Cancel inflight simulation requests when component unmounts");
      expect(useSimTs).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*return\s*\(\)\s*=>\s*\{\s*if\s*\(abortRef\.current\)\s*\{\s*abortRef\.current\.abort\(\);\s*\}\s*\};\s*\}, \[\]\);/);
    });
  });

  describe("3. Tutorial3DCanvas Wheel Zoom & Non-Hijacking Scroll", () => {
    it("guards wheel zoom so normal page scroll is not intercepted without Ctrl/Meta", () => {
      expect(canvasTsx).toContain("if (e.ctrlKey || e.metaKey)");
      expect(canvasTsx).toContain("e.preventDefault();");
      expect(canvasTsx).toContain("sceneRef.current.zoomCamera(e.deltaY * zoomSpeed);");
    });

    it("announces Ctrl+scroll zoom option in aria-label and hint text", () => {
      expect(canvasTsx).toContain("Ctrl+スクロールでズーム");
    });
  });

  describe("4. Mobile Responsive Risk Metrics Grid Symmetry", () => {
    it("spans the last odd item across 2 columns on mobile viewports", () => {
      expect(indexCss).toMatch(/\.risk-metrics-grid\s*>\s*:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*span 2;/);
    });

    it("resets span to 1 column on extra small single-column viewports", () => {
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*350px\)\s*\{[\s\S]*?\.risk-metrics-grid\s*>\s*:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*span 1;/);
    });
  });
});
