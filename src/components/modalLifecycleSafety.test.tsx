// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddStockModal } from "./AddStockModal";
import { EditPasswordModal } from "./EditPasswordModal";

describe("Modal Lifecycle Safety", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("handles AddStockModal unmount gracefully during in-flight submission", async () => {
    let resolveAdd: ((val: { ok: boolean }) => void) | null = null;
    const onAddStock = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveAdd = resolve;
        }),
    );

    const { unmount } = render(
      <AddStockModal
        isOpen={true}
        onClose={vi.fn()}
        indexName="テスト指数"
        currentCount={1}
        maxStocks={null}
        onAddStock={onAddStock}
      />,
    );

    fireEvent.change(screen.getByLabelText(/銘柄コード/), { target: { value: "7203" } });
    fireEvent.change(screen.getByLabelText(/銘柄名/), { target: { value: "トヨタ" } });
    fireEvent.change(screen.getByLabelText(/構成比率/), { target: { value: "10" } });

    const form = document.getElementById("add-stock-form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(onAddStock).toHaveBeenCalledTimes(1);

    // Unmount while onAddStock is in flight
    unmount();

    // Resolving the promise must not throw or cause unmounted state errors
    if (resolveAdd) {
      (resolveAdd as (val: { ok: boolean }) => void)({ ok: true });
    }
    await waitFor(() => expect(onAddStock).toHaveBeenCalled());
  });

  it("handles EditPasswordModal unmount gracefully during in-flight submission", async () => {
    let resolvePut: ((res: Response) => void) | null = null;
    const fetchSpy = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvePut = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { unmount } = render(
      <EditPasswordModal
        isOpen={true}
        onClose={vi.fn()}
        item={{
          id: "user-1",
          name: "テストユーザー",
          role: "user",
          max_stocks: 10,
          max_indices: 5,
          is_active: 1,
          created_at: 1700000000,
        }}
        onSuccess={vi.fn()}
        getHeaders={() => ({})}
      />,
    );

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(fetchSpy).toHaveBeenCalled();

    // Unmount while network call is in flight
    unmount();

    // Settle network response
    if (resolvePut) {
      (resolvePut as (res: Response) => void)(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });
});
