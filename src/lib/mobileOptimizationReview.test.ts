import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Mobile Optimization Comprehensive Review", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const indexHtmlPath = path.join(rootDir, "index.html");
  const indexCssPath = path.join(rootDir, "src", "index.css");
  const addStockModalPath = path.join(rootDir, "src", "components", "AddStockModal.tsx");
  const adminDashboardPath = path.join(rootDir, "src", "components", "AdminDashboard.tsx");
  const simulationPreviewPath = path.join(rootDir, "src", "components", "SimulationPreview.tsx");
  const indexBuilderContentPath = path.join(rootDir, "src", "components", "IndexBuilderContent.tsx");
  const editPasswordModalPath = path.join(rootDir, "src", "components", "EditPasswordModal.tsx");
  const headerPath = path.join(rootDir, "src", "components", "Header.tsx");

  const indexHtml = fs.readFileSync(indexHtmlPath, "utf-8");
  const indexCss = fs.readFileSync(indexCssPath, "utf-8");
  const addStockModal = fs.readFileSync(addStockModalPath, "utf-8");
  const adminDashboard = fs.readFileSync(adminDashboardPath, "utf-8");
  const simulationPreview = fs.readFileSync(simulationPreviewPath, "utf-8");
  const indexBuilderContent = fs.readFileSync(indexBuilderContentPath, "utf-8");
  const editPasswordModal = fs.readFileSync(editPasswordModalPath, "utf-8");
  const header = fs.readFileSync(headerPath, "utf-8");

  describe("1. Viewport & Safe Area Standards", () => {
    it("includes viewport-fit=cover in index.html for notch and safe area handling", () => {
      expect(indexHtml).toMatch(/<meta\s+name=["']viewport["']\s+content=["'][^"']*viewport-fit=cover[^"']*["']/i);
    });

    it("defines touch target standards for mobile menu button", () => {
      expect(indexCss).toMatch(/\.header-mobile-menu-btn\s*\{[^}]*min-height:\s*42px/s);
      expect(indexCss).toMatch(/\.header-mobile-menu-btn\s*\{[^}]*min-width:\s*42px/s);
    });

    it("defines touch target standards for modal and drawer close buttons", () => {
      expect(indexCss).toMatch(/\.sidebar-close-button,\s*\.modal-close-btn\s*\{[^}]*min-width:\s*40px/s);
      expect(indexCss).toMatch(/\.sidebar-close-button,\s*\.modal-close-btn\s*\{[^}]*min-height:\s*40px/s);
    });
  });

  describe("2. Modal & Dialog Form Responsive Layouts", () => {
    it("defines add-stock-form-grid with 1-column fallback on narrow screens", () => {
      expect(indexCss).toContain(".add-stock-form-grid");
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\.add-stock-form-grid[\s\S]*?grid-template-columns:\s*1fr/);
    });

    it("AddStockModal uses add-stock-form-grid classes instead of rigid inline grids", () => {
      expect(addStockModal).toContain("add-stock-form-grid");
      expect(addStockModal).toContain("add-stock-form-grid-secondary");
      expect(addStockModal).not.toContain('style={{ display: "grid", gridTemplateColumns: "1fr 2fr"');
      expect(addStockModal).not.toContain('style={{ display: "grid", gridTemplateColumns: "2fr 1fr"');
    });

    it("EditPasswordModal uses modal-footer-actions for comfortable touch interaction", () => {
      expect(editPasswordModal).toContain("modal-footer-actions");
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.modal-footer-actions\s*\{[^}]*flex-direction:\s*column-reverse/);
    });
  });

  describe("3. Admin Dashboard Mobile Optimization", () => {
    it("AdminDashboard implements admin-quick-add-stock-row responsive layout", () => {
      expect(adminDashboard).toContain("admin-quick-add-stock-row");
      expect(adminDashboard).toContain("admin-add-ticker-input");
      expect(adminDashboard).toContain("admin-add-name-input");
      expect(adminDashboard).toContain("admin-add-theme-input");
      expect(adminDashboard).toContain("admin-add-weight-input");
      expect(adminDashboard).toContain("admin-add-submit-btn");
      expect(adminDashboard).toContain("admin-index-edit-actions");
    });

    it("index.css defines responsive grid for admin-quick-add-stock-row on mobile", () => {
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.admin-quick-add-stock-row\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.admin-index-edit-actions\s*\{[^}]*flex-direction:\s*column-reverse/);
    });
  });

  describe("4. Simulation Preview & Timeframe Controls", () => {
    it("SimulationPreview uses simulation-timeframe-group class", () => {
      expect(simulationPreview).toContain("simulation-timeframe-group");
      expect(simulationPreview).toContain("simulation-tf-btn");
    });

    it("index.css enables horizontal touch scrolling for timeframe buttons on mobile", () => {
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.simulation-timeframe-group\s*\{[^}]*overflow-x:\s*auto/);
    });
  });

  describe("5. Index Builder Mobile Polish", () => {
    it("IndexBuilderContent uses builder-footer-actions and group classes", () => {
      expect(indexBuilderContent).toContain("builder-footer-actions");
      expect(indexBuilderContent).toContain("builder-footer-group");
    });

    it("index.css defines stacked full-width button actions for index builder on mobile", () => {
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.builder-footer-actions\s*\{[^}]*flex-direction:\s*column/);
    });
  });

  describe("6. Core Dashboard & Header Mobile Polish", () => {
    it("Header does not hardcode rigid inline padding on mobile menu button", () => {
      expect(header).not.toContain('style={{ padding: "5px 8px", fontSize: 12 }}');
      expect(header).toContain("header-mobile-menu-btn");
    });

    it("index.css defines dynamic responsive chart heights on mobile", () => {
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.chart-container\s*\{[^}]*height:\s*clamp\(/);
    });

    it("index.css defines flexible font scaling for StatsGrid values on small viewports", () => {
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.stat-value-main\s*\{[^}]*font-size:\s*clamp\(/);
    });

    it("index.css defines touch-friendly dimensions for Constituents mobile sort controls", () => {
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.mobile-sort-select\s*\{[^}]*min-height:\s*36px/);
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.mobile-sort-dir-btn\s*\{[^}]*min-height:\s*36px/);
    });
  });
});
