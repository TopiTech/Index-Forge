// @vitest-environment jsdom
/**
 * Regression suite for the collapsible sidebar.
 *
 * UI-12 split one collapse control into two distinct ones: the navigation
 * rail ("ナビゲーションを格納/展開") and the dashboard's index column
 * ("指数一覧を格納/開く"). Both keep `aria-expanded`, and their accessible
 * names must not overlap, otherwise a screen-reader user cannot tell which
 * panel the button controls.
 *
 * The jsdom environment externalizes the Node built-ins, so the stylesheets
 * are read through `process.getBuiltinModule` (which resolves the real
 * `node:fs` without a static import) and the sources through Vite's `?raw`
 * suffix.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { Sidebar } from "../components/Sidebar";

import appSource from "../App.tsx?raw";
import sidebarSource from "../components/Sidebar.tsx?raw";

const nodeFs = process.getBuiltinModule("node:fs") as {
  readFileSync: (path: string, encoding: "utf8") => string;
};
const nodePath = process.getBuiltinModule("node:path") as {
  join: (...parts: string[]) => string;
};
const readRepoFile = (relativePath: string): string =>
  nodeFs.readFileSync(nodePath.join(process.cwd(), relativePath), "utf8");

const indexCss = readRepoFile("src/index.css");
const tokensCss = readRepoFile("src/styles/tokens.css");

afterEach(() => {
  cleanup();
});

function renderSidebar(isCollapsed: boolean) {
  return render(
    createElement(Sidebar, {
      currentView: "dashboard",
      navigateTo: vi.fn(),
      isOpen: false,
      onRequestClose: vi.fn(),
      isCollapsed,
      onToggleCollapse: vi.fn(),
    }),
  );
}

describe("Collapsible Main Sidebar Feature", () => {
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
      // Expanded rail: the button offers to collapse the navigation.
      renderSidebar(false);
      const expandedToggle = screen.getByRole("button", { name: "ナビゲーションを格納" });
      expect(expandedToggle.getAttribute("aria-expanded")).toBe("true");
      expect(expandedToggle.getAttribute("aria-controls")).toBe("global-nav-desktop");

      cleanup();

      // Collapsed rail: the button offers to expand the navigation again.
      renderSidebar(true);
      const collapsedToggle = screen.getByRole("button", { name: "ナビゲーションを展開" });
      expect(collapsedToggle.getAttribute("aria-expanded")).toBe("false");
      expect(collapsedToggle.getAttribute("aria-controls")).toBe("global-nav-desktop");
    });

    it("applies is-collapsed class to desktop aside element", () => {
      const { container } = renderSidebar(true);
      const aside = container.querySelector("aside.global-sidebar");
      expect(aside).not.toBeNull();
      expect(aside!.className).toContain("is-collapsed");
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

    it("gives the index-column collapse control its own distinct label and aria-expanded", () => {
      // The index column is a different panel than the navigation rail, so its
      // control must not reuse the rail's accessible name.
      expect(appSource).toContain("isDesktopSidebarOpen ? \"指数一覧を格納\" : \"指数一覧を開く\"");
      expect(appSource).toContain("aria-expanded={isDesktopSidebarOpen}");
      expect(appSource).toContain('aria-controls="index-sidebar"');

      const railLabels = ["ナビゲーションを格納", "ナビゲーションを展開"];
      const columnLabels = ["指数一覧を格納", "指数一覧を開く"];
      for (const rail of railLabels) {
        expect(columnLabels).not.toContain(rail);
      }
    });
  });
});
