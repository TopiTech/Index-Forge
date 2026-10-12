import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseViewFromLocation, getViewPath } from "./navigation";

const footerSource = readFileSync(resolve(__dirname, "../components/Footer.tsx"), "utf8");
const sidebarSource = readFileSync(resolve(__dirname, "../components/Sidebar.tsx"), "utf8");
const appSource = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
const cssSource = readFileSync(resolve(__dirname, "../index.css"), "utf8");

describe("Developer Profile Navigation & Link Verification", () => {
  describe("Navigation Routing", () => {
    it("resolves /about and /profile paths to the about view", () => {
      expect(parseViewFromLocation("/about")).toBe("about");
      expect(parseViewFromLocation("/profile")).toBe("about");
    });

    it("resolves ?page=about and ?page=profile query parameters to the about view", () => {
      expect(parseViewFromLocation("/", "?page=about")).toBe("about");
      expect(parseViewFromLocation("/", "?page=profile")).toBe("about");
    });

    it("keeps portfolio path mapped to assets portfolio manager", () => {
      expect(parseViewFromLocation("/portfolio")).toBe("portfolio");
      expect(parseViewFromLocation("/", "?page=portfolio")).toBe("portfolio");
    });

    it("returns /about for getViewPath('about')", () => {
      expect(getViewPath("about")).toBe("/about");
    });
  });

  describe("Footer 'Developed by' Clickable Link", () => {
    it("renders 'Developed by とぴ / TopiTech' as a clickable link in Footer.tsx", () => {
      expect(footerSource).toContain('href={getViewPath("about")}');
      expect(footerSource).toContain('className="footer-creator-note is-link"');
      expect(footerSource).toContain("Developed by");
      expect(footerSource).toContain("とぴ / TopiTech");
    });

    it("includes proper accessibility aria-label and title attributes", () => {
      expect(footerSource).toContain('title="開発者の自己紹介ページを開く"');
      expect(footerSource).toContain('aria-label="開発者の自己紹介ページを開く"');
    });

    it("handles in-app navigation via onNavigate('about') on click", () => {
      expect(footerSource).toMatch(/onNavigate\("about"\)/);
    });

    it("provides developer profile link in SNS & 開発者リンク list", () => {
      expect(footerSource).toContain('aria-label="開発者自己紹介ページ（プロフィール & ポートフォリオ）"');
      expect(footerSource).toContain("開発者自己紹介");
    });
  });

  describe("Sidebar Integration", () => {
    it("includes developer profile navigation item in Sidebar.tsx", () => {
      expect(sidebarSource).toContain('view: "about"');
      expect(sidebarSource).toContain('label: "開発者自己紹介"');
    });
  });

  describe("App.tsx Lazy Loading & View Routing", () => {
    it("lazy loads PortfolioPage component", () => {
      expect(appSource).toMatch(
        /const PortfolioPage = lazy\(\(\) =>\s*import\("\.\/components\/PortfolioPage"\)/,
      );
    });

    it("renders PortfolioPage when currentView is 'about'", () => {
      expect(appSource).toMatch(
        /if \(currentView === "about"\) \{\s*return \([\s\S]*?<PortfolioPage onNavigate=\{navigateTo\} \/>/,
      );
    });
  });

  describe("Interactive Hover & A11y CSS Styling", () => {
    it("styles a.footer-creator-note with hover and focus states in index.css", () => {
      expect(cssSource).toContain("a.footer-creator-note");
      expect(cssSource).toContain("a.footer-creator-note:hover");
      expect(cssSource).toContain("a.footer-creator-note:focus-visible");
    });
  });
});
