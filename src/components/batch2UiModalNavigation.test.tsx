// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditPasswordModal } from "./EditPasswordModal";
import { StockDetailPage } from "./StockDetailPage";
import { ScreenerPage } from "./ScreenerPage";
import { StatsGrid } from "./StatsGrid";
import { ToastProvider } from "./Toast";
import { getOverlayRoot } from "./ModalBase";
import type { UserPasswordItem, Snapshot } from "../types";
import type { CustomIndex } from "../data/indices";

function stubFullscreenElement(element: HTMLElement): () => void {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => element,
  });
  return () => {
    delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
  };
}

const TEST_USER: UserPasswordItem = {
  id: "user-1",
  name: "テストユーザー",
  role: "user",
  is_active: 1,
  created_at: 1000,
  updated_at: 1000,
  max_stocks: 10,
  max_indices: 5,
};

const mockIndex: CustomIndex = {
  id: "test-index",
  name: "テスト指数",
  description: "テスト用",
  basket: [{ ticker: "7203", name: "トヨタ", weight: 100, theme: "自動車" }],
  baseValue: 1000,
};

const makeSnapshot = (current = 38000, change = 100, changePct = 0.5): Snapshot => ({
  symbol: "^N225",
  label: "日経225",
  current,
  change,
  changePct,
  updatedAt: "2026-01-01 15:00",
  description: "日経平均株価",
});

describe("Batch 2: UI-02 & UI-03 - EditPasswordModal Portal & Draft Input", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("UI-02: portals EditPasswordModal outside the React container into overlayRoot", () => {
    expect(getOverlayRoot()).toBe(document.body);

    const { container } = render(
      <EditPasswordModal
        isOpen={true}
        onClose={vi.fn()}
        item={TEST_USER}
        onSuccess={vi.fn()}
        getHeaders={() => ({})}
      />,
    );

    const dialog = document.querySelector<HTMLElement>("[data-modal-dialog]");
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    expect(screen.getByText("パスワード設定の編集")).toBeTruthy();
  });

  it("UI-02: re-targets overlayRoot to fullscreenElement on fullscreenchange", () => {
    const fullscreenHost = document.createElement("div");
    document.body.appendChild(fullscreenHost);
    const restore = stubFullscreenElement(fullscreenHost);

    try {
      expect(getOverlayRoot()).toBe(fullscreenHost);

      render(
        <EditPasswordModal
          isOpen={true}
          onClose={vi.fn()}
          item={TEST_USER}
          onSuccess={vi.fn()}
          getHeaders={() => ({})}
        />,
      );

      act(() => {
        document.dispatchEvent(new Event("fullscreenchange"));
      });

      const movedDialog = fullscreenHost.querySelector("[data-modal-dialog]");
      expect(movedDialog).not.toBeNull();
    } finally {
      restore();
      fullscreenHost.remove();
    }
  });

  it("UI-02: responds to Escape key to close the modal", () => {
    const onClose = vi.fn();
    render(
      <EditPasswordModal
        isOpen={true}
        onClose={onClose}
        item={TEST_USER}
        onSuccess={vi.fn()}
        getHeaders={() => ({})}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("UI-03: retains empty draft state when backspaced and clamps on blur and submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <EditPasswordModal
        isOpen={true}
        onClose={vi.fn()}
        item={TEST_USER}
        onSuccess={vi.fn()}
        getHeaders={() => ({})}
      />,
    );

    const maxStocksInput = document.querySelector("#edit-pw-max-stocks") as HTMLInputElement;
    expect(maxStocksInput).not.toBeNull();
    expect(maxStocksInput.value).toBe("10");

    // 1. Clearing with backspace keeps input as empty string without immediate reset to 1
    fireEvent.change(maxStocksInput, { target: { value: "" } });
    expect(maxStocksInput.value).toBe("");

    // 2. Typing new number while empty works cleanly
    fireEvent.change(maxStocksInput, { target: { value: "45" } });
    expect(maxStocksInput.value).toBe("45");

    // 3. Backspacing again to empty
    fireEvent.change(maxStocksInput, { target: { value: "" } });
    expect(maxStocksInput.value).toBe("");

    // 4. On blur, empty value clamps safely to 1
    fireEvent.blur(maxStocksInput);
    expect(maxStocksInput.value).toBe("1");

    // 5. Test maxIndices empty draft retention and blur clamp
    const maxIndicesInput = document.querySelector("#edit-pw-max-indices") as HTMLInputElement;
    expect(maxIndicesInput).not.toBeNull();
    fireEvent.change(maxIndicesInput, { target: { value: "" } });
    expect(maxIndicesInput.value).toBe("");
    fireEvent.blur(maxIndicesInput);
    expect(maxIndicesInput.value).toBe("1");

    // 6. Submitting while empty safely sends clamped limits
    fireEvent.change(maxStocksInput, { target: { value: "" } });
    fireEvent.change(maxIndicesInput, { target: { value: "" } });

    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(fetchMock).toHaveBeenCalled();
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const payload = JSON.parse(String(lastCall[1]?.body)) as {
      maxStocks: number | null;
      maxIndices: number | null;
    };
    expect(payload.maxStocks).toBe(1);
    expect(payload.maxIndices).toBe(1);
  });
});

