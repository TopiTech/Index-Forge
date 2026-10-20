// @vitest-environment jsdom
/**
 * Regression suite for the code-review goal resolutions.
 *
 * UI-20 changed the loading contract: the dashboard no longer swaps the whole
 * app for a full-screen loader while `/api/indices` is in flight — the shell
 * (navigation, header, ticker tape) always renders and only the
 * index-dependent region shows a skeleton. The `admin` branch must therefore
 * still be evaluated before the dashboard content, and it must render even
 * while the index list is still loading.
 *
 * The jsdom environment externalizes the Node built-ins, so the sources are
 * read through Vite's `?raw` suffix instead of `fs`/`path`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import App from "../App";
import { AddStockModal } from "../components/AddStockModal";
import { ToastProvider } from "../components/Toast";
import {
  buildDeleteIndexRequest,
  buildDeleteStockRequest,
} from "../hooks/useIndices";
import type { BasketItem } from "../types";

import appTsx from "../App.tsx?raw";
import adminTsx from "../components/AdminDashboard.tsx?raw";
import tradingViewChartModalTsx from "../components/TradingViewChartModal.tsx?raw";
import tutorialTsx from "../components/TutorialPage.tsx?raw";

// A CSS module cannot be read through `?raw` in the SSR transform, so the
// stylesheet is read through `process.getBuiltinModule`, which resolves the
// real `node:fs` without a static import.
const nodeFs = process.getBuiltinModule("node:fs") as {
  readFileSync: (path: string, encoding: "utf8") => string;
};
const nodePath = process.getBuiltinModule("node:path") as {
  join: (...parts: string[]) => string;
};
const indexCss = nodeFs.readFileSync(
  nodePath.join(process.cwd(), "src/index.css"),
  "utf8",
);

// recharts' ResponsiveContainer needs a ResizeObserver, which jsdom does not
// implement.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Minimal MediaQueryList stub (jsdom does not implement `matchMedia`). */
function createMediaQueryList(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.matchMedia = vi.fn(createMediaQueryList) as unknown as typeof window.matchMedia;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  // The index list request never settles, so `loadingIndices` stays true for
  // the whole test. Every other endpoint fails immediately.
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/indices")) {
        return new Promise<Response>(() => {});
      }
      return Promise.reject(new Error("network disabled in test"));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
});

