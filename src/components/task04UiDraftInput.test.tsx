// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { AddStockModal } from "./AddStockModal";
import type { BasketItem } from "../types";
import type { CustomIndex } from "../data/indices";

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
    isUser: false,
    isAuthenticated: true,
    maxStocks: null,
    maxIndices: null,
    adminLogin: vi.fn(),
    logout: vi.fn(),
    getAdminHeaders: () => ({ "x-admin-session": "admin-token" }),
  }),
}));

vi.mock("../hooks/useSimulation", () => ({
  useSimulation: () => ({}),
}));

vi.mock("./SimulationPreview", () => ({
  SimulationPreview: () => null,
}));

vi.mock("./Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { AdminDashboard } from "./AdminDashboard";
import { IndexBuilderContent } from "./IndexBuilderContent";

const sampleIndex: CustomIndex = {
  id: "idx-sample-1",
  name: "サンプル指数",
  description: "サンプルの説明",
  baseValue: 1000,
  basket: [
    { ticker: "7203", name: "トヨタ自動車", theme: "モビリティ", weight: 50 },
    { ticker: "6758", name: "ソニーグループ", theme: "テクノロジー", weight: 50 },
  ],
};

describe("TASK-04: UI Number Input Draft State Resilience", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, passwords: [], indices: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("AddStockModal weight draft input", () => {
    it("retains empty draft string when backspaced and clamps to 10 on blur", () => {
      render(
        <AddStockModal
          isOpen={true}
          onClose={vi.fn()}
          indexName="テスト指数"
          currentCount={2}
          maxStocks={10}
          onAddStock={vi.fn(async () => ({ ok: true }))}
        />,
      );

      const weightInput = screen.getByLabelText("構成比率 (重み)") as HTMLInputElement;
      expect(weightInput.value).toBe("10");

      // 1. Backspace to clear the input
      fireEvent.change(weightInput, { target: { value: "" } });
      expect(weightInput.value).toBe("");

      // 2. Typing new valid decimal while draft
      fireEvent.change(weightInput, { target: { value: "25.5" } });
      expect(weightInput.value).toBe("25.5");

      // 3. Clear again
      fireEvent.change(weightInput, { target: { value: "" } });
      expect(weightInput.value).toBe("");

      // 4. On blur, empty value clamps safely to default (10)
      fireEvent.blur(weightInput);
      expect(weightInput.value).toBe("10");
    });

    it("clamps out-of-range weights on blur", () => {
      render(
        <AddStockModal
          isOpen={true}
          onClose={vi.fn()}
          indexName="テスト指数"
          currentCount={2}
          maxStocks={10}
          onAddStock={vi.fn(async () => ({ ok: true }))}
        />,
      );

      const weightInput = screen.getByLabelText("構成比率 (重み)") as HTMLInputElement;

      // Below min (0.1)
      fireEvent.change(weightInput, { target: { value: "0.05" } });
      fireEvent.blur(weightInput);
      expect(weightInput.value).toBe("0.1");

      // Above max (100)
      fireEvent.change(weightInput, { target: { value: "150" } });
      fireEvent.blur(weightInput);
      expect(weightInput.value).toBe("100");
    });

    it("commits empty draft to 10 upon form submit", async () => {
      const onAddStockMock = vi.fn(async (_stock: BasketItem) => ({ ok: true }));

      render(
        <AddStockModal
          isOpen={true}
          onClose={vi.fn()}
          indexName="テスト指数"
          currentCount={2}
          maxStocks={10}
          onAddStock={onAddStockMock}
        />,
      );

      const tickerInput = screen.getByLabelText(/銘柄コード/);
      const nameInput = screen.getByLabelText(/銘柄名/);
      const weightInput = screen.getByLabelText("構成比率 (重み)") as HTMLInputElement;

      fireEvent.change(tickerInput, { target: { value: "9984" } });
      fireEvent.change(nameInput, { target: { value: "ソフトバンクG" } });
      fireEvent.change(weightInput, { target: { value: "" } });
      expect(weightInput.value).toBe("");

      const submitButton = screen.getByRole("button", { name: "銘柄を追加" });
      fireEvent.click(submitButton);

      expect(onAddStockMock).toHaveBeenCalledWith({
        ticker: "9984",
        name: "ソフトバンクG",
        theme: "カスタム",
        weight: 10,
      });
    });
  });

  describe("AdminDashboard number draft inputs", () => {
    it("retains empty draft in inline add-weight input and clamps on blur", () => {
      render(
        <AdminDashboard
          indices={[sampleIndex]}
          onBackToApp={vi.fn()}
          onRefreshIndices={vi.fn(async () => {})}
          saveCustomIndex={vi.fn(async () => ({ ok: true }))}
          deleteCustomIndex={vi.fn(async () => ({ ok: true }))}
        />,
      );

      // Switch to indices tab
      const indicesTab = document.querySelector("#admin-tab-indices") as HTMLElement;
      expect(indicesTab).not.toBeNull();
      fireEvent.click(indicesTab);

      const addWeightInput = document.querySelector(".admin-add-weight-input") as HTMLInputElement;
      expect(addWeightInput).not.toBeNull();
      expect(addWeightInput.value).toBe("10");

      fireEvent.change(addWeightInput, { target: { value: "" } });
      expect(addWeightInput.value).toBe("");

      fireEvent.change(addWeightInput, { target: { value: "33.3" } });
      expect(addWeightInput.value).toBe("33.3");

      fireEvent.change(addWeightInput, { target: { value: "" } });
      expect(addWeightInput.value).toBe("");

      fireEvent.blur(addWeightInput);
      expect(addWeightInput.value).toBe("10");
    });

    it("retains empty draft in edit baseValue input and clamps on blur", () => {
      render(
        <AdminDashboard
          indices={[sampleIndex]}
          onBackToApp={vi.fn()}
          onRefreshIndices={vi.fn(async () => {})}
          saveCustomIndex={vi.fn(async () => ({ ok: true }))}
          deleteCustomIndex={vi.fn(async () => ({ ok: true }))}
        />,
      );

      // Switch to indices tab
      const indicesTab = document.querySelector("#admin-tab-indices") as HTMLElement;
      expect(indicesTab).not.toBeNull();
      fireEvent.click(indicesTab);

      const editBaseValueInput = document.querySelector("#admin-edit-base-value") as HTMLInputElement;
      expect(editBaseValueInput).not.toBeNull();
      expect(editBaseValueInput.value).toBe("1000");

      fireEvent.change(editBaseValueInput, { target: { value: "" } });
      expect(editBaseValueInput.value).toBe("");

      fireEvent.change(editBaseValueInput, { target: { value: "500" } });
      expect(editBaseValueInput.value).toBe("500");

      fireEvent.change(editBaseValueInput, { target: { value: "" } });
      expect(editBaseValueInput.value).toBe("");

      fireEvent.blur(editBaseValueInput);
      expect(editBaseValueInput.value).toBe("1000");
    });

    it("retains empty draft in create index modal baseValue input and clamps on blur", () => {
      render(
        <AdminDashboard
          indices={[sampleIndex]}
          onBackToApp={vi.fn()}
          onRefreshIndices={vi.fn(async () => {})}
          saveCustomIndex={vi.fn(async () => ({ ok: true }))}
          deleteCustomIndex={vi.fn(async () => ({ ok: true }))}
        />,
      );

      // Switch to indices tab
      const indicesTab = document.querySelector("#admin-tab-indices") as HTMLElement;
      expect(indicesTab).not.toBeNull();
      fireEvent.click(indicesTab);

      const openCreateModalBtn = screen.getByRole("button", { name: /新規指数作成/ });
      fireEvent.click(openCreateModalBtn);

      const createBaseValInput = document.querySelector("#create-index-base-val") as HTMLInputElement;
      expect(createBaseValInput).not.toBeNull();
      expect(createBaseValInput.value).toBe("1000");

      fireEvent.change(createBaseValInput, { target: { value: "" } });
      expect(createBaseValInput.value).toBe("");

      fireEvent.blur(createBaseValInput);
      expect(createBaseValInput.value).toBe("1000");
    });
  });

  describe("IndexBuilderContent baseValue draft input", () => {
    it("retains empty draft in builder-base-input and clamps on blur", () => {
      render(<IndexBuilderContent onSave={vi.fn(async () => ({ ok: true }))} />);

      const builderBaseInput = document.querySelector("#builder-base-input") as HTMLInputElement;
      expect(builderBaseInput).not.toBeNull();
      expect(builderBaseInput.value).toBe("1000");

      // 1. Backspace to clear the input
      fireEvent.change(builderBaseInput, { target: { value: "" } });
      expect(builderBaseInput.value).toBe("");

      // 2. Typing new value
      fireEvent.change(builderBaseInput, { target: { value: "2500" } });
      expect(builderBaseInput.value).toBe("2500");

      // 3. Clear again
      fireEvent.change(builderBaseInput, { target: { value: "" } });
      expect(builderBaseInput.value).toBe("");

      // 4. On blur, empty value clamps safely to 1000
      fireEvent.blur(builderBaseInput);
      expect(builderBaseInput.value).toBe("1000");
    });
  });
});
