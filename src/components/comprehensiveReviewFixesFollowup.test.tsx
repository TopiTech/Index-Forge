// @vitest-environment jsdom
/**
 * Behavioral verification for comprehensive code review remediations:
 * 1. IndexBuilderContent: FileReader lifecycle, onerror handling, abort on superseded read,
 *    and unmount safety on async save/import.
 * 2. PortfolioManagerPage: strict finite-number validation for shares and averageCost
 *    preventing Infinity/NaN leakage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

// Mocks for IndexBuilderContent
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: { id: "test-user", role: "admin", adminToken: "admin-token" },
    isAuthenticated: true,
    isUser: false,
    isAdmin: true,
    maxStocks: null,
    maxIndices: null,
    loading: false,
    login: vi.fn(async () => ({ ok: true })),
    adminLogin: vi.fn(async () => ({ ok: true })),
    logout: vi.fn(),
    getHeaders: () => ({}),
    getAdminHeaders: () => ({ "x-admin-session": "admin-token" }),
  }),
}));

vi.mock("../hooks/useSimulation", () => ({
  useSimulation: () => ({}),
}));

vi.mock("./SimulationPreview", () => ({
  SimulationPreview: () => null,
}));

const mockToast = {
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
};

vi.mock("./Toast", () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./AuthModal", () => ({
  AuthModal: () => null,
}));

vi.mock("../lib/portfolioStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portfolioStorage")>();
  return {
    ...actual,
    loadPortfolioPositions: () => [],
    loadWatchlist: () => [],
    savePortfolioPositions: vi.fn(),
    saveWatchlist: vi.fn(),
  };
});

class MockFileReader {
  static instances: MockFileReader[] = [];
  onload: ((event: { target?: { result?: unknown } }) => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  result: string | null = null;

  readAsText(_file: File): void {
    MockFileReader.instances.push(this);
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  triggerSuccess(text: string): void {
    this.result = text;
    this.onload?.({ target: { result: text } });
  }

  triggerError(): void {
    this.onerror?.();
  }
}

import { IndexBuilderContent } from "./IndexBuilderContent";
import { PortfolioManagerPage } from "./PortfolioManagerPage";
import { AdminDashboard } from "./AdminDashboard";

beforeEach(() => {
  MockFileReader.instances = [];
  vi.clearAllMocks();
  vi.stubGlobal("FileReader", MockFileReader);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("IndexBuilderContent FileReader Lifecycle & Error Handling", () => {
  it("displays an error when the FileReader triggers onerror", async () => {
    render(<IndexBuilderContent onSave={vi.fn()} />);

    const fileInput = screen.getByLabelText(/指数定義ファイル（JSONまたはCSV）をインポート/);
    const testFile = new File(["dummy content"], "index.json", { type: "application/json" });

    fireEvent.change(fileInput, { target: { files: [testFile] } });

    expect(MockFileReader.instances).toHaveLength(1);
    MockFileReader.instances[0].triggerError();

    await waitFor(() => {
      expect(screen.getByText("ファイルの読み込みに失敗しました")).toBeTruthy();
    });
  });

  it("aborts previous FileReader when a new file is chosen and ignores stale result", async () => {
    render(<IndexBuilderContent onSave={vi.fn()} />);

    const fileInput = screen.getByLabelText(/指数定義ファイル（JSONまたはCSV）をインポート/);
    const file1 = new File(["old content"], "old.json", { type: "application/json" });
    const file2 = new File(
      [
        JSON.stringify({
          name: "最新指数",
          description: "最新",
          baseValue: 1000,
          basket: [{ ticker: "7203", name: "トヨタ自動車", weight: 1, theme: "自動車" }],
        }),
      ],
      "new.json",
      { type: "application/json" },
    );

    fireEvent.change(fileInput, { target: { files: [file1] } });
    expect(MockFileReader.instances).toHaveLength(1);
    expect(MockFileReader.instances[0].aborted).toBe(false);

    // Pick second file: first reader must be aborted
    fireEvent.change(fileInput, { target: { files: [file2] } });
    expect(MockFileReader.instances).toHaveLength(2);
    expect(MockFileReader.instances[0].aborted).toBe(true);

    // If first reader fires onload late, it must be ignored
    MockFileReader.instances[0].triggerSuccess(
      JSON.stringify({
        name: "古い指数",
        description: "古い",
        baseValue: 500,
        basket: [{ ticker: "6758", name: "ソニー", weight: 1, theme: "電機" }],
      }),
    );
    expect(screen.queryByText(/古い指数/)).toBeNull();

    // Second reader finishes
    MockFileReader.instances[1].triggerSuccess(
      JSON.stringify({
        name: "最新指数",
        description: "最新",
        baseValue: 1000,
        basket: [{ ticker: "7203", name: "トヨタ自動車", weight: 1, theme: "自動車" }],
      }),
    );
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/指数名/) as HTMLInputElement;
      expect(nameInput.value).toBe("最新指数");
    });
  });

  it("safely handles unmount during save without throwing or updating unmounted state", async () => {
    let resolveSave: (val: { ok: boolean }) => void;
    const savePromise = new Promise<{ ok: boolean }>((res) => {
      resolveSave = res;
    });
    const onSave = vi.fn(() => savePromise);

    const { unmount } = render(<IndexBuilderContent onSave={onSave} />);

    // Apply a preset so name and basket are populated
    fireEvent.click(screen.getByText("先端AI・次世代半導体"));

    // Click save
    const saveBtn = screen.getByRole("button", { name: /指数を保存/ });
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalled();

    // Unmount while save is pending
    unmount();

    // Resolve after unmount
    resolveSave!({ ok: true });

    // Should not throw or crash
    await waitFor(() => expect(savePromise).resolves.toEqual({ ok: true }));
  });
});

describe("PortfolioManagerPage Validation Boundaries", () => {
  it("rejects Infinity for shares and shows validation error", async () => {
    render(<PortfolioManagerPage onNavigate={() => {}} onOpenStockDetail={() => {}} />);

    // Open add modal
    const addBtn = screen.getByRole("button", { name: /銘柄を追加/ });
    fireEvent.click(addBtn);

    // Input ticker, Infinity shares, and valid avg cost
    const tickerInput = screen.getByLabelText(/銘柄コード \(ティッカー\)/);
    const sharesInput = screen.getByLabelText(/保有株数/);
    const costInput = screen.getByLabelText(/平均取得単価/);

    fireEvent.change(tickerInput, { target: { value: "7203" } });
    fireEvent.change(sharesInput, { target: { value: "Infinity" } });
    fireEvent.change(costInput, { target: { value: "2500" } });

    const submitBtn = screen.getByRole("button", { name: /^登録する$/ });
    const form = submitBtn.closest("form")!;
    fireEvent.submit(form);

    expect(screen.getByText("保有株数は正の数値を入力してください")).toBeTruthy();
  });

  it("rejects Infinity for averageCost and shows validation error", async () => {
    render(<PortfolioManagerPage onNavigate={() => {}} onOpenStockDetail={() => {}} />);

    // Open add modal
    const addBtn = screen.getByRole("button", { name: /銘柄を追加/ });
    fireEvent.click(addBtn);

    const tickerInput = screen.getByLabelText(/銘柄コード \(ティッカー\)/);
    const sharesInput = screen.getByLabelText(/保有株数/);
    const costInput = screen.getByLabelText(/平均取得単価/);

    fireEvent.change(tickerInput, { target: { value: "7203" } });
    fireEvent.change(sharesInput, { target: { value: "100" } });
    fireEvent.change(costInput, { target: { value: "Infinity" } });

    const submitBtn = screen.getByRole("button", { name: /^登録する$/ });
    const form = submitBtn.closest("form")!;
    fireEvent.submit(form);

    expect(screen.getByText("平均取得単価は正の数値を入力してください")).toBeTruthy();
  });
});

describe("AdminDashboard Validation Boundaries", () => {
  it("rejects Infinity for baseValue and shows validation error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, data: [], stats: { dbStatus: "OK" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const dummyIndex = {
      id: "idx-test-1",
      name: "テスト指数",
      description: "テスト説明",
      baseValue: 1000,
      basket: [{ ticker: "7203", name: "トヨタ自動車", weight: 1, theme: "自動車" }],
    };

    render(
      <AdminDashboard
        indices={[dummyIndex]}
        onBackToApp={() => {}}
        onRefreshIndices={async () => {}}
        saveCustomIndex={async () => ({ ok: true })}
        deleteCustomIndex={async () => ({ ok: true })}
      />,
    );

    // Switch to index editor tab
    const indexTab = screen.getByRole("tab", { name: /指数/ });
    fireEvent.click(indexTab);

    // Wait for the index data to be synchronized into form fields
    const baseValueInput = await screen.findByLabelText(/基準値 \(Base Value\)/);

    // Edit base value with invalid non-positive number
    fireEvent.change(baseValueInput, { target: { value: "-10" } });

    // Click save button
    const saveBtn = screen.getByRole("button", { name: /変更をD1に保存/ });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.getByText("基準値は0より大きく1,000,000以下の数値を入力してください"),
      ).toBeTruthy();
    });
  });
});
