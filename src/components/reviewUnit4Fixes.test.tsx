// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomIndex } from "../data/indices";
import type { BasketItem, StockDetail } from "../types";
import { FreshnessProvider } from "../contexts/FreshnessContext";
import { ConstituentsTable } from "./ConstituentsTable";
import { PortfolioManagerPage } from "./PortfolioManagerPage";
import { ToastProvider } from "./Toast";

const { authState } = vi.hoisted(() => ({
  authState: {
    isAuthenticated: true,
    isAdmin: true,
  },
}));

const getHeadersMock = () => ({ "x-admin-session": "admin-token" });

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: authState.isAdmin
      ? { id: "admin-master", name: "管理者", role: "admin", password: "", adminToken: "admin-token" }
      : { id: "user-1", name: "ユーザー", role: "user", password: "pw" },
    isAdmin: authState.isAdmin,
    isUser: !authState.isAdmin && authState.isAuthenticated,
    isAuthenticated: authState.isAuthenticated,
    maxStocks: null,
    maxIndices: null,
    loading: false,
    login: vi.fn(async () => ({ ok: true })),
    adminLogin: vi.fn(async () => ({ ok: true })),
    logout: vi.fn(),
    getHeaders: getHeadersMock,
    getAdminHeaders: getHeadersMock,
  }),
}));

vi.mock("../hooks/useSimulation", () => ({
  useSimulation: () => ({}),
}));

vi.mock("./SimulationPreview", () => ({
  SimulationPreview: () => null,
}));

import { AdminDashboard } from "./AdminDashboard";

