// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { downloadBlob } from "./downloadFile";
import { AddStockModal } from "../components/AddStockModal";

describe("UI Resilience and A11y Improvements (ISSUE-7, ISSUE-8, ISSUE-9)", () => {
  describe("ISSUE-7: Safe Asynchronous ObjectURL Revocation & Cross-Component Adoption", () => {
    const urlApi = URL as unknown as {
      createObjectURL: (obj: Blob) => string;
      revokeObjectURL: (url: string) => void;
    };
    const originalCreateObjectURL = urlApi.createObjectURL;
    const originalRevokeObjectURL = urlApi.revokeObjectURL;

    beforeEach(() => {
      vi.useFakeTimers();
      urlApi.createObjectURL = vi.fn(() => "blob:mock-download-url");
      urlApi.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      urlApi.createObjectURL = originalCreateObjectURL;
      urlApi.revokeObjectURL = originalRevokeObjectURL;
      cleanup();
    });

    it("downloadBlob creates anchor, clicks it, and revokes object URL asynchronously after 1000ms", () => {
      const appendSpy = vi.spyOn(document.body, "appendChild");
      const removeSpy = vi.spyOn(document.body, "removeChild");
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      const testBlob = new Blob(["sample,csv,data"], { type: "text/csv" });
      downloadBlob(testBlob, "test_output.csv");

      expect(urlApi.createObjectURL).toHaveBeenCalledWith(testBlob);
      expect(appendSpy).toHaveBeenCalledTimes(1);

      const anchor = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
      expect(anchor.href).toBe("blob:mock-download-url");
      expect(anchor.download).toBe("test_output.csv");
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(removeSpy).toHaveBeenCalledWith(anchor);

      // Must NOT be revoked synchronously
      expect(urlApi.revokeObjectURL).not.toHaveBeenCalled();

      // After 1000ms delay, revocation occurs
      vi.advanceTimersByTime(1000);
      expect(urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:mock-download-url");

      appendSpy.mockRestore();
      removeSpy.mockRestore();
      clickSpy.mockRestore();
    });

    it("verifies all target components utilize downloadBlob and eliminate synchronous revokeObjectURL", () => {
      const componentFiles = [
        "../components/CalendarPage.tsx",
        "../components/ConstituentsTable.tsx",
        "../components/IndexBuilderContent.tsx",
        "../components/PortfolioManagerPage.tsx",
        "../components/ScreenerPage.tsx",
      ];

      for (const relPath of componentFiles) {
        const fullPath = resolve(__dirname, relPath);
        const code = readFileSync(fullPath, "utf-8");

        // Must import and call downloadBlob
        expect(code).toContain("downloadBlob");
        expect(code).toMatch(/import\s*\{[^}]*downloadBlob[^}]*\}\s*from\s*["'].*downloadFile["']/);

        // Must NOT use synchronous createObjectURL/revokeObjectURL directly
        expect(code).not.toContain("URL.createObjectURL(");
        expect(code).not.toContain("URL.revokeObjectURL(");
      }
    });
  });

  describe("ISSUE-8: Real-time Full-width Ticker Normalization in AddStockModal", () => {
    afterEach(() => {
      cleanup();
    });

    it("normalizes full-width digits to half-width upon input", () => {
      render(
        React.createElement(AddStockModal, {
          isOpen: true,
          onClose: vi.fn(),
          indexName: "テスト指数",
          currentCount: 0,
          maxStocks: 10,
          onAddStock: vi.fn().mockResolvedValue({ ok: true }),
        }),
      );

      const tickerInput = screen.getByLabelText(/銘柄コード/i) as HTMLInputElement;

      // Full-width Japanese stock code ７２０３
      fireEvent.change(tickerInput, { target: { value: "７２０３" } });
      expect(tickerInput.value).toBe("7203");
    });

    it("normalizes lowercase and full-width alphabet characters and trims spaces upon input", () => {
      render(
        React.createElement(AddStockModal, {
          isOpen: true,
          onClose: vi.fn(),
          indexName: "テスト指数",
          currentCount: 0,
          maxStocks: 10,
          onAddStock: vi.fn().mockResolvedValue({ ok: true }),
        }),
      );

      const tickerInput = screen.getByLabelText(/銘柄コード/i) as HTMLInputElement;

      // Lowercase and full-width alphabet with spaces
      fireEvent.change(tickerInput, { target: { value: "  ａａｐｌ  " } });
      expect(tickerInput.value).toBe("AAPL");
    });
  });

  describe("ISSUE-9: Fullscreen-aware Tooltip Portal in ThemeHeatmap", () => {
    it("preserves document.body assertion while supporting fullscreenElement portal target", () => {
      const heatmapPath = resolve(__dirname, "../components/ThemeHeatmap.tsx");
      const heatmapCode = readFileSync(heatmapPath, "utf-8");

      // Verify strict preservation of existing audit checks
      expect(heatmapCode).toContain('typeof document !== "undefined" &&');
      expect(heatmapCode).toContain("document.body &&");
      expect(heatmapCode).toContain("createPortal(");

      // Verify fullscreen-aware portal target fallback
      expect(heatmapCode).toContain("(document.fullscreenElement as HTMLElement | null) ?? document.body");
    });
  });
});
