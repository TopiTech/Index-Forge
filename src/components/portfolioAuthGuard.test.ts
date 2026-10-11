import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Portfolio Page Authentication Guard & Access Control", () => {
  const portfolioTsx = readFileSync(
    resolve(process.cwd(), "src/components/PortfolioManagerPage.tsx"),
    "utf-8"
  );
  const sidebarTsx = readFileSync(
    resolve(process.cwd(), "src/components/Sidebar.tsx"),
    "utf-8"
  );
  const cssCode = readFileSync(
    resolve(process.cwd(), "src/index.css"),
    "utf-8"
  );

  describe("1. PortfolioManagerPage Authentication Gating", () => {
    it("imports and invokes useAuth hook for session authentication state", () => {
      expect(portfolioTsx).toContain('import { useAuth } from "../hooks/useAuth";');
      expect(portfolioTsx).toMatch(/const\s*\{\s*isAuthenticated.*\}\s*=\s*useAuth\(\)/);
    });

    it("guards portfolio render with an unauthenticated lock screen gate", () => {
      expect(portfolioTsx).toContain("if (!isAuthenticated)");
      expect(portfolioTsx).toContain("portfolio-auth-gate");
      expect(portfolioTsx).toContain("portfolio-gate-card");
      expect(portfolioTsx).toContain("ポートフォリオのロック解除");
    });

    it("provides accessible password login form for inline unlock", () => {
      expect(portfolioTsx).toContain('htmlFor="portfolio-auth-input"');
      expect(portfolioTsx).toContain('id="portfolio-auth-input"');
      expect(portfolioTsx).toContain('autoComplete="current-password"');
      expect(portfolioTsx).toContain("handleInlineLogin");
      expect(portfolioTsx).toContain("ログインして利用開始");
      expect(portfolioTsx).toContain("ダッシュボードへ戻る");
    });

    it("shows error alert with role='alert' when authentication fails", () => {
      expect(portfolioTsx).toContain('role="alert"');
      expect(portfolioTsx).toContain('aria-live="assertive"');
      expect(portfolioTsx).toContain("{authError}");
    });

    it("guards storage loading and saving behind isAuthenticated state", () => {
      // Data must be loaded conditionally on auth
      expect(portfolioTsx).toMatch(/isAuthenticated\s*\?\s*loadPortfolioPositions\(\)\s*:\s*\[\]/);
      expect(portfolioTsx).toMatch(/isAuthenticated\s*\?\s*loadWatchlist\(\)\s*:\s*\[\]/);
      // Data persistence must only trigger when authenticated
      expect(portfolioTsx).toMatch(/if\s*\(isAuthenticated\)\s*\{\s*savePortfolioPositions\(positions\);/);
      expect(portfolioTsx).toMatch(/if\s*\(isAuthenticated\)\s*\{\s*saveWatchlist\(watchlist\);/);
    });

    it("does not bind unused session and synchronizes state on inline login", () => {
      expect(portfolioTsx).not.toMatch(/const\s*\{[^}]*session[^}]*\}\s*=\s*useAuth\(\)/);
      expect(portfolioTsx).toContain("setPositions(loadPortfolioPositions())");
    });
  });

  describe("2. Sidebar Navigation Login Indication", () => {
    it("reads isAuthenticated from useAuth in Sidebar", () => {
      expect(sidebarTsx).toMatch(/const\s*\{[^}]*isAuthenticated[^}]*\}\s*=\s*useAuth\(\)/);
    });

    it("indicates login requirement for portfolio navigation entry when unauthenticated", () => {
      expect(sidebarTsx).toContain('view === "portfolio" && !isAuthenticated');
      expect(sidebarTsx).toContain("要ログイン");
      expect(sidebarTsx).toContain("<Lock");
    });

    it("applies nav-lock-badge class to the locked badge in Sidebar", () => {
      expect(sidebarTsx).toContain("nav-lock-badge");
    });

    it("preserves standard title and accessible navigation labels", () => {
      expect(sidebarTsx).toContain('title: "保有資産管理・損益トラッカー&指数化連携"');
      expect(sidebarTsx).toContain("aria-label={`${label}へ移動`}");
    });
  });

  describe("3. Visual Design and CSS Styling", () => {
    it("defines portfolio auth gate container and card styles", () => {
      expect(cssCode).toContain(".portfolio-auth-gate");
      expect(cssCode).toContain(".portfolio-gate-card");
      expect(cssCode).toMatch(/\.portfolio-gate-card\s*\{[^}]*transition/);
    });

    it("includes light mode theme support for the portfolio gate card", () => {
      expect(cssCode).toContain('[data-theme="light"] .portfolio-gate-card');
    });

    it("styles the sidebar locked item and badge", () => {
      expect(cssCode).toContain(".nav-item-locked");
      expect(cssCode).toContain(".nav-lock-badge");
    });
  });
});
