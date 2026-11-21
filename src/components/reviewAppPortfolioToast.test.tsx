// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { ToastProvider } from "./Toast";
import type { CustomIndex } from "../data/indices";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const mockIndex: CustomIndex = {
  id: "test-index",
  name: "My Test Index",
  description: "Test description",
  baseValue: 1000,
  basket: [{ ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 100 }],
};

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isAdmin: true,
    session: { id: "admin-master", role: "admin", name: "Admin" },
    loading: false,
    logout: vi.fn(),
  }),
}));

vi.mock("../hooks/useIndices", () => ({
  useIndices: () => ({
    indices: [mockIndex],
    selectedIndex: mockIndex,
    canEditSelectedIndex: true,
    addStockToIndex: vi.fn(async () => ({ ok: true })),
    loadingIndices: false,
    indicesError: null,
    refreshIndices: vi.fn(),
    createIndex: vi.fn(),
    updateIndex: vi.fn(),
    deleteIndex: vi.fn(),
    selectIndex: vi.fn(),
    removeStockFromIndex: vi.fn(),
  }),
  resolveSelectedIndex: (indices: CustomIndex[]) => indices[0] ?? null,
}));

vi.mock("../lib/portfolioStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portfolioStorage")>();
  return {
    ...actual,
    addPortfolioPosition: vi.fn(() => false),
  };
});

vi.mock("./StockDetailPage", () => ({
  StockDetailPage: ({
    ticker,
    onAddToPortfolio,
  }: {
    ticker: string;
    onAddToPortfolio?: (ticker: string, price: number, name?: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onAddToPortfolio?.(ticker, 2850, "トヨタ自動車")}
    >
      trigger-portfolio-add
    </button>
  ),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  window.localStorage.setItem("indexforge_tutorial_seen_v1", "true");
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BUG-09: App.handleAddToPortfolio uses toastError when storage persistence fails", () => {
  it("shows an error toast (.toast-error) instead of info toast when addPortfolioPosition returns false", async () => {
    window.history.replaceState({}, "", "/stock?ticker=7203");
    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );

    const triggerBtn = await screen.findByRole("button", { name: "trigger-portfolio-add" });
    fireEvent.click(triggerBtn);

    const errText = await screen.findByText(/ポートフォリオ登録に失敗しました/);
    expect(errText.closest(".toast-error")).not.toBeNull();
  });
});
