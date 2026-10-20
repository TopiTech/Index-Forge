// @vitest-environment jsdom
/**
 * Regression suite for the autonomous goal review fixes.
 *
 * The quota clamping and the constituent owner flow are production behaviour,
 * so they are exercised through the real components:
 *
 * - `EditPasswordModal` is the only place that clamps `maxStocks` /
 *   `maxIndices` before they are sent to the Worker, and
 * - `ConstituentsTable` owns the delete flow (permission check, "last
 *   constituent" guard, authentication prompt, confirmation).
 *
 * Both used to be re-implemented inside this file, which made the assertions
 * vacuous: a copy can only ever agree with itself, so the tests stayed green
 * even when the production code broke.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import worker from "../../worker/index";
import type { WorkerExecutionContext } from "../../worker/internal";
import { asWorkerEnv } from "../test-helpers/env";
import { ConstituentsTable } from "../components/ConstituentsTable";
import { EditPasswordModal } from "../components/EditPasswordModal";
import { ToastProvider } from "../components/Toast";
import type { BasketItem, UserPasswordItem } from "../types";

/** The subset of the `Response` contract the production code reads. */
interface FetchResponseDouble {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

/**
 * Test double for the browser `fetch`.
 *
 * Only the two client-side endpoints used by the components under test are
 * answered; everything else (the Turnstile configuration) gets an empty but
 * successful payload.
 */
function createFetchMock() {
  return vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit): Promise<FetchResponseDouble> => {
      const url = String(input);
      if (url.includes("/api/auth/verify")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            role: "user",
            name: "テストユーザー",
            maxStocks: null,
            maxIndices: null,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, siteKey: "1x00000000000000000000AA" }),
      };
    },
  );
}

type FetchMock = ReturnType<typeof createFetchMock>;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("Autonomous Goal Review Fixes: Quota Bounds & Clamping", () => {
  const USER_PASSWORD: UserPasswordItem = {
    id: "pw-user-1",
    name: "一般ユーザー",
    role: "user",
    max_stocks: 10,
    max_indices: 5,
    is_active: 1,
    created_at: 0,
  };

  interface QuotaPayload {
    id: string;
    name: string;
    role: string;
    maxStocks: number | null;
    maxIndices: number | null;
  }

  function renderEditPasswordModal(item: UserPasswordItem = USER_PASSWORD) {
    return render(
      createElement(EditPasswordModal, {
        isOpen: true,
        onClose: vi.fn(),
        item,
        onSuccess: vi.fn(),
        getHeaders: () => ({}),
      }),
    );
  }

  /**
   * Submits the modal and returns the payload the production code sent to
   * `PUT /api/admin/passwords`.
   */
  async function submitQuotaForm(
    container: HTMLElement,
    fetchMock: FetchMock,
    expectedCalls: number,
  ): Promise<QuotaPayload> {
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(expectedCalls));
    // The modal returns to its idle state once the request settled.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "変更を保存" })).toBeTruthy(),
    );

    const init = fetchMock.mock.calls[expectedCalls - 1]?.[1];
    return JSON.parse(String(init?.body ?? "")) as QuotaPayload;
  }

  it("clamps maxStocks within 1 to 500", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderEditPasswordModal();
    const maxStocks = container.querySelector("#edit-pw-max-stocks") as HTMLInputElement;
    expect(maxStocks).not.toBeNull();

    const cases: [string, number][] = [
      ["600", 500],
      ["1000", 500],
      ["-5", 1],
      ["0", 1],
      ["250", 250],
      ["abc", 1],
    ];

    for (const [index, [input, expected]] of cases.entries()) {
      fireEvent.change(maxStocks, { target: { value: input } });
      // The production input handler clamps the value it keeps in state.
      expect(maxStocks.value).toBe(String(expected));

      const payload = await submitQuotaForm(container, fetchMock, index + 1);
      expect(payload.maxStocks).toBe(expected);
    }
  });

  it("clamps maxIndices within 1 to 100", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderEditPasswordModal();
    const maxIndices = container.querySelector("#edit-pw-max-indices") as HTMLInputElement;
    expect(maxIndices).not.toBeNull();

    const cases: [string, number][] = [
      ["200", 100],
      ["150", 100],
      ["-10", 1],
      ["0", 1],
      ["50", 50],
      ["abc", 1],
    ];

    for (const [index, [input, expected]] of cases.entries()) {
      fireEvent.change(maxIndices, { target: { value: input } });
      expect(maxIndices.value).toBe(String(expected));

      const payload = await submitQuotaForm(container, fetchMock, index + 1);
      expect(payload.maxIndices).toBe(expected);
    }
  });

  it("sends null limits when the owner opted out of a quota", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderEditPasswordModal();

    // Each quota block owns its own "無制限" checkbox.
    const unlimitedCheckbox = (labelText: string): HTMLInputElement => {
      const label = screen.getByText(labelText);
      const checkbox = label
        .closest("div")
        ?.querySelector('input[type="checkbox"]');
      expect(checkbox).not.toBeNull();
      return checkbox as HTMLInputElement;
    };

    fireEvent.click(unlimitedCheckbox("最大銘柄数制限"));
    fireEvent.click(unlimitedCheckbox("作成可能 指数上限数"));

    const payload = await submitQuotaForm(container, fetchMock, 1);
    expect(payload.maxStocks).toBeNull();
    expect(payload.maxIndices).toBeNull();
  });

  it("sends null limits for an administrator account", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderEditPasswordModal();
    const role = container.querySelector("#edit-pw-role") as HTMLSelectElement;
    const secret = container.querySelector("#edit-pw-secret") as HTMLInputElement;

    // Promoting a user to administrator requires a new password.
    fireEvent.change(secret, { target: { value: "New-Password-1" } });
    fireEvent.change(role, { target: { value: "admin" } });

    const payload = await submitQuotaForm(container, fetchMock, 1);
    expect(payload.role).toBe("admin");
    expect(payload.maxStocks).toBeNull();
    expect(payload.maxIndices).toBeNull();
  });
});

