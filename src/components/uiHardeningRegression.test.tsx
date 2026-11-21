// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomIndex } from "../data/indices";

const {
  authState,
  getTurnstileConfigMock,
  fetchUpcomingEventsMock,
  toastMocks,
  stableGetHeaders,
} = vi.hoisted(() => ({
  authState: {
    isAuthenticated: false,
    isAdmin: false,
    isUser: false,
  },
  getTurnstileConfigMock: vi.fn(async () => ({
    siteKey: "1x00000000000000000000AA",
    unavailable: false,
    lockout: undefined as
      | { locked: boolean; remainingSeconds: number; remainingAttempts: number }
      | undefined,
  })),
  fetchUpcomingEventsMock: vi.fn(),
  toastMocks: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
  stableGetHeaders: () => ({ "x-admin-session": "admin-token" }) as Record<string, string>,
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: authState.isAuthenticated
      ? {
          id: authState.isAdmin ? "admin-master" : "user-1",
          name: authState.isAdmin ? "管理者" : "一般ユーザー",
          role: authState.isAdmin ? "admin" : "user",
          password: "",
          adminToken: authState.isAdmin ? "admin-token" : undefined,
        }
      : null,
    isAuthenticated: authState.isAuthenticated,
    isAdmin: authState.isAdmin,
    isUser: authState.isUser,
    maxStocks: null,
    maxIndices: null,
    loading: false,
    login: vi.fn(async () => ({ ok: true as const })),
    adminLogin: vi.fn(async () => ({ ok: true as const })),
    logout: vi.fn(),
    getHeaders: stableGetHeaders,
    getAdminHeaders: stableGetHeaders,
  }),
}));

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    getTurnstileConfig: getTurnstileConfigMock,
  };
});

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  fetchUpcomingEventsMock.mockImplementation(actual.fetchUpcomingEvents);
  return {
    ...actual,
    fetchUpcomingEvents: fetchUpcomingEventsMock,
  };
});

vi.mock("./Toast", () => ({
  useToast: () => toastMocks,
}));

vi.mock("./SimulationPreview", () => ({
  SimulationPreview: () => null,
}));

vi.mock("./TurnstileWidget", async () => {
  const React = await import("react");
  const TurnstileWidget = React.forwardRef(
    (props: { siteKey: string; onVerify?: (t: string) => void }, ref) => {
      React.useImperativeHandle(ref, () => ({ reset: vi.fn() }));
      return React.createElement("div", {
        "data-testid": "mock-turnstile",
        "data-sitekey": props.siteKey,
      });
    },
  );
  return { TurnstileWidget };
});

import { formatTechnicalTooltipValue } from "./StockTechnicalChart";
import { CalendarPage } from "./CalendarPage";
import { PortfolioManagerPage } from "./PortfolioManagerPage";
import { AdminDashboard } from "./AdminDashboard";

