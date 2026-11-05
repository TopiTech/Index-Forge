// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  basket: [
    { ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 50 },
  ],
};

let addStockDeferred: {
  promise: Promise<{ ok: boolean }>;
  resolve: (res: { ok: boolean }) => void;
  reject: (err: Error) => void;
};

function createDeferred() {
  let resolve!: (res: { ok: boolean }) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<{ ok: boolean }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const addStockToIndexMock = vi.fn().mockImplementation(() => {
  addStockDeferred = createDeferred();
  return addStockDeferred.promise;
});

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isAdmin: true,
    session: { id: "test", role: "admin", name: "Tester" },
    loading: false,
    logout: vi.fn(),
  }),
}));

vi.mock("../hooks/useIndices", () => ({
  useIndices: () => ({
    indices: [mockIndex],
    selectedIndex: mockIndex,
    canEditSelectedIndex: true,
    addStockToIndex: addStockToIndexMock,
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

describe("App handleAddStockToIndex concurrency lock & duplicate prevention (TASK-05)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    window.localStorage.setItem("indexforge_tutorial_seen_v1", "true");
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
    addStockToIndexMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("prevents double-add during in-flight communication (exclusive lock)", async () => {
    // Navigate to a stock not in the basket (Sony: 6758)
    window.history.replaceState({}, "", "/stock?ticker=6758");

    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );

    // Find the "指数に追加" button
    const addButton = await screen.findByRole("button", { name: /指数に追加/ }, { timeout: 5000 });
    expect(addButton).toBeTruthy();

    // Click once to start the in-flight request
    fireEvent.click(addButton);
    expect(addStockToIndexMock).toHaveBeenCalledTimes(1);

    // Click a second time while communication is still in progress
    fireEvent.click(addButton);
    // Exclusive lock must have prevented the duplicate call
    expect(addStockToIndexMock).toHaveBeenCalledTimes(1);

    // Resolve the in-flight add
    await act(async () => {
      addStockDeferred.resolve({ ok: true });
    });

    // Wait for the success toast
    await screen.findByText(/「ソニーグループ」を指数に追加しました/, {}, { timeout: 5000 });

    // Now that communication finished, lock is released: subsequent clicks can fire
    fireEvent.click(addButton);
    expect(addStockToIndexMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      addStockDeferred.resolve({ ok: true });
    });
  });

  it("releases lock even when in-flight request rejects (finally guard)", async () => {
    window.history.replaceState({}, "", "/stock?ticker=6758");

    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );

    const addButton = await screen.findByRole("button", { name: /指数に追加/ }, { timeout: 5000 });

    // Click 1: in-flight
    fireEvent.click(addButton);
    expect(addStockToIndexMock).toHaveBeenCalledTimes(1);

    // Click 2 during in-flight: ignored
    fireEvent.click(addButton);
    expect(addStockToIndexMock).toHaveBeenCalledTimes(1);

    // In-flight request fails
    await act(async () => {
      addStockDeferred.reject(new Error("Network error"));
    });

    // Wait for error toast
    await screen.findByText(/「ソニーグループ」の指数への追加に失敗しました/, {}, { timeout: 5000 });

    // Lock must be released in finally, allowing retry
    fireEvent.click(addButton);
    expect(addStockToIndexMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      addStockDeferred.resolve({ ok: true });
    });
  });

  it("immediately informs user and avoids API call if stock is already in selectedIndex.basket", async () => {
    // Navigate to Toyota (7203), which is already in mockIndex.basket
    window.history.replaceState({}, "", "/stock?ticker=7203");

    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );

    const addButton = await screen.findByRole("button", { name: /指数に追加/ }, { timeout: 5000 });

    // Click "指数に追加" for already-present constituent
    fireEvent.click(addButton);

    // Must NOT call addStockToIndex API
    expect(addStockToIndexMock).not.toHaveBeenCalled();

    // Must show friendly feedback toast
    const alreadyToast = await screen.findByText(/は既にこの指数に含まれています/, {}, { timeout: 5000 });
    expect(alreadyToast).toBeTruthy();
  });
});
