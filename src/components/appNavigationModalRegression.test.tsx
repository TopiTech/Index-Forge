// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { ToastProvider } from "./Toast";
import type { CustomIndex } from "../data/indices";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const {
  stableSession,
  stableIndices,
  stableIsOwner,
  stableGetHeaders,
  stableNoop,
  stableOkFn,
} = vi.hoisted(() => {
  const index: CustomIndex = {
    id: "ai-semi",
    name: "AI・半導体強化指数",
    description: "Built-in",
    baseValue: 1000,
    basket: [{ ticker: "8035", name: "東京エレクトロン", theme: "半導体", weight: 100 }],
  };
  return {
    stableSession: { id: "user-1", role: "user" as const, name: "User", password: "pw" },
    stableIndices: [index],
    stableIsOwner: () => false,
    stableGetHeaders: () => ({}),
    stableNoop: vi.fn(),
    stableOkFn: vi.fn(async () => ({ ok: true })),
  };
});

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isAdmin: false,
    isUser: true,
    session: stableSession,
    loading: false,
    logout: stableNoop,
    getHeaders: stableGetHeaders,
    getAdminHeaders: stableGetHeaders,
  }),
}));

vi.mock("../hooks/useIndices", () => ({
  useIndices: () => ({
    indices: stableIndices,
    selectedIndex: stableIndices[0],
    canEditSelectedIndex: false,
    isOwner: stableIsOwner,
    addStockToIndex: stableOkFn,
    loading: false,
    error: null,
    refreshIndices: stableNoop,
    saveCustomIndex: stableOkFn,
    deleteCustomIndex: stableOkFn,
    selectIndex: stableNoop,
    removeStockFromIndex: stableOkFn,
  }),
  resolveSelectedIndex: (indices: CustomIndex[]) => indices[0] ?? null,
}));

vi.mock("./StockDetailPage", () => ({
  StockDetailPage: ({
    ticker,
    onAddToIndex,
    onNavigate,
  }: {
    ticker: string;
    onAddToIndex?: (ticker: string, name: string, theme: string) => void;
    onNavigate: (view: "dashboard" | "admin" | "stock") => void;
  }) => (
    <div>
      <span data-testid="detail-ticker">{ticker}</span>
      <button type="button" onClick={() => onAddToIndex?.(ticker, "トヨタ自動車", "自動車")}>
        詳細から指数へ追加
      </button>
      <button type="button" onClick={() => onNavigate("admin")}>
        管理者画面へ
      </button>
    </div>
  ),
}));

vi.mock("./AdminDashboard", () => ({
  AdminDashboard: ({ onBackToApp }: { onBackToApp: () => void }) => (
    <div>
      <span>AdminMock</span>
      <button type="button" onClick={onBackToApp}>
        戻る
      </button>
    </div>
  ),
}));

describe("App route-scoped modal lifecycle and builder overlay reachability", () => {
  beforeEach(() => {
    window.localStorage.setItem("indexforge_tutorial_seen_v1", "true");
    window.scrollTo = vi.fn();
    window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, stockUniverse: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("opens IndexBuilderModal directly from non-dashboard views and closes modals across route changes", async () => {
    window.history.replaceState({}, "", "/stock/7203");
    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );

    const addBtn = await screen.findByRole("button", { name: "詳細から指数へ追加" });
    fireEvent.click(addBtn);

    // IndexBuilderModal must render on /stock route instead of staying invisible
    expect(await screen.findByRole("dialog")).toBeTruthy();

    // Browser popstate navigation away closes the open modal cleanly
    act(() => {
      window.history.pushState({}, "", "/admin");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByText("AdminMock")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    // Navigating back to dashboard does not revive the dismissed builder modal
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    await waitFor(() => {
      expect(screen.queryByText("AdminMock")).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
