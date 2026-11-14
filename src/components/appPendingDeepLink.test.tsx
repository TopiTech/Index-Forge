// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { ToastProvider } from "./Toast";
import type { CustomIndex } from "../data/indices";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const otherIndex: CustomIndex = {
  id: "other-index",
  name: "Other Index",
  description: "Already selected",
  baseValue: 1000,
  basket: [{ ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 100 }],
};

const lateIndex: CustomIndex = {
  id: "late-index",
  name: "Late Index",
  description: "Arrives after the link was abandoned",
  baseValue: 1000,
  basket: [{ ticker: "9984", name: "ソフトバンクG", theme: "AI", weight: 100 }],
};

let mockIndices: CustomIndex[] = [];
let mockSelectedIndex: CustomIndex | null = null;
let mockLoadingIndices = true;
const selectIndexMock = vi.fn();

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isAdmin: false,
    session: null,
    loading: false,
    logout: vi.fn(),
  }),
}));

vi.mock("../hooks/useIndices", () => ({
  useIndices: () => ({
    indices: mockIndices,
    selectedIndex: mockSelectedIndex,
    canEditSelectedIndex: false,
    isOwner: () => false,
    addStockToIndex: vi.fn(),
    loadingIndices: mockLoadingIndices,
    indicesError: null,
    refreshIndices: vi.fn(),
    createIndex: vi.fn(),
    updateIndex: vi.fn(),
    deleteIndex: vi.fn(),
    selectIndex: selectIndexMock,
    removeStockFromIndex: vi.fn(),
  }),
  resolveSelectedIndex: (indices: CustomIndex[]) => indices[0] ?? null,
}));

describe("App initial dashboard deep link", () => {
  beforeEach(() => {
    mockIndices = [];
    mockSelectedIndex = null;
    mockLoadingIndices = true;
    selectIndexMock.mockClear();
    window.localStorage.setItem("indexforge_tutorial_seen_v1", "true");
    window.history.replaceState({}, "", "/?index=late-index");
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
    window.scrollTo = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: {} }), {
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

  it("does not revive the mount-time ?index= after the user navigates home", async () => {
    const view = render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );

    // The list is still loading, so the deep link is pending. The user
    // explicitly navigates to the dashboard without any query.
    fireEvent.click(await screen.findByRole("link", { name: /IndexForge/ }));
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/"));

    // The authoritative list now arrives and contains the old deep-link id.
    // It must not be selected: the explicit navigation already abandoned it.
    mockIndices = [otherIndex, lateIndex];
    mockSelectedIndex = otherIndex;
    mockLoadingIndices = false;
    view.rerender(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );

    await waitFor(() => expect(screen.getAllByText("Other Index").length).toBeGreaterThan(0));
    expect(selectIndexMock).not.toHaveBeenCalled();
    // The URL now reflects the selected index, never the abandoned deep link.
    expect(window.location.search).not.toContain("late-index");
    expect(window.location.search).toContain("index=other-index");
  });
});
