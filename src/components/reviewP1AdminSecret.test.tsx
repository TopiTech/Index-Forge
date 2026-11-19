// @vitest-environment jsdom
/**
 * UI-1 P1-10: the worker always rotates the admin session when the secret code
 * changes. A success response without a new adminToken is therefore a broken
 * contract: report it and ask the operator to log in again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { logout, successToast } = vi.hoisted(() => ({
  logout: vi.fn(),
  successToast: vi.fn(),
}));

const { stableGetAdminHeaders } = vi.hoisted(() => ({
  stableGetAdminHeaders: () => ({ "x-admin-session": "admin-token" }),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: {
      id: "admin-master",
      name: "管理者",
      role: "admin",
      adminToken: "admin-token",
    },
    isAdmin: true,
    isAuthenticated: true,
    adminLogin: vi.fn(),
    logout,
    getAdminHeaders: stableGetAdminHeaders,
  }),
}));

vi.mock("./Toast", () => ({
  useToast: () => ({
    success: successToast,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { AdminDashboard } from "./AdminDashboard";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderDashboard() {
  return render(
    <AdminDashboard
      indices={[]}
      onBackToApp={vi.fn()}
      onRefreshIndices={vi.fn(async () => {})}
      saveCustomIndex={vi.fn(async () => ({ ok: true as const }))}
      deleteCustomIndex={vi.fn(async () => ({ ok: true as const }))}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/admin-secret-code")) {
        // Broken contract: ok:true but no rotated session token.
        return jsonResponse({ ok: true, message: "秘密の暗号を更新しました" });
      }
      if (url.includes("/api/admin/stats")) {
        return jsonResponse({ ok: true, stats: {} });
      }
      return jsonResponse({ ok: true, passwords: [] });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminDashboard secret-code session contract (P1-10)", () => {
  it("reports a missing adminToken as an error and asks for re-login", async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("tab", { name: /管理者設定/ }));

    fireEvent.change(await screen.findByLabelText("現在の秘密の暗号 (確認用)"), {
      target: { value: "old-secret" },
    });
    fireEvent.change(screen.getByLabelText(/新しい秘密の暗号 \(6〜100文字/), {
      target: { value: "new-secret" },
    });
    fireEvent.change(screen.getByLabelText("新しい秘密の暗号（確認）"), {
      target: { value: "new-secret" },
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "秘密の暗号を更新" }).hasAttribute("disabled"),
      ).toBe(false);
    });
    fireEvent.submit(screen.getByRole("button", { name: "秘密の暗号を更新" }).closest("form")!);

    await screen.findByText(/再ログイン/);
    expect(successToast).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });
});
