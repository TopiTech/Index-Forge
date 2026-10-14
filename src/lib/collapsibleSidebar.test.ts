import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Collapsible Main Sidebar Feature", () => {
  const sidebarSource = fs.readFileSync(
    path.resolve(__dirname, "../components/Sidebar.tsx"),
    "utf-8",
  );
  const appSource = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf-8");
  const indexCss = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf-8");
  const tokensCss = fs.readFileSync(
    path.resolve(__dirname, "../styles/tokens.css"),
    "utf-8",
  );

  describe("Tokens and Layout Constants", () => {
    it("defines --sidebar-collapsed-width in tokens.css", () => {
      expect(tokensCss).toMatch(/--sidebar-collapsed-width:\s*64px;/);
    });

    it("defines .app-shell.sidebar-collapsed with reduced grid column", () => {
      expect(indexCss).toMatch(
        /\.app-shell\.sidebar-collapsed\s*\{[^}]*grid-template-columns:\s*var\(--sidebar-collapsed-width/s,
      );
    });

    it("applies smooth transitions for sidebar width and shell grid", () => {
      expect(indexCss).toMatch(/transition:\s*grid-template-columns\s*0\.25s/);
      expect(indexCss).toMatch(/transition:\s*width\s*0\.25s/);
    });
  });

  describe("Sidebar Component Collapse State and Controls", () => {
    it("supports isCollapsed and onToggleCollapse props", () => {
      expect(sidebarSource).toContain("isCollapsed?: boolean;");
      expect(sidebarSource).toContain("onToggleCollapse?: () => void;");
    });

    it("renders desktop collapse toggle button with accessible labels and aria-expanded", () => {
      expect(sidebarSource).toContain("sidebar-collapse-btn");
      expect(sidebarSource).toContain('aria-expanded={!isCollapsed}');
      expect(sidebarSource).toContain('aria-label={isCollapsed ? "サイドバーを展開" : "サイドバーを格納"}');
    });

    it("applies is-collapsed class to desktop aside element", () => {
      expect(sidebarSource).toMatch(
        /className=\{`global-sidebar \$\{isCollapsed \? "is-collapsed" : ""\}`\}/,
      );
    });

    it("renders PanelLeftClose and PanelLeftOpen icons", () => {
      expect(sidebarSource).toContain("PanelLeftClose");
      expect(sidebarSource).toContain("PanelLeftOpen");
    });
  });

  describe("App Component Persistence and Synchronization", () => {
    it("persists collapsed state in localStorage under indexforge:sidebar:collapsed", () => {
      expect(appSource).toContain('"indexforge:sidebar:collapsed"');
      expect(appSource).toContain("isDesktopSidebarCollapsed");
      expect(appSource).toContain("handleToggleDesktopSidebar");
    });

    it("passes collapsed state and toggle handler to PageLayout and Sidebar", () => {
      expect(appSource).toContain('<div className="app-shell">');
      expect(appSource).toContain("isCollapsed={isDesktopSidebarCollapsed}");
      expect(appSource).toContain("onToggleCollapse={handleToggleDesktopSidebar}");
    });
  });
});
