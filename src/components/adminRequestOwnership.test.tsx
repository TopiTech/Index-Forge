// @vitest-environment jsdom
/**
 * Behavioral replacement for the source-string pins in
 * `src/lib/goalFollowupReview.test.ts` (S6, deleted alongside this file).
 *
 * The old suite asserted implementation text (`toContain("abortControllerRef.current.abort();")`,
 * ref names, statement order), so it failed on refactors without regressions
 * and passed when the guards were wired but never ran. These tests drive the
 * real components instead:
 *
 * - backdrop drag-through guard (EditPasswordModal),
 * - aborted password-list responses writing no state (AdminDashboard),
 * - malformed / non-JSON password payloads reported, never thrown,
 * - administrator re-login mapping (`reportAdminFailure`),
 * - stale telemetry responses never overwriting newer ones (AdminDashboard).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NETWORK_UNREACHABLE_MESSAGE } from "../lib/apiContract";
import { EditPasswordModal } from "./EditPasswordModal";
import {
  ADMIN_SESSION_EXPIRED_MESSAGE,
  AdminDashboard,
  reportAdminFailure,
} from "./AdminDashboard";

// Stable across renders: the dashboard's fetch effects depend on the headers
// callback identity, so a fresh closure per `useAuth()` call would refetch on
// every render (the real hook memoizes its callbacks). `vi.hoisted` keeps the
// reference identical for the whole file.
const { stableGetAdminHeaders } = vi.hoisted(() => ({
  stableGetAdminHeaders: () => ({ "x-admin-session": "admin-token" }),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: {
      id: "admin-master",
      name: "管理者",
      role: "admin",
      password: "",
      adminToken: "admin-token",
    },
    isAdmin: true,
    adminLogin: vi.fn(),
    logout: vi.fn(),
    getAdminHeaders: stableGetAdminHeaders,
  }),
}));

vi.mock("./Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function passwordRow(id: string, name: string) {
  return {
    id,
    name,
    role: "user",
    max_stocks: 10,
    max_indices: null,
    is_active: 1,
    created_at: 1700000000,
  };
}

function statsPayload(version: string) {
  return {
    ok: true,
    stats: {
      dbStatus: "OK",
      indicesCount: 3,
      totalConstituents: 30,
      version,
    },
  };
}

function renderDashboard(fetchImpl: (url: string) => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => fetchImpl(String(input))),
  );
  render(
    <AdminDashboard
      indices={[]}
      onBackToApp={() => {}}
      onRefreshIndices={async () => {}}
      saveCustomIndex={async () => ({ ok: true })}
      deleteCustomIndex={async () => ({ ok: true })}
    />,
  );
}

const dashboardProps = {
  indices: [],
  onBackToApp: () => {},
  onRefreshIndices: async () => {},
  saveCustomIndex: async () => ({ ok: true as const }),
  deleteCustomIndex: async () => ({ ok: true as const }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EditPasswordModal backdrop safety (behavioral)", () => {
  const item = {
    id: "u1",
    name: "Alice",
    role: "user" as const,
    max_stocks: 10,
    max_indices: null,
    is_active: 1,
    created_at: 1700000000,
  };

  it("closes when pressed and released on the backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(
      <EditPasswordModal
        isOpen
        onClose={onClose}
        item={item}
        onSuccess={() => {}}
        getHeaders={() => ({})}
      />,
    );
    const overlay = container.querySelector(".modal-overlay") as HTMLElement;
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a drag that starts inside the dialog and ends on the backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(
      <EditPasswordModal
        isOpen
        onClose={onClose}
        item={item}
        onSuccess={() => {}}
        getHeaders={() => ({})}
      />,
    );
    const overlay = container.querySelector(".modal-overlay") as HTMLElement;
    const dialog = container.querySelector("[data-modal-dialog]") as HTMLElement;
    // The dialog stops mousedown propagation, so the backdrop never arms.
    fireEvent.mouseDown(dialog);
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("AdminDashboard password-list abort ownership (behavioral)", () => {
  it("drops a stale aborted response instead of rendering its rows", async () => {
    const firstPasswords = deferred<Response>();
    let passwordCalls = 0;
    renderDashboard(async (url) => {
      if (url.includes("/api/admin/passwords")) {
        passwordCalls += 1;
        if (passwordCalls === 1) return firstPasswords.promise;
        return jsonResponse([passwordRow("b1", "FRESH-Bob")]);
      }
      return jsonResponse({ ok: true });
    });

    // Tab away (aborting the pending first fetch) and back (starting #2).
    fireEvent.click(screen.getByRole("tab", { name: /全指数/ }));
    fireEvent.click(screen.getByRole("tab", { name: /ユーザー用パスワード管理/ }));
    await waitFor(() => expect(screen.queryByText("FRESH-Bob")).not.toBeNull());
    expect(passwordCalls).toBe(2);

    // The aborted first response arrives late with different rows.
    await act(async () => {
      firstPasswords.resolve(jsonResponse([passwordRow("a1", "STALE-Alice")]));
      await Promise.resolve();
    });

    expect(screen.queryByText("STALE-Alice")).toBeNull();
    expect(screen.queryByText("FRESH-Bob")).not.toBeNull();
    expect(screen.queryByText(/パスワード一覧を取得できませんでした/)).toBeNull();
  });

  it("reports malformed and non-JSON payloads without throwing", async () => {
    renderDashboard(async (url) => {
      if (url.includes("/api/admin/passwords")) {
        return jsonResponse({ ok: false, error: "not-a-list" });
      }
      return jsonResponse({ ok: true });
    });
    await waitFor(() =>
      expect(screen.queryByText(/応答が不正です/)).not.toBeNull(),
    );

    vi.unstubAllGlobals();
    renderDashboard(async (url) => {
      if (url.includes("/api/admin/passwords")) {
        return new Response("<html>gateway error</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        });
      }
      return jsonResponse({ ok: true });
    });
    render(
      <AdminDashboard
        {...dashboardProps}
        key="second"
        indices={[]}
        onBackToApp={() => {}}
        onRefreshIndices={async () => {}}
        saveCustomIndex={async () => ({ ok: true })}
        deleteCustomIndex={async () => ({ ok: true })}
      />,
    );
    await waitFor(() =>
      expect(screen.queryAllByText(/パスワード一覧を取得できませんでした/).length).toBeGreaterThan(0),
    );
  });
});

describe("reportAdminFailure mapping (behavioral, preserved)", () => {
  it("turns a refused administrator call into a re-login message", () => {
    expect(reportAdminFailure({ error: "管理者権限が必要です" }, 403, "fallback")).toBe(
      ADMIN_SESSION_EXPIRED_MESSAGE,
    );
    expect(reportAdminFailure({ error: "サーバーエラー" }, 500, "fallback")).toBe("サーバーエラー");
    expect(reportAdminFailure({}, 500, "fallback")).toContain("fallback");
  });

  it("keeps the shared offline message distinct from the raw browser error", () => {
    expect(NETWORK_UNREACHABLE_MESSAGE).not.toContain("Failed to fetch");
  });
});

describe("AdminDashboard telemetry generation guard (behavioral)", () => {
  it("never lets a stale stats response overwrite newer telemetry", async () => {
    const firstStats = deferred<Response>();
    let statsCalls = 0;
    renderDashboard(async (url) => {
      if (url.includes("/api/admin/system-stats")) {
        statsCalls += 1;
        if (statsCalls === 1) return firstStats.promise;
        return jsonResponse(statsPayload("v2-fresh"));
      }
      if (url.includes("/api/admin/passwords")) return jsonResponse([]);
      return jsonResponse({ ok: true });
    });

    fireEvent.click(screen.getByRole("tab", { name: /システム運用健全性/ }));
    await waitFor(() => expect(statsCalls).toBe(1));
    // Away (aborting #1) and back (starting #2 with fresh telemetry).
    fireEvent.click(screen.getByRole("tab", { name: /ユーザー用パスワード管理/ }));
    fireEvent.click(screen.getByRole("tab", { name: /システム運用健全性/ }));
    await waitFor(() => expect(screen.queryByText("v2-fresh")).not.toBeNull());

    await act(async () => {
      firstStats.resolve(jsonResponse(statsPayload("v1-stale")));
      await Promise.resolve();
    });

    expect(screen.queryByText("v1-stale")).toBeNull();
    expect(screen.queryByText("v2-fresh")).not.toBeNull();
  });
});

describe("AdminDashboard password creation validation (behavioral)", () => {
  it("fast-fails client-side when password is under 8 characters without calling POST /api/admin/passwords", async () => {
    let postCalled = false;
    renderDashboard(async (url) => {
      if (url.includes("/api/admin/passwords")) {
        postCalled = true;
        return jsonResponse([]);
      }
      return jsonResponse({ ok: true });
    });

    const nameInput = document.getElementById("new-user-name") as HTMLInputElement;
    const passwordInput = document.getElementById("new-user-password") as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: "Test User" } });
    fireEvent.change(passwordInput, { target: { value: "short" } });

    postCalled = false;
    const submitBtn = screen.getByRole("button", { name: "ユーザーパスワードを発行" });
    fireEvent.click(submitBtn);

    expect(await screen.findByText("パスワードは8〜100文字で入力してください")).toBeTruthy();
    expect(postCalled).toBe(false);
  });
});
