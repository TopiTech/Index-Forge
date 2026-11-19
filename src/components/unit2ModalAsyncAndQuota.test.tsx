// @vitest-environment jsdom
/**
 * Behavioural regressions for C1 (stale Turnstile token after lockout),
 * C4 (rejected async submit must release the busy state) and C5 (the stock
 * limit follows the same `isUser` rule as the parent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthModal } from "./AuthModal";
import { AddStockModal } from "./AddStockModal";

const { authMock } = vi.hoisted(() => ({
  authMock: {
    login: vi.fn(),
    adminLogin: vi.fn(),
    loading: false,
    isUser: true,
  },
}));

vi.mock("../hooks/useAuth", () => ({ useAuth: () => authMock }));

type TurnstileParams = {
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
};

const { turnstileMock } = vi.hoisted(() => ({
  turnstileMock: {
    params: [] as TurnstileParams[],
    reset: vi.fn(),
    remove: vi.fn(),
  },
}));

function installTurnstile(): void {
  turnstileMock.params.length = 0;
  turnstileMock.reset.mockClear();
  turnstileMock.remove.mockClear();
  Object.defineProperty(window, "turnstile", {
    configurable: true,
    value: {
      render: vi.fn((_container: unknown, params: TurnstileParams) => {
        turnstileMock.params.push(params);
        return `widget-${turnstileMock.params.length}`;
      }),
      reset: turnstileMock.reset,
      remove: turnstileMock.remove,
    },
  });
}

function stubConfigFetch(lockout?: { locked: boolean; remainingSeconds: number; remainingAttempts: number }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ siteKey: "test-site-key", lockout }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

function getSubmitButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    '#auth-modal-form button[type="submit"]',
  ) as HTMLButtonElement;
}

beforeEach(() => {
  authMock.login.mockReset();
  authMock.adminLogin.mockReset();
  authMock.loading = false;
  authMock.isUser = true;
  stubConfigFetch();
  installTurnstile();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "turnstile");
  localStorage.clear();
});

describe("C1: admin lockout discards the solved Turnstile token", () => {
  it("requires a fresh token after the lockout expires", async () => {
    authMock.adminLogin.mockResolvedValue({
      ok: false,
      locked: true,
      remainingSeconds: 1,
      remainingAttempts: 0,
    });
    const onClose = vi.fn();
    render(<AuthModal isOpen onClose={onClose} />);

    await waitFor(() => expect(turnstileMock.params.length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText(/管理者パスワード/), { target: { value: "secret" } });
    fireEvent.change(document.getElementById("auth-modal-secret-code-input") as HTMLInputElement, {
      target: { value: "code" },
    });
    act(() => {
      turnstileMock.params[turnstileMock.params.length - 1].callback?.("stale-token");
    });
    fireEvent.submit(document.getElementById("auth-modal-form") as HTMLFormElement);
    await waitFor(() => expect(authMock.adminLogin).toHaveBeenCalledWith("secret", "code", "stale-token"));

    // The lockout warning replaces the widget while the countdown runs.
    await waitFor(() =>
      expect(screen.getByText("管理者ログインのセキュリティロック発動中")).toBeTruthy(),
    );
    expect(document.querySelector(".turnstile-wrapper")).toBeNull();

    // The widget remounts after expiry, but the old token must not come back.
    await waitFor(() => expect(document.querySelector(".turnstile-wrapper")).not.toBeNull(), {
      timeout: 5000,
    });
    expect(getSubmitButton().disabled).toBe(true);
    expect(authMock.adminLogin).toHaveBeenCalledTimes(1);

    act(() => {
      turnstileMock.params[turnstileMock.params.length - 1].callback?.("fresh-token");
    });
    fireEvent.submit(document.getElementById("auth-modal-form") as HTMLFormElement);
    await waitFor(() => expect(authMock.adminLogin).toHaveBeenCalledTimes(2));
    expect(authMock.adminLogin).toHaveBeenLastCalledWith("secret", "code", "fresh-token");
  });
});

describe("C4: rejected submissions release the busy state", () => {
  it("lets the user retry and cancel after onAddStock rejects", async () => {
    const onAddStock = vi.fn().mockRejectedValue(new Error("通信に失敗しました"));
    const onClose = vi.fn();
    render(
      <AddStockModal
        isOpen
        onClose={onClose}
        indexName="テスト指数"
        currentCount={1}
        maxStocks={null}
        onAddStock={onAddStock}
      />,
    );

    fireEvent.change(screen.getByLabelText(/銘柄コード/), { target: { value: "7203" } });
    fireEvent.change(screen.getByLabelText(/銘柄名/), { target: { value: "トヨタ" } });
    fireEvent.submit(document.getElementById("add-stock-form") as HTMLFormElement);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("通信に失敗しました"));
    expect((screen.getByRole("button", { name: "キャンセル" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "銘柄を追加" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lets the user retry and cancel after user login rejects", async () => {
    authMock.login.mockRejectedValue(new Error("認証サービスに接続できません"));
    const onClose = vi.fn();
    render(<AuthModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "一般ユーザー" }));
    fireEvent.change(screen.getByLabelText(/アクセスパスワード/), { target: { value: "pw" } });
    fireEvent.submit(document.getElementById("auth-modal-form") as HTMLFormElement);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("認証サービスに接続できません"),
    );
    expect((screen.getByRole("button", { name: "キャンセル" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("C5: the stock limit applies only to general users", () => {
  it("ignores maxStocks for admins and uses permission/plan wording for users", () => {
    authMock.isUser = false;
    const props = {
      isOpen: true,
      onClose: () => {},
      indexName: "テスト指数",
      currentCount: 5,
      maxStocks: 2,
      onAddStock: vi.fn(async () => ({ ok: true })),
    };
    const { rerender } = render(<AddStockModal {...props} />);

    expect(screen.queryByText(/に達しているため/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/銘柄コード/), { target: { value: "7203" } });
    fireEvent.change(screen.getByLabelText(/銘柄名/), { target: { value: "トヨタ" } });
    expect((screen.getByRole("button", { name: "銘柄を追加" }) as HTMLButtonElement).disabled).toBe(false);

    authMock.isUser = true;
    rerender(<AddStockModal {...props} />);
    expect(screen.getByText(/現在の権限\/プランで許可されている銘柄数上限/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "銘柄を追加" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(document.getElementById("add-stock-form") as HTMLFormElement);
    expect(screen.getByRole("alert").textContent).toContain("この権限/プランの上限（最大2銘柄）");
  });
});