describe("Code Review Goal Resolutions", () => {
  describe("App routing priority and admin accessibility", () => {
    it("evaluates the admin branch before the index-error and index-loading gates", () => {
      const adminPos = appTsx.indexOf('if (currentView === "admin") {');
      const errorPos = appTsx.indexOf("if (indicesError && indices.length === 0) {");
      const loadingPos = appTsx.indexOf("if (loadingIndices) {");

      expect(adminPos).toBeGreaterThan(-1);
      expect(errorPos).toBeGreaterThan(-1);
      expect(loadingPos).toBeGreaterThan(-1);

      // Admin must be evaluated before error fallback and loading screen
      expect(adminPos).toBeLessThan(errorPos);
      expect(adminPos).toBeLessThan(loadingPos);
    });

    it("renders the admin view while the index list is still loading", async () => {
      window.history.replaceState({}, "", "/admin");

      render(createElement(ToastProvider, null, createElement(App, {})));

      // The admin console renders even though `/api/indices` never settles.
      // (Without an admin session the console shows its own login gate — the
      // point is that the admin branch rendered at all.)
      expect(
        await screen.findByRole("heading", { name: /管理者ポータル/ }),
      ).toBeTruthy();

      // The dashboard's index-region skeleton must not take over the screen.
      expect(screen.queryByLabelText("指数一覧を読み込み中")).toBeNull();
      expect(screen.queryByLabelText("INITIALIZING...")).toBeNull();
    });

    it("renders the dashboard shell with an index-region skeleton while the index list is loading", async () => {
      // The tutorial takes over the first launch; the dashboard is reached
      // once it has been dismissed.
      window.localStorage.setItem("indexforge_tutorial_seen_v1", "true");
      window.history.replaceState({}, "", "/");

      render(createElement(ToastProvider, null, createElement(App, {})));

      // The shell is rendered instead of a full-screen loading screen.
      expect(screen.getAllByRole("navigation").length).toBeGreaterThan(0);
      expect(screen.queryByLabelText("INITIALIZING...")).toBeNull();

      // Only the index-dependent region shows the skeleton.
      expect(await screen.findByLabelText("指数一覧を読み込み中")).toBeTruthy();
    });
  });

  describe("UI / CSS styles", () => {
    it("defines .btn-accent and .btn-accent:hover in index.css", () => {
      expect(indexCss).toContain(".btn-accent {");
      expect(indexCss).toContain(".btn-accent:hover {");
      expect(indexCss).toMatch(/\.btn-accent\s*\{[^}]*background:\s*var\(--accent-color\)/);
    });
  });

  describe("AdminDashboard tab abortion and loading state", () => {
    it("does not release the loading state or in-flight guard for an aborted request", () => {
      // Regression: the finally block used to clear the loading flag and the
      // in-flight guard unconditionally. When the effect cleanup aborted an
      // in-flight request and immediately re-ran fetchPasswords, the new
      // invocation was rejected by the still-set guard, so the table stayed on
      // an empty list that read as "no passwords issued yet".
      expect(adminTsx).toMatch(
        /finally\s*\{\s*\/\/[\s\S]*?if \(!controller\.signal\.aborted\) \{\s*setLoadingPasswords\(false\);\s*isFetchingPasswordsRef\.current\s*=\s*false;/
      );
    });

    it("releases the in-flight guard when the effect aborts a request", () => {
      // Regression: the finally block used to clear the loading flag and the
      // in-flight guard unconditionally. When the effect cleanup aborted an
      // in-flight request and immediately re-ran fetchPasswords, the new
      // invocation was rejected by the still-set guard, so the table stayed on
      // an empty list that read as "no passwords issued yet".
      expect(adminTsx).toMatch(
        /abortControllerRef\.current\.abort\(\);\s*\/\/[\s\S]*?isFetchingPasswordsRef\.current\s*=\s*false;/
      );
    });
  });

  describe("AddStockModal weight validation", () => {
    /**
     * The weight rule is production code: `AddStockModal.handleSubmit` rejects
     * anything that is not a finite weight in (0, 100]. The modal is rendered
     * for real here, so the assertions exercise that handler instead of a copy
     * of it that could never fail when the production rule breaks.
     */
    function renderAddStockModal(
      onAddStock: (stock: BasketItem) => Promise<{ ok: boolean; error?: string }>,
    ) {
      render(
        createElement(AddStockModal, {
          isOpen: true,
          onClose: vi.fn(),
          indexName: "テスト指数",
          currentCount: 1,
          maxStocks: null,
          onAddStock,
        }),
      );
    }

    function fillForm(weight: string) {
      fireEvent.change(screen.getByLabelText(/銘柄コード/), { target: { value: "7203" } });
      fireEvent.change(screen.getByLabelText(/銘柄名/), { target: { value: "トヨタ" } });
      fireEvent.change(screen.getByLabelText(/構成比率/), { target: { value: weight } });
    }

    function submitForm() {
      const form = document.getElementById("add-stock-form");
      expect(form).not.toBeNull();
      fireEvent.submit(form as HTMLFormElement);
    }

    it("rejects non-positive and excessive weights without adding the stock", () => {
      const onAddStock = vi.fn(async (_stock: BasketItem) => ({ ok: true }));
      renderAddStockModal(onAddStock);

      for (const weight of ["0", "-5", "100.1", "200"]) {
        fillForm(weight);
        submitForm();

        expect(
          screen.getByText("構成比率は0.1%から100%の間で入力してください"),
        ).toBeTruthy();
        expect(onAddStock).not.toHaveBeenCalled();
      }
    });

    it("accepts valid weights within (0, 100]", async () => {
      const onAddStock = vi.fn(async (_stock: BasketItem) => ({ ok: true }));
      renderAddStockModal(onAddStock);

      const validWeights = ["0.1", "10", "50.5", "100", "25.5"];
      for (const [index, weight] of validWeights.entries()) {
        fillForm(weight);
        submitForm();
        await waitFor(() => expect(onAddStock).toHaveBeenCalledTimes(index + 1));
      }

      expect(onAddStock.mock.calls.map((call) => call[0].weight)).toEqual([
        0.1, 10, 50.5, 100, 25.5,
      ]);
      expect(onAddStock.mock.calls[0][0]).toMatchObject({
        ticker: "7203",
        name: "トヨタ",
        weight: 0.1,
      });
    });
  });

  describe("Accessibility and ARIA modal dialog semantics", () => {
    it("places role='dialog' and aria-modal='true' on the focused card in TradingViewChartModal", () => {
      // Backdrop should not have role="dialog"
      expect(tradingViewChartModalTsx).not.toMatch(
        /className="tv-chart-popover-backdrop"[^>]*role="dialog"/
      );

      // Card element should have role="dialog"
      expect(tradingViewChartModalTsx).toMatch(
        /ref=\{cardRef\}\s*role="dialog"\s*aria-modal="true"/
      );
    });

    it("includes ariaDescribedBy in TutorialPage shortcuts modal", () => {
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
