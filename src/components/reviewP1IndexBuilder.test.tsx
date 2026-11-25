// @vitest-environment jsdom
/**
 * UI-1 P1-04: strategy presets must obey the same per-password stock quota as
 * manual adds / saves. The test observes the rendered basket and error alert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mockToast = { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() };

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: { id: "u1", role: "user", adminToken: null },
    isAuthenticated: true,
    isUser: true,
    isAdmin: false,
    maxStocks: 3,
    maxIndices: null,
    loading: false,
    login: vi.fn(async () => ({ ok: true })),
    adminLogin: vi.fn(async () => ({ ok: true })),
    logout: vi.fn(),
    getHeaders: () => ({}),
    getAdminHeaders: () => ({}),
  }),
}));
vi.mock("../hooks/useSimulation", () => ({ useSimulation: () => ({}) }));
vi.mock("./SimulationPreview", () => ({ SimulationPreview: () => null }));
vi.mock("./Toast", () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./AuthModal", () => ({ AuthModal: () => null }));

import { IndexBuilderContent } from "./IndexBuilderContent";

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("IndexBuilderContent preset quota (P1-04)", () => {
  it("rejects a four-stock preset when the account allows three stocks", () => {
    render(<IndexBuilderContent onSave={vi.fn()} />);

    const presetButton = screen.getByRole("button", {
      name: /戦略プリセット「先端AI・次世代半導体」を適用/,
    });
    fireEvent.click(presetButton);

    expect(screen.getByRole("alert").textContent).toMatch(/最大3銘柄/);
    const nameInput = screen.getByLabelText("指数名 *") as HTMLInputElement;
    expect(nameInput.value).toBe("");
    // The seeded basket is unchanged: none of the preset's extra stocks
    // (e.g. さくらインターネット) was loaded.
    expect(screen.queryByLabelText("さくらインターネットを削除")).toBeNull();
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it("still applies a preset that fits in the quota", () => {
    render(<IndexBuilderContent onSave={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: /戦略プリセット「グローバルIP・エンタメ」を適用/ }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByLabelText("指数名 *") as HTMLInputElement).value).toBe(
      "グローバルIP・エンタメ",
    );
    expect(screen.getByLabelText("任天堂を削除")).toBeTruthy();
  });

  it("validates uncommitted baseValueDraft on dashboard preview instead of silently using stale baseValue", () => {
    const onPreviewInDashboard = vi.fn();
    render(<IndexBuilderContent onSave={vi.fn()} onPreviewInDashboard={onPreviewInDashboard} />);

    fireEvent.click(
      screen.getByRole("button", { name: /戦略プリセット「グローバルIP・エンタメ」を適用/ }),
    );
    const baseInput = document.getElementById("builder-base-input") as HTMLInputElement;
    fireEvent.change(baseInput, { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: /ダッシュボードで一時プレビュー/ }));
    expect(onPreviewInDashboard).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/1〜1,000,000/);

    fireEvent.change(baseInput, { target: { value: "2500" } });
    fireEvent.click(screen.getByRole("button", { name: /ダッシュボードで一時プレビュー/ }));
    expect(onPreviewInDashboard).toHaveBeenCalledTimes(1);
    expect(onPreviewInDashboard.mock.calls[0]?.[0]?.baseValue).toBe(2500);
  });
});
