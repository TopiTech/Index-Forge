// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NETWORK_UNREACHABLE_MESSAGE } from "../lib/apiContract";

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
    getAdminHeaders: () => ({ "x-admin-session": "admin-token" }),
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

import { AdminDashboard } from "./AdminDashboard";

describe("AdminDashboard network-failure message", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the shared connection message instead of the raw browser error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/admin/passwords")) {
          throw new TypeError("Failed to fetch");
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
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

    expect(await screen.findByText(NETWORK_UNREACHABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });
});
