// @vitest-environment jsdom
/**
 * Regression suite for the comprehensive goal code review (units 1 & 2).
 *
 * UI-05 moved the overlay root to `document.fullscreenElement ?? document.body`
 * and UI-19 lifted the builder's "save in flight" flag into the modal shell,
 * so the dialog can no longer be dismissed while a save is running. Both
 * contracts are asserted on the rendered DOM: a source grep cannot show
 * where the dialog ends up or that the close is really blocked.
 *
 * The jsdom environment externalizes the Node built-ins, so the sources are
 * read through Vite's `?raw` suffix instead of `fs`/`path`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type RefObject } from "react";
import { normalizeMarketCapToOkuYen } from "./weights";
import { calculateRiskMetrics } from "./analytics";
import type { PricePoint } from "../types";

import previewSrc from "../components/SimulationPreview.tsx?raw";
import perfSrc from "../components/PerformanceChart.tsx?raw";
import techSrc from "../components/StockTechnicalChart.tsx?raw";
import sceneSrc from "../components/Tutorial3DScene.ts?raw";
import canvasSrc from "../components/Tutorial3DCanvas.tsx?raw";
import modalSrc from "../components/ModalBase.tsx?raw";
import hookSrc from "../hooks/useIndices.ts?raw";
import builderSrc from "../components/IndexBuilderContent.tsx?raw";
import adminSrc from "../components/AdminDashboard.tsx?raw";

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: { role: "user", name: "テスター", maxStocks: null, maxIndices: null },
    isAuthenticated: true,
    isUser: true,
    isAdmin: false,
    maxStocks: null,
    maxIndices: null,
    loading: false,
    login: vi.fn(),
    adminLogin: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../hooks/useSimulation", () => ({
  useSimulation: () => ({}),
}));

vi.mock("../components/SimulationPreview", () => ({
  SimulationPreview: () => null,
}));

vi.mock("../components/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { IndexBuilderModal } from "../components/IndexBuilderModal";
import { ModalBase, getOverlayRoot } from "../components/ModalBase";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Comprehensive Goal Code Review - Unit 1 & 2 Fixes", () => {
  describe("1. Multi-Currency Market Cap Normalization", () => {
    it("converts US stocks in $M to Japanese 億円 accurately using USD/JPY rate", () => {
      // 100 $M at 155 JPY/USD = 100 * 1,000,000 * 155 / 100,000,000 = 155 億円
      const usCapInOkuYen = normalizeMarketCapToOkuYen(100, "US", 155.0);
      expect(usCapInOkuYen).toBe(155.0);

      const usDollarCap = normalizeMarketCapToOkuYen(500, "$", 150.0);
      expect(usDollarCap).toBe(750.0);

      // Japanese stocks in 億円 remain unchanged
      const jpCap = normalizeMarketCapToOkuYen(3500, "JP", 155.0);
      expect(jpCap).toBe(3500);

      // Invalid or non-positive caps return 0
      expect(normalizeMarketCapToOkuYen(-10, "US")).toBe(0);
      expect(normalizeMarketCapToOkuYen(NaN, "US")).toBe(0);
    });
  });

  describe("2. Analytics Date Sorting with ISO Timestamps and Labels", () => {
    it("sorts price points chronologically when dates include full ISO timestamps or reverse order", () => {
      const reverseSeries: PricePoint[] = [
        { date: "2024-04-16T12:00:00.000Z", close: 110, value: 110 },
        { date: "2024-04-15T12:00:00.000Z", close: 100, value: 100 },
      ];
      const metrics = calculateRiskMetrics(reverseSeries, []);
      // If dates were NOT sorted, startVal would be 110 and endVal 100 (negative return).
      // Since it's properly sorted chronologically, startVal is 100 and endVal is 110 (positive return).
      expect(metrics.annualReturn).toBeGreaterThan(0);
    });
  });

  describe("3. SimulationPreview XAxis and Recharts Non-Finite Guards", () => {
    it("ensures SimulationPreview XAxis tickFormatter handles undefined and short strings without throwing", () => {
      expect(previewSrc).toContain(
        'typeof d === "string" && d.length >= 5 ? d.slice(5) : String(d ?? "")',
      );
      expect(previewSrc).toContain(
        'typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v}%` : "--"',
      );
    });

    it("ensures PerformanceChart and StockTechnicalChart tickFormatters guard non-finite values", () => {
      expect(perfSrc).toContain('if (typeof v !== "number" || !Number.isFinite(v)) return "--"');

      expect(techSrc).toContain('if (typeof val !== "number" || !Number.isFinite(val)) return "--"');
    });
  });

  describe("4. WebGL Context Loss in Tutorial3DScene", () => {
    it("calls forceContextLoss in destroy to prevent WebGL context exhaustion across navigations", () => {
      expect(sceneSrc).toContain("forceContextLoss");
    });

    it("handles webglcontextlost with preventDefault and webglcontextrestored in Tutorial3DCanvas", () => {
      expect(canvasSrc).toContain("webglcontextlost");
      expect(canvasSrc).toContain("webglcontextrestored");
      expect(canvasSrc).toContain("e.preventDefault()");
    });
  });

  describe("5. ModalBase Portaling and Keyboard Accessibility", () => {
    it("portals ModalBase into the overlay root and keeps the dialog focusable", () => {
      // Without a fullscreen element the overlay root is the document body.
      expect(getOverlayRoot()).toBe(document.body);

      const inputRef: RefObject<HTMLInputElement | null> = { current: null };
      const { container } = render(
        createElement(ModalBase, {
          isOpen: true,
          onClose: vi.fn(),
          title: "テストダイアログ",
          initialFocusRef: inputRef,
          children: createElement("input", { ref: inputRef, "aria-label": "入力欄" }),
        }),
      );

      const dialog = document.querySelector<HTMLElement>("[data-modal-dialog]");
      expect(dialog).not.toBeNull();

      // The dialog is portaled out of the React tree into the overlay root.
      expect(container.contains(dialog)).toBe(false);
      expect(dialog!.closest(".modal-overlay")?.parentElement).toBe(document.body);

      // The dialog itself stays programmatically focusable ...
      expect(dialog!.getAttribute("tabindex")).toBe("-1");
      // ... and the focus actually moves into it.
      expect(document.activeElement).toBe(inputRef.current);
      expect(dialog!.contains(document.activeElement)).toBe(true);
    });

    it("resolves the overlay root from the shared helper instead of document.body", () => {
      // The portal target is the shared overlay root (the fullscreen element
      // while one is active), not a hard-coded document.body.
      expect(modalSrc).toContain("export function getOverlayRoot()");
      expect(modalSrc).toContain("document.fullscreenElement");
      expect(modalSrc).toContain("createPortal(modalContent, overlayRoot)");
      expect(modalSrc).not.toContain("createPortal(modalContent, document.body)");
      expect(modalSrc).toContain("tabIndex={-1}");
    });
  });

  describe("6. useIndices addStockToIndex Sanitization", () => {
    it("sanitizes full-width IME tickers and clamps weights in addStockToIndex", () => {
      expect(hookSrc).toContain("const cleanTicker = normalizeTicker(stock.ticker);");
      expect(hookSrc).toContain("Math.min(stock.weight, 100)");
      expect(hookSrc).toContain("sanitizedStock");
    });
  });

  describe("7. IndexBuilder and Admin Async Save try...finally", () => {
    it("blocks the close while the index save is in flight and releases it afterwards", async () => {
      let resolveSave: ((result: { ok: boolean; error?: string }) => void) | undefined;
      const onSave = vi.fn(
        () =>
          new Promise<{ ok: boolean; error?: string }>((resolve) => {
            resolveSave = resolve;
          }),
      );
      const onClose = vi.fn();

      render(createElement(IndexBuilderModal, { isOpen: true, onClose, onSave }));

      // The builder body is loaded lazily.
      const saveButton = await screen.findByRole("button", { name: /指数を保存・追跡開始/ });

      // A preset fills the name and the basket so the save passes validation.
      const presetButtons = screen.getAllByRole("button", { name: /戦略プリセット/ });
      fireEvent.click(presetButtons[0]);

      fireEvent.click(saveButton);
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

      // UI-19: the dialog must not be dismissible while the save runs, or the
      // configured basket would be lost.
      const closeButton = screen.getByRole("button", { name: "閉じる" });
      expect((closeButton as HTMLButtonElement).disabled).toBe(true);
      expect(
        (screen.getByRole("button", { name: "キャンセル" }) as HTMLButtonElement).disabled,
      ).toBe(true);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();

      // The save fails: the builder must release the busy state, so the
      // buttons do not stay stuck forever.
      resolveSave?.({ ok: false, error: "保存に失敗しました" });

      await waitFor(() =>
        expect((screen.getByRole("button", { name: "閉じる" }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      expect(
        (screen.getByRole("button", { name: /指数を保存・追跡開始/ }) as HTMLButtonElement).disabled,
      ).toBe(false);

      // Now the dialog can be closed again.
      fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("wraps the builder save in try...finally so the busy flag is always released", () => {
      // The builder releases the flag through `updateSaving`, which also lifts
      // it to the modal shell (the close guard).
      expect(builderSrc).toMatch(/try \{[\s\S]*?onSave[\s\S]*?\} finally \{\s*updateSaving\(false\);/);
      expect(builderSrc).toContain("const updateSaving = useCallback((next: boolean) => {");
      expect(builderSrc).toContain("onSavingChangeRef.current?.(next);");
    });

    it("wraps the admin saves in try...finally so their buttons never stay stuck", () => {
      expect(adminSrc).toMatch(/try \{[\s\S]*?saveCustomIndex[\s\S]*?\} finally \{\s*setSavingIndex\(false\);/);
      expect(adminSrc).toMatch(/try \{[\s\S]*?saveCustomIndex[\s\S]*?\} finally \{\s*setCreatingIndex\(false\);/);
    });
  });
});