describe("UI hardening regressions", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authState.isAuthenticated = false;
    authState.isAdmin = false;
    authState.isUser = false;
    getTurnstileConfigMock.mockReset();
    getTurnstileConfigMock.mockResolvedValue({
      siteKey: "1x00000000000000000000AA",
      unavailable: false,
      lockout: undefined,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, stockUniverse: [] }), {
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

  it("formats FX 4-decimal precision and propagates market hint in formatTechnicalTooltipValue", () => {
    expect(formatTechnicalTooltipValue(1.0845, "close", "EURUSD=X", "FX")).toEqual([
      "$1.0845",
      "終値",
    ]);
    expect(formatTechnicalTooltipValue(1.0812, "sma25", "EURUSD=X", null)).toEqual([
      "$1.0812",
      "SMA 25日",
    ]);
    expect(formatTechnicalTooltipValue(250, "close", "AMBIG", "TSE")).toEqual([
      "¥250",
      "終値",
    ]);
    expect(formatTechnicalTooltipValue(250, "close", "AMBIG", "US")).toEqual([
      "$250.00",
      "終値",
    ]);
  });

  it("handles fetchUpcomingEvents rejection in CalendarPage without unhandled rejection and shows retry alert", async () => {
    fetchUpcomingEventsMock.mockRejectedValueOnce(new Error("カレンダー通信失敗"));

    render(<CalendarPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("カレンダー通信失敗");

    fetchUpcomingEventsMock.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("PortfolioManagerPage auth gate hardening", () => {
    it("fails closed when Turnstile config is unavailable instead of rendering the test widget", async () => {
      getTurnstileConfigMock.mockResolvedValueOnce({
        siteKey: "",
        unavailable: true,
        lockout: undefined,
      });

      render(<PortfolioManagerPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/ロボット確認を利用できません/)).toBeTruthy();
      });
      expect(screen.queryByTestId("mock-turnstile")).toBeNull();

      const submitBtn = screen
        .getAllByRole("button", { name: /ログインして利用開始/ })
        .find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);
    });

    it("scopes admin lockout to administrator tab while leaving general-user tab unlocked", async () => {
      getTurnstileConfigMock.mockResolvedValueOnce({
        siteKey: "1x00000000000000000000AA",
        unavailable: false,
        lockout: { locked: true, remainingSeconds: 300, remainingAttempts: 0 },
      });

      render(<PortfolioManagerPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/セキュリティロック発動中/)).toBeTruthy();
      });
      const adminInput = document.getElementById("portfolio-auth-input") as HTMLInputElement;
      expect(adminInput.disabled).toBe(true);

      // Switch to general user tab: general users must remain unlocked
      fireEvent.click(screen.getByRole("tab", { name: /一般ユーザー/ }));
      expect(screen.queryByText(/セキュリティロック発動中/)).toBeNull();
      expect((document.getElementById("portfolio-auth-input") as HTMLInputElement).disabled).toBe(
        false,
      );

      fireEvent.change(document.getElementById("portfolio-auth-input") as HTMLInputElement, {
        target: { value: "user-pass-123" },
      });
      const submitBtn = screen
        .getAllByRole("button", { name: /ログインして利用開始/ })
        .find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(false);
    });

    it("normalizes ticker case/width before auto-filling reference price in Add Position modal", async () => {
      authState.isAuthenticated = true;
      authState.isUser = true;

      render(<PortfolioManagerPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />);

      fireEvent.click(await screen.findByRole("button", { name: /保有銘柄を追加/ }));
      const tickerInput = screen.getByLabelText(/銘柄コード/i) as HTMLInputElement;
      fireEvent.change(tickerInput, { target: { value: " ａａｐｌ " } });
      fireEvent.change(screen.getByLabelText(/平均取得単価/i), { target: { value: "" } });

      fireEvent.click(screen.getByRole("button", { name: "現在参考価格を自動入力" }));
      const avgInput = screen.getByLabelText(/平均取得単価/i) as HTMLInputElement;
      expect(Number(avgInput.value)).toBeGreaterThan(0);
    });
  });

  describe("AdminDashboard Turnstile, draft inputs, and async state safety", () => {
    it("fails closed on AdminDashboard login when Turnstile config is unavailable", async () => {
      authState.isAuthenticated = false;
      authState.isAdmin = false;
      getTurnstileConfigMock.mockResolvedValueOnce({
        siteKey: "",
        unavailable: true,
        lockout: undefined,
      });

      render(
        <AdminDashboard
          indices={[]}
          onBackToApp={vi.fn()}
          onRefreshIndices={vi.fn(async () => {})}
          saveCustomIndex={vi.fn(async () => ({ ok: true }))}
          deleteCustomIndex={vi.fn(async () => ({ ok: true }))}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText(/ロボット確認を利用できません/)).toBeTruthy();
      });
      expect(screen.queryByTestId("mock-turnstile")).toBeNull();
      const loginBtn = screen.getByRole("button", { name: /管理者としてログイン/ }) as HTMLButtonElement;
      expect(loginBtn.disabled).toBe(true);
    });

    it("retains empty draft for max-stocks and max-indices inputs, clamps on blur, and snapshots password creation state", async () => {
      authState.isAuthenticated = true;
      authState.isAdmin = true;

      let resolveCreate!: (res: Response) => void;
      const createPromise = new Promise<Response>((res) => {
        resolveCreate = res;
      });

      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes("/api/admin/passwords") && init?.method === "POST") {
            return createPromise;
          }
          if (url.includes("/api/admin/passwords")) {
            return new Response(JSON.stringify([]), {
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
        <AdminDashboard
          indices={[]}
          onBackToApp={vi.fn()}
          onRefreshIndices={vi.fn(async () => {})}
          saveCustomIndex={vi.fn(async () => ({ ok: true }))}
          deleteCustomIndex={vi.fn(async () => ({ ok: true }))}
        />,
      );

      const maxStocksInput = document.getElementById("new-user-max-stocks") as HTMLInputElement;
      const maxIndicesInput = document.getElementById("new-user-max-indices") as HTMLInputElement;

      fireEvent.focus(maxStocksInput);
      fireEvent.change(maxStocksInput, { target: { value: "" } });
      expect(maxStocksInput.value).toBe("");
      fireEvent.blur(maxStocksInput);
      expect(maxStocksInput.value).toBe("1");

      fireEvent.focus(maxIndicesInput);
      fireEvent.change(maxIndicesInput, { target: { value: "" } });
      expect(maxIndicesInput.value).toBe("");
      fireEvent.blur(maxIndicesInput);
      expect(maxIndicesInput.value).toBe("1");

      // Submit password creation and verify inputs lock with snapshotted issued credentials
      const nameInput = document.getElementById("new-user-name") as HTMLInputElement;
      const pwdInput = document.getElementById("new-user-password") as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: "スナップショット太郎" } });
      fireEvent.change(pwdInput, { target: { value: "SnapShotPass2026!" } });

      fireEvent.click(screen.getByRole("button", { name: "ユーザーパスワードを発行" }));
      expect(nameInput.disabled).toBe(true);
      expect(pwdInput.disabled).toBe(true);

      await act(async () => {
        resolveCreate(
          new Response(JSON.stringify({ ok: true }), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/SnapShotPass2026!/)).toBeTruthy();
      });
    });

    it("preserves newly created index selection while awaiting parent indices refresh", async () => {
      authState.isAuthenticated = true;
      authState.isAdmin = true;

      const initialIndex: CustomIndex = {
        id: "idx-initial",
        name: "初期指数",
        description: "desc",
        baseValue: 1000,
        basket: [{ ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 100 }],
      };

      let refreshIndicesList: CustomIndex[] = [initialIndex];
      const saveCustomIndex = vi.fn(async (idx: CustomIndex) => {
        refreshIndicesList = [initialIndex, idx];
        return { ok: true };
      });
      const onRefreshIndices = vi.fn(async () => {});

      const { rerender } = render(
        <AdminDashboard
          indices={[initialIndex]}
          onBackToApp={vi.fn()}
          onRefreshIndices={onRefreshIndices}
          saveCustomIndex={saveCustomIndex}
          deleteCustomIndex={vi.fn(async () => ({ ok: true }))}
        />,
      );

      fireEvent.click(document.getElementById("admin-tab-indices") as HTMLElement);
      fireEvent.click(screen.getByRole("button", { name: /新規指数作成/ }));

      fireEvent.change(document.getElementById("create-index-name") as HTMLInputElement, {
        target: { value: "作成後の指数" },
      });
      fireEvent.submit(
        (document.getElementById("create-index-name") as HTMLInputElement).closest("form")!,
      );

      await waitFor(() => {
        expect(saveCustomIndex).toHaveBeenCalledTimes(1);
      });

      const createdIndex = saveCustomIndex.mock.calls[0][0] as CustomIndex;
      rerender(
        <AdminDashboard
          indices={refreshIndicesList}
          onBackToApp={vi.fn()}
          onRefreshIndices={onRefreshIndices}
          saveCustomIndex={saveCustomIndex}
          deleteCustomIndex={vi.fn(async () => ({ ok: true }))}
        />,
      );

      const selector = document.getElementById("admin-select-edit-index") as HTMLSelectElement;
      expect(selector.value).toBe(createdIndex.id);
    });
  });
});