describe("Autonomous Goal Review Fixes: ConstituentsTable Unauthenticated Owner Flow", () => {
  const BASKET: BasketItem[] = [
    { ticker: "7203.T", name: "トヨタ", theme: "EV", weight: 50 },
    { ticker: "6758.T", name: "ソニーグループ", theme: "EV", weight: 30 },
    { ticker: "9984.T", name: "ソフトバンクグループ", theme: "IT", weight: 20 },
  ];

  function renderConstituentsTable(options: {
    basket: BasketItem[];
    canEdit: boolean;
    onRemoveStock?: (ticker: string) => Promise<{ ok: boolean; error?: string }>;
  }) {
    return render(
      createElement(
        ToastProvider,
        null,
        createElement(ConstituentsTable, {
          basket: options.basket,
          selectedTheme: null,
          canEdit: options.canEdit,
          onRemoveStock: options.onRemoveStock,
        }),
      ),
    );
  }

  /** The delete control of the desktop table (the mobile cards repeat it). */
  function desktopDeleteButtons(): HTMLElement[] {
    const table = screen.getByRole("region", { name: "構成銘柄一覧テーブル" });
    return within(table).getAllByRole("button", {
      name: "削除するにはパスワード認証が必要です",
    });
  }

  it("gives the owner the edit controls and the non-owner a read-only view", () => {
    const onRemoveStock = vi.fn(async () => ({ ok: true }));
    const { unmount } = renderConstituentsTable({
      basket: BASKET,
      canEdit: true,
      onRemoveStock,
    });

    // The owner may edit, but the session is not authenticated yet: the table
    // asks for the password instead of deleting anything right away.
    expect(screen.getByText("編集するにはパスワード認証が必要です")).toBeTruthy();
    expect(screen.getByRole("button", { name: /ログインして編集/ })).toBeTruthy();
    expect(desktopDeleteButtons()).toHaveLength(BASKET.length);

    unmount();

    // A non-owner gets a read-only table: no delete control at all.
    renderConstituentsTable({ basket: BASKET, canEdit: false });
    expect(
      screen.getByText("この指数は閲覧専用です（作成者または管理者のみ編集可能）"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /管理者ログイン/ })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "削除するにはパスワード認証が必要です" }),
    ).toBeNull();
  });

  it("refuses to delete the last constituent of an index", () => {
    const onRemoveStock = vi.fn(async () => ({ ok: true }));
    renderConstituentsTable({
      basket: [BASKET[0]],
      canEdit: true,
      onRemoveStock,
    });

    fireEvent.click(desktopDeleteButtons()[0]);

    expect(
      screen.getByText("構成銘柄が1件のみのため削除できません。指数には最低1銘柄必要です。"),
    ).toBeTruthy();
    // An impossible deletion must not trigger the authentication modal.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onRemoveStock).not.toHaveBeenCalled();
  });

  it("asks the unauthenticated owner to authenticate and keeps the pending deletion", async () => {
    const onRemoveStock = vi.fn(async () => ({ ok: true }));
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    renderConstituentsTable({ basket: BASKET, canEdit: true, onRemoveStock });

    fireEvent.click(desktopDeleteButtons()[0]);

    // Nothing is deleted before the owner authenticates.
    expect(onRemoveStock).not.toHaveBeenCalled();
    const authDialog = await screen.findByRole("dialog");
    expect(authDialog.textContent).toContain("ログイン認証");

    // Real general-user login through the production AuthModal.
    fireEvent.click(screen.getByRole("button", { name: /一般ユーザー/ }));
    fireEvent.change(screen.getByLabelText(/アクセスパスワード/), {
      target: { value: "user-password" },
    });
    const authForm = document.getElementById("auth-modal-form");
    expect(authForm).not.toBeNull();
    fireEvent.submit(authForm as HTMLFormElement);

    // The pending deletion survived the login and still needs a confirmation.
    const confirmDialog = await screen.findByRole("alertdialog");
    expect(confirmDialog.textContent).toContain("トヨタ (7203.T)");
    expect(onRemoveStock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(onRemoveStock).toHaveBeenCalledWith("7203.T"));
  });
});

describe("Autonomous Goal Review Fixes: ExecutionContext in Worker", () => {
  it("worker fetch accepts optional ExecutionContext and uses waitUntil", async () => {
    const waitUntilMock = vi.fn();
    const ctx: WorkerExecutionContext = {
      waitUntil: waitUntilMock,
      passThroughOnException: vi.fn(),
    };

    const mockEnv = asWorkerEnv({
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
            all: vi.fn().mockResolvedValue({ results: [] }),
            first: vi.fn().mockResolvedValue(null),
          }),
        }),
      },
      ASSETS: { fetch: vi.fn() },
    });

    const request = new Request("http://localhost/api/health", { method: "GET" });
    const response = await worker.fetch(request, mockEnv, ctx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, service: "indexforge-worker" });
  });

  it("worker fetch operates reliably even without ExecutionContext provided", async () => {
    const mockEnv = asWorkerEnv({
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
          }),
        }),
      },
      ASSETS: { fetch: vi.fn() },
    });

    const request = new Request("http://localhost/api/health", { method: "GET" });
    // Calling fetch without ctx (standard 2-arg call)
    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(200);
  });
});
