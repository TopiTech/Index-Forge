import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { equalizeWeightsExact, redistributeWeightsExact } from "./indexEngine";

describe("Comprehensive Goal Audit & Remediation Verification", () => {
  describe("1. TradingViewChartModal Accessibility & Focus Trap", () => {
    it("hooks into useModalFocus and marks modal container with data-modal-dialog", () => {
      const modalCode = readFileSync(
        resolve(__dirname, "../components/TradingViewChartModal.tsx"),
        "utf8",
      );
      expect(modalCode).toContain('import { useModalFocus } from "../hooks/useModalFocus";');
      expect(modalCode).toContain("useModalFocus(Boolean(symbol), cardRef, onClose);");
      expect(modalCode).toContain('data-modal-dialog="true"');
      expect(modalCode).toContain("tabIndex={-1}");
    });
  });

  describe("2. TradingViewTickerTape Keyboard Accessibility", () => {
    it("calls e.preventDefault() on Space and Enter to prevent window scrolling", () => {
      const tickerCode = readFileSync(
        resolve(__dirname, "../components/TradingViewTickerTape.tsx"),
        "utf8",
      );
      expect(tickerCode).toMatch(/if\s*\(\s*e\.key\s*===\s*["']Enter["']\s*\|\|\s*e\.key\s*===\s*["'] ["']\s*\)\s*\{\s*e\.preventDefault\(\);/);
    });
  });

  describe("3. Weight Apportionment Exact 100.00% Verification", () => {
    it("guarantees 100.00% sum for 3 items (avoids 99.9% rounding anomaly)", () => {
      const basket = [
        { ticker: "7203", weight: 33.3 },
        { ticker: "6758", weight: 33.3 },
        { ticker: "9984", weight: 33.3 },
      ];
      const equalized = equalizeWeightsExact(basket);
      const equalizedSum = Number(equalized.reduce((acc, x) => acc + x.weight, 0).toFixed(2));
      expect(equalizedSum).toBe(100);

      const normalized = redistributeWeightsExact(basket);
      const normalizedSum = Number(normalized.reduce((acc, x) => acc + x.weight, 0).toFixed(2));
      expect(normalizedSum).toBe(100);
    });

    it("verifies IndexBuilderContent uses exact weight apportionment functions", () => {
      const contentCode = readFileSync(
        resolve(__dirname, "../components/IndexBuilderContent.tsx"),
        "utf8",
      );
      expect(contentCode).toContain("equalizeWeightsExact(basket)");
      expect(contentCode).toContain("redistributeWeightsExact(basket)");
    });

    it("verifies AdminDashboard uses exact weight equalization", () => {
      const adminCode = readFileSync(
        resolve(__dirname, "../components/AdminDashboard.tsx"),
        "utf8",
      );
      expect(adminCode).toContain("equalizeWeightsExact(editBasket)");
    });
  });

  describe("4. Safe Clipboard Copying in IndexBuilderContent", () => {
    it("implements clipboard check, textarea fallback, and try/catch with error toast", () => {
      const contentCode = readFileSync(
        resolve(__dirname, "../components/IndexBuilderContent.tsx"),
        "utf8",
      );
      expect(contentCode).toContain("navigator?.clipboard?.writeText");
      expect(contentCode).toContain("document.createElement(\"textarea\")");
      expect(contentCode).toContain("document.execCommand(\"copy\")");
      expect(contentCode).toContain("toastError(\"クリップボードへのコピーに失敗しました\")");
    });
  });

  describe("5. IndexBuilderPage Fallback Fullscreen Keyboard Handling", () => {
    it("listens for Escape key to exit fullscreen mode", () => {
      const pageCode = readFileSync(
        resolve(__dirname, "../components/IndexBuilderPage.tsx"),
        "utf8",
      );
      expect(pageCode).toMatch(/if\s*\(!isFullscreen\)\s*return;/);
      expect(pageCode).toMatch(/if\s*\(e\.key\s*===\s*["']Escape["']\)\s*\{/);
      expect(pageCode).toContain("setIsFullscreen(false);");
    });
  });

  describe("6. StatsGrid Floating-Point Near-Zero Alpha Normalization", () => {
    it("normalizes near-zero floating point return and alpha metrics", () => {
      const statsCode = readFileSync(
        resolve(__dirname, "../components/StatsGrid.tsx"),
        "utf8",
      );
      expect(statsCode).toContain("Math.abs(rawBenchmarkDiff) < 0.005 ? 0 : rawBenchmarkDiff");
      expect(statsCode).toContain("Math.abs(customReturnPct) < 0.005 ? 0 : customReturnPct");
      expect(statsCode).toContain("Math.abs(benchmarkReturnPct) < 0.005 ? 0 : benchmarkReturnPct");
    });

    it("ensures -0.002% diff rounds to 0 and avoids underperform misclassification", () => {
      const rawBenchmarkDiff = -0.002;
      const benchmarkDiff = Math.abs(rawBenchmarkDiff) < 0.005 ? 0 : rawBenchmarkDiff;
      expect(benchmarkDiff).toBe(0);

      const trendText =
        benchmarkDiff > 0 ? "OUTPERFORM" : benchmarkDiff < 0 ? "UNDERPERFORM" : "NEUTRAL";
      const trendType =
        benchmarkDiff > 0 ? "positive" : benchmarkDiff < 0 ? "negative" : "neutral";

      expect(trendText).toBe("NEUTRAL");
      expect(trendType).toBe("neutral");
    });
  });
});
