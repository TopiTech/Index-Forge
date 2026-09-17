import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Mobile & Visual Enhancements Verification", () => {
  const indexCss = readFileSync(resolve(__dirname, "../index.css"), "utf8");
  const modalTsx = readFileSync(resolve(__dirname, "../components/TradingViewChartModal.tsx"), "utf8");
  const statsTsx = readFileSync(resolve(__dirname, "../components/StatsGrid.tsx"), "utf8");
  const perfTsx = readFileSync(resolve(__dirname, "../components/PerformanceChart.tsx"), "utf8");
  const sceneTs = readFileSync(resolve(__dirname, "../components/Tutorial3DScene.ts"), "utf8");

  describe("1. TradingView Auto-Shrink Bug Prevention", () => {
    it("guards ResizeObserver against animated transitions and maximize state", () => {
      expect(modalTsx).toContain("if (isAnimating || isMaximized) return;");
    });

    it("uses borderBoxSize or offsetWidth to prevent content-box border recursive shrinkage", () => {
      expect(modalTsx).toContain("borderBoxSize");
      expect(modalTsx).toContain("Math.abs(borderBoxW - dimensions.width) > 4");
    });
  });

  describe("2. Mobile Responsive Grid & Typography", () => {
    it("renders chart-stats-summary as a 2x2 grid on mobile viewports", () => {
      expect(indexCss).toContain(".chart-stats-summary {");
      expect(indexCss).toMatch(/\.chart-stats-summary\s*\{[^}]*display:\s*grid\s*!important/);
      expect(indexCss).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important/);
    });

    it("uses flex-wrap and thumb-friendly sizing on chart controls", () => {
      expect(indexCss).toContain(".chart-mode-row {");
      expect(indexCss).toMatch(/\.chart-mode-row\s*\{[^}]*flex-wrap:\s*wrap/);
      expect(indexCss).toMatch(/min-height:\s*32px/);
    });

    it("applies column layout on mobile stat-sub-row to prevent badge and subtext overlapping", () => {
      expect(indexCss).toMatch(/\.stat-sub-row\s*\{[^}]*flex-direction:\s*column/);
    });

    it("defines responsive styles for risk-metrics-grid", () => {
      expect(indexCss).toContain(".risk-metrics-grid {");
      expect(indexCss).toMatch(/\.risk-metrics-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    });

    it("uses concise labels in StatsGrid to avoid truncation", () => {
      expect(statsTsx).toContain("アウトパフォーム");
      expect(statsTsx).toContain("アンダーパフォーム");
    });

    it("uses concise 1Y label in PerformanceChart for clean mobile button alignment", () => {
      expect(perfTsx).toContain('{ label: "1Y", value: "1Y" }');
    });
  });

  describe("3. Rich Three.js 3D Tutorial Visuals", () => {
    it("implements dynamic financial ribbon curves in Step 1", () => {
      expect(sceneTs).toContain("CatmullRomCurve3");
      expect(sceneTs).toContain("TubeGeometry");
      expect(sceneTs).toContain("buildStep1Objects");
    });

    it("implements multi-sector extruded 3D pie ring in Step 2", () => {
      expect(sceneTs).toContain("ExtrudeGeometry");
      expect(sceneTs).toContain("buildStep2Objects");
      expect(sceneTs).toContain("step2SectorArcs");
    });

    it("implements volatility landscape and 3D heatmap bars in Step 3", () => {
      expect(sceneTs).toContain("buildStep3Objects");
      expect(sceneTs).toContain("step3HeatmapBars");
      expect(sceneTs).toContain("step3Beacon");
    });

    it("implements quantum assembling blocks in Step 4", () => {
      expect(sceneTs).toContain("buildStep4Objects");
      expect(sceneTs).toContain("step4Blocks");
      expect(sceneTs).toContain("step4CoreEnergyRing");
    });
  });
});