describe("Batch 2: UI-06 - StockDetailPage Breadcrumb Hierarchy", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders natural breadcrumb from screener: ホーム / スクリーナー / 銘柄名", () => {
    const onNavigate = vi.fn();
    render(<StockDetailPage ticker="7203" from="screener" onNavigate={onNavigate} />);

    const breadcrumb = screen.getByRole("navigation", { name: "パンくずリスト" });
    expect(breadcrumb).toBeTruthy();

    const links = breadcrumb.querySelectorAll(".stock-breadcrumb-link");
    expect(links.length).toBe(2);
    expect(links[0].textContent).toBe("ホーム");
    expect(links[1].textContent).toBe("スクリーナー");

    fireEvent.click(links[1]);
    expect(onNavigate).toHaveBeenCalledWith("screener");
  });

  it("renders natural breadcrumb from market: ホーム / マーケット / 銘柄名", () => {
    const onNavigate = vi.fn();
    render(<StockDetailPage ticker="7203" from="market" onNavigate={onNavigate} />);

    const breadcrumb = screen.getByRole("navigation", { name: "パンくずリスト" });
    const links = breadcrumb.querySelectorAll(".stock-breadcrumb-link");
    expect(links.length).toBe(2);
    expect(links[0].textContent).toBe("ホーム");
    expect(links[1].textContent).toBe("マーケット");

    fireEvent.click(links[1]);
    expect(onNavigate).toHaveBeenCalledWith("market");
  });

  it("renders natural breadcrumb from stock (default): ホーム / 銘柄分析 / 銘柄名", () => {
    const onNavigate = vi.fn();
    render(<StockDetailPage ticker="7203" onNavigate={onNavigate} />);

    const breadcrumb = screen.getByRole("navigation", { name: "パンくずリスト" });
    const links = breadcrumb.querySelectorAll(".stock-breadcrumb-link");
    expect(links.length).toBe(2);
    expect(links[0].textContent).toBe("ホーム");
    expect(links[1].textContent).toBe("銘柄分析");

    fireEvent.click(links[1]);
    expect(onNavigate).toHaveBeenCalledWith("stock");
  });
});

describe("Batch 2: UI-07 - ScreenerPage Toast Notification", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows success toast when onBatchCreateCustomIndex is provided and creates index", async () => {
    const onBatchCreate = vi.fn();
    render(
      <ToastProvider>
        <ScreenerPage
          onNavigate={vi.fn()}
          onOpenStockDetail={vi.fn()}
          onBatchCreateCustomIndex={onBatchCreate}
        />
      </ToastProvider>,
    );

    const batchButton = await screen.findByRole("button", { name: /抽出結果を一括指数化/ });
    fireEvent.click(batchButton);

    expect(onBatchCreate).toHaveBeenCalled();
    const successToast = await screen.findByText(/でカスタム指数を即時作成しました！/);
    expect(successToast).toBeTruthy();
  });

  it("shows info toast and navigates to builder when onBatchCreateCustomIndex is not provided", async () => {
    const onNavigate = vi.fn();
    render(
      <ToastProvider>
        <ScreenerPage onNavigate={onNavigate} onOpenStockDetail={vi.fn()} />
      </ToastProvider>,
    );

    const batchButton = await screen.findByRole("button", { name: /抽出結果を一括指数化/ });
    fireEvent.click(batchButton);

    expect(onNavigate).toHaveBeenCalledWith("builder");
    const infoToast = await screen.findByText(
      "指数ビルダー画面へ移動しました。銘柄構成を調整して指数を作成してください。",
    );
    expect(infoToast).toBeTruthy();
    expect(screen.queryByText(/でカスタム指数を即時作成しました！/)).toBeNull();
  });
});

describe("Batch 2: UI-12 - StatsGrid isFinite Safety Guards", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders '---' when latestCustomValue is NaN or Infinity", () => {
    const { container: containerNaN } = render(
      <StatsGrid
        benchmarkData={{ snapshot: makeSnapshot() }}
        benchmarkLoading={false}
        selectedIndex={mockIndex}
        latestCustomValue={Number.NaN}
        loading={false}
      />,
    );
    expect(containerNaN.textContent).not.toContain("NaN");

    const { container: containerInf } = render(
      <StatsGrid
        benchmarkData={{ snapshot: makeSnapshot() }}
        benchmarkLoading={false}
        selectedIndex={mockIndex}
        latestCustomValue={Number.POSITIVE_INFINITY}
        loading={false}
      />,
    );
    expect(containerInf.textContent).not.toContain("Infinity");
    expect(containerInf.textContent).not.toContain("∞");
  });

  it("safely guards NaN and Infinity in period returns, alpha, and benchmark data", () => {
    const { container } = render(
      <StatsGrid
        benchmarkData={{ snapshot: makeSnapshot(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN) }}
        benchmarkLoading={false}
        selectedIndex={{ ...mockIndex, baseValue: Number.NaN }}
        latestCustomValue={1050}
        loading={false}
        periodCustomReturnPct={Number.NaN}
        periodBenchmarkReturnPct={Number.POSITIVE_INFINITY}
        periodAlphaPct={Number.NaN}
      />,
    );

    const text = container.textContent ?? "";
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("∞");
    expect(text).toContain("BASE ---");
  });
});
