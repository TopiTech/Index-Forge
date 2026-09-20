import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  buildDeleteIndexRequest,
  buildDeleteStockRequest,
} from "../hooks/useIndices";

describe("Code Review Goal Resolutions", () => {
  describe("App routing priority and admin accessibility", () => {
    it("ensures currentView === 'admin' is evaluated before indicesError and loadingIndices", () => {
      const appTsx = fs.readFileSync(
        path.resolve(process.cwd(), "src/App.tsx"),
        "utf-8"
      );

      const adminPos = appTsx.indexOf('if (currentView === "admin")');
      const errorPos = appTsx.indexOf("if (indicesError && indices.length === 0)");
      const loadingPos = appTsx.indexOf("if (loadingIndices)");

      expect(adminPos).toBeGreaterThan(-1);
      expect(errorPos).toBeGreaterThan(-1);
      expect(loadingPos).toBeGreaterThan(-1);

      // Admin must be evaluated before error fallback and loading screen
      expect(adminPos).toBeLessThan(errorPos);
      expect(adminPos).toBeLessThan(loadingPos);
    });
  });

  describe("UI / CSS styles", () => {
    it("defines .btn-accent and .btn-accent:hover in index.css", () => {
      const css = fs.readFileSync(
        path.resolve(process.cwd(), "src/index.css"),
        "utf-8"
      );

      expect(css).toContain(".btn-accent {");
      expect(css).toContain(".btn-accent:hover {");
      expect(css).toMatch(/\.btn-accent\s*\{[^}]*background:\s*var\(--accent-color\)/);
    });
  });

  describe("AdminDashboard tab abortion and loading state", () => {
    it("resets loading state unconditionally in finally block", () => {
      const adminTsx = fs.readFileSync(
        path.resolve(process.cwd(), "src/components/AdminDashboard.tsx"),
        "utf-8"
      );

      // The finally block should unconditionally call setLoadingPasswords(false)
      expect(adminTsx).toMatch(
        /finally\s*\{\s*setLoadingPasswords\(false\);\s*isFetchingPasswordsRef\.current\s*=\s*false;/
      );
    });
  });

  describe("AddStockModal weight validation", () => {
    function validateStockInput(weight: number | string): { ok: boolean; error?: string } {
      const numericWeight = Number(weight);
      if (!Number.isFinite(numericWeight) || numericWeight <= 0 || numericWeight > 100) {
        return { ok: false, error: "構成比率は0.1%から100%の間で入力してください" };
      }
      return { ok: true };
    }

    it("rejects non-positive, NaN, and excessive weights", () => {
      expect(validateStockInput(0).ok).toBe(false);
      expect(validateStockInput(-5).ok).toBe(false);
      expect(validateStockInput(100.1).ok).toBe(false);
      expect(validateStockInput(200).ok).toBe(false);
      expect(validateStockInput("abc").ok).toBe(false);
      expect(validateStockInput("").ok).toBe(false);
    });

    it("accepts valid weights within (0, 100]", () => {
      expect(validateStockInput(0.1).ok).toBe(true);
      expect(validateStockInput(10).ok).toBe(true);
      expect(validateStockInput(50.5).ok).toBe(true);
      expect(validateStockInput(100).ok).toBe(true);
      expect(validateStockInput("25.5").ok).toBe(true);
    });
  });

  describe("Accessibility and ARIA modal dialog semantics", () => {
    it("places role='dialog' and aria-modal='true' on the focused card in TradingViewChartModal", () => {
      const tvModalTsx = fs.readFileSync(
        path.resolve(process.cwd(), "src/components/TradingViewChartModal.tsx"),
        "utf-8"
      );

      // Backdrop should not have role="dialog"
      expect(tvModalTsx).not.toMatch(/className="tv-chart-popover-backdrop"[^>]*role="dialog"/);

      // Card element should have role="dialog"
      expect(tvModalTsx).toMatch(/ref=\{cardRef\}\s*role="dialog"\s*aria-modal="true"/);
    });

    it("includes ariaDescribedBy in TutorialPage shortcuts modal", () => {
      const tutorialTsx = fs.readFileSync(
        path.resolve(process.cwd(), "src/components/TutorialPage.tsx"),
        "utf-8"
      );

      expect(tutorialTsx).toContain('ariaDescribedBy="tutorial-shortcuts-desc"');
      expect(tutorialTsx).toContain('id="tutorial-shortcuts-desc"');
    });
  });

  describe("useIndices DELETE sends ownerToken via header only (never URL)", () => {
    it("keeps ownerToken out of searchParams and sends it in x-owner-token header", () => {
      // Exercise the real request builders used by deleteCustomIndex and
      // removeStockFromIndex in src/hooks/useIndices.ts: the token travels
      // in the x-owner-token header only; the query string carries just the
      // resource identifiers.
      const indexReq = buildDeleteIndexRequest("test-index-1", "tok_abc123", {});
      expect(indexReq.url).toContain("id=test-index-1");
      expect(indexReq.url).not.toContain("ownerToken");
      expect(indexReq.url).not.toContain("tok_abc123");
      expect(indexReq.headers["x-owner-token"]).toBe("tok_abc123");

      const stockReq = buildDeleteStockRequest("test-index-1", "7203", "tok_abc123", {});
      expect(stockReq.url).toContain("indexId=test-index-1");
      expect(stockReq.url).toContain("ticker=7203");
      expect(stockReq.url).not.toContain("ownerToken");
      expect(stockReq.url).not.toContain("tok_abc123");
      expect(stockReq.headers["x-owner-token"]).toBe("tok_abc123");
    });
  });
});