const sampleIndex: CustomIndex = {
  id: "idx-unit4-1",
  name: "検証指数",
  description: "説明",
  baseValue: 1000,
  basket: [
    { ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 50 },
    { ticker: "6758", name: "ソニーグループ", theme: "電機", weight: 50 },
  ],
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  authState.isAdmin = true;
  authState.isAuthenticated = true;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) =>
      new Response(JSON.stringify(String(input).includes("/api/admin/passwords") ? [] : { ok: true, indices: [sampleIndex], stockUniverse: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BUG-06: AdminDashboard basket weight draft input & alert roles", () => {
  it("allows clearing and re-typing basket item weights without immediate 0.1 reset, clamps on blur, and syncs equalize button", () => {
    render(
      <ToastProvider>
        <AdminDashboard
          indices={[sampleIndex]}
          onBackToApp={vi.fn()}
          onRefreshIndices={vi.fn(async () => {})}
          saveCustomIndex={vi.fn(async () => ({ ok: true }))}
          deleteCustomIndex={vi.fn(async () => ({ ok: true }))}
        />
      </ToastProvider>,
    );

    const indicesTab = document.querySelector("#admin-tab-indices") as HTMLElement;
    fireEvent.click(indicesTab);

    const toyotaWeight = screen.getByLabelText("トヨタ自動車 (7203) の比率 (%)") as HTMLInputElement;
    expect(toyotaWeight.value).toBe("50");

    fireEvent.focus(toyotaWeight);
    fireEvent.change(toyotaWeight, { target: { value: "" } });
    expect(toyotaWeight.value).toBe("");

    fireEvent.change(toyotaWeight, { target: { value: "150" } });
    fireEvent.blur(toyotaWeight);
    expect(toyotaWeight.value).toBe("100");

    fireEvent.click(screen.getByRole("button", { name: /均等配分/ }));
    expect(toyotaWeight.value).toBe("50");
  });

  it("exposes role='alert' on inline validation/fetch errors and resolves queued fetchPasswords after refetch completes", async () => {
    let callCount = 0;
    let resolveFirst!: (res: Response) => void;
    const firstFetchPromise = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/admin/passwords") && (!init?.method || init.method === "GET")) {
          callCount += 1;
          if (callCount === 1) return firstFetchPromise;
          return new Response(
            JSON.stringify([
              {
                id: "pw-new",
                name: "新規アカウント",
                role: "user",
                max_stocks: 10,
                max_indices: 5,
                is_active: 1,
                created_at: 1700000000,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/api/admin/passwords") && init?.method === "POST") {
          return new Response(JSON.stringify({ ok: true, id: "pw-new" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    render(
      <ToastProvider>
        <AdminDashboard
          indices={[sampleIndex]}
          onBackToApp={vi.fn()}
          onRefreshIndices={vi.fn(async () => {})}
          saveCustomIndex={vi.fn(async () => ({ ok: true }))}
          deleteCustomIndex={vi.fn(async () => ({ ok: true }))}
        />
      </ToastProvider>,
    );

    // While initial GET is pending, trigger POST which awaits queued fetchPasswords()
    const nameInput = screen.getByLabelText(/ユーザー名/);
    fireEvent.change(nameInput, { target: { value: "テストユーザー" } });
    fireEvent.submit(nameInput.closest("form") as HTMLFormElement);

    // Resolve first stale GET with empty list
    resolveFirst(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    // Must await queued second GET and display the newly created row
    expect(await screen.findByText("新規アカウント")).toBeTruthy();
    expect(callCount).toBe(2);

    // Validation error on short password update uses role="alert"
    fireEvent.click(screen.getByRole("tab", { name: /管理者設定/ }));
    const currentAdminPwdInput = screen.getByLabelText("現在の管理者パスワード (確認用)");
    fireEvent.submit(currentAdminPwdInput.closest("form") as HTMLFormElement);
    const pwdError = await screen.findByText(/パスワードは8〜100文字で入力してください/);
    expect(pwdError.closest('[role="alert"]')).not.toBeNull();
  });
});

describe("BUG-07: PortfolioManagerPage ticker name resolution, empty CSV feedback, and a11y", () => {
  beforeEach(() => {
    authState.isAdmin = false;
    authState.isAuthenticated = true;
  });

  it("clears stale default company name/cost when typing an unknown ticker and preserves custom user input", async () => {
    render(
      <ToastProvider>
        <FreshnessProvider>
          <PortfolioManagerPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
        </FreshnessProvider>
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /保有銘柄を追加/ }));

    const tickerInput = screen.getByLabelText(/銘柄コード/) as HTMLInputElement;
    const nameInput = screen.getByLabelText(/銘柄名/) as HTMLInputElement;
    const costInput = screen.getByLabelText(/平均取得単価/) as HTMLInputElement;

    expect(tickerInput.value).toBe("7203");
    expect(nameInput.value).toBe("トヨタ自動車");

    // Typing an unknown ticker must clear stale トヨタ自動車 and 2500 cost
    fireEvent.change(tickerInput, { target: { value: "ZZZZZ" } });
    expect(nameInput.value).toBe("");
    expect(costInput.value).toBe("");

    // Typing a universe stock (1301 = 極洋) resolves from stockUniverse
    fireEvent.change(tickerInput, { target: { value: "1301" } });
    expect(nameInput.value).toContain("極洋");

    // Manual name edits must not be clobbered when ticker changes
    fireEvent.change(nameInput, { target: { value: "手入力銘柄名" } });
    fireEvent.change(tickerInput, { target: { value: "AAPL" } });
    expect(nameInput.value).toBe("手入力銘柄名");

    // Submitting 0 shares shows an accessible role="alert" banner
    fireEvent.change(screen.getByLabelText("保有株数"), { target: { value: "-5" } });
    fireEvent.submit(tickerInput.closest("form") as HTMLFormElement);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("保有株数は正の数値を入力してください");
  });

  it("shows feedback toast when an empty CSV file is uploaded", async () => {
    render(
      <ToastProvider>
        <FreshnessProvider>
          <PortfolioManagerPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
        </FreshnessProvider>
      </ToastProvider>,
    );

    const fileInput = screen.getByLabelText("ポートフォリオCSVファイルをアップロード");
    const emptyFile = new File([""], "empty.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [emptyFile] } });

    await waitFor(() => {
      expect(screen.getByText("有効な保有銘柄データが見つかりませんでした")).toBeTruthy();
    });
  });

  it("renders accessible labels on desktop delete buttons and avoids clickable div wrapping buttons in Watchlist", async () => {
    render(
      <ToastProvider>
        <FreshnessProvider>
          <PortfolioManagerPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
        </FreshnessProvider>
      </ToastProvider>,
    );

    // Desktop table delete button has accessible aria-label
    const deleteBtns = screen.getAllByRole("button", { name: /保有銘柄「.*」を削除/ });
    expect(deleteBtns.length).toBeGreaterThanOrEqual(2);

    // Holdings/Watchlist buttons expose aria-pressed
    const holdingsBtn = screen.getByRole("button", { name: /保有株式一覧/ });
    const watchlistBtn = screen.getByRole("button", { name: /監視中ウォッチリスト/ });
    expect(holdingsBtn.getAttribute("aria-pressed")).toBe("true");
    expect(watchlistBtn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(watchlistBtn);
    expect(watchlistBtn.getAttribute("aria-pressed")).toBe("true");

    // Watchlist cards are <article> elements without nested clickable wrappers
    const watchDetailBtn = await screen.findByRole("button", { name: /\(NVDA\) の詳細を見る/ });
    const card = watchDetailBtn.closest("article");
    expect(card).not.toBeNull();
  });
});

describe("BUG-09: ConstituentsTable renders clean <tr> children directly inside <tbody>", () => {
  it("renders valid table rows without extra AnimatePresence popout wrappers", () => {
    const basket: BasketItem[] = [
      { ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 100 },
    ];
    const details: StockDetail[] = [
      {
        ticker: "7203",
        name: "トヨタ自動車",
        theme: "自動車",
        weight: 100,
        currentPrice: 2850,
        previousPrice: 2800,
        change: 50,
        changePct: 1.79,
        contributionPt: 1.79,
        contributionPct: 1.79,
        sparkline: [2800, 2850],
      },
    ];

    const { container } = render(
      <ToastProvider>
        <ConstituentsTable basket={basket} stockDetails={details} selectedTheme={null} />
      </ToastProvider>,
    );

    const tbody = container.querySelector("tbody");
    expect(tbody).not.toBeNull();
    const directChildren = Array.from(tbody?.children ?? []);
    expect(directChildren.length).toBe(1);
    expect(directChildren[0].tagName).toBe("TR");
  });
});
