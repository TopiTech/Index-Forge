// @vitest-environment jsdom
/**
 * Behavioral replacement for the source-string pins in
 * `src/components/portfolioAuthGuard.test.ts` (S6, U-2, deleted alongside
 * this file).
 *
 * The old suite asserted implementation text (`toContain("if
 * (!isAuthenticated)")`, import spellings, CSS class names, Japanese copy),
 * so it failed on refactors without regressions and passed when the gate was
 * wired but never ran. These drive the real page and sidebar instead:
 *
 * - unauthenticated visitors see the lock screen, never holdings;
 * - a rejected password surfaces a `role="alert"` error, never the portfolio;
 * - authenticated visitors see neither gate nor lock badge;
 * - the sidebar marks the portfolio entry as login-required only while logged out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PortfolioManagerPage } from "./PortfolioManagerPage";
import { Sidebar } from "./Sidebar";
import { STORAGE_KEY_PORTFOLIO } from "../lib/portfolioStorage";

const { authState, loginMock } = vi.hoisted(() => ({
  authState: { isAuthenticated: false },
  loginMock: vi.fn(
    async (
      _password: string,
    ): Promise<{ ok: boolean; error?: string; cancelled?: boolean }> => ({ ok: true }),
  ),
}));

// Stable across renders: the page keys effects on these callbacks, so a fresh
// closure per `useAuth()` call would refetch on every render (the real hook
// memoizes them). `vi.hoisted` keeps the reference identical for the file.
const { stableGetHeaders } = vi.hoisted(() => ({
  stableGetHeaders: () => ({} as Record<string, string>),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: authState.isAuthenticated
      ? { id: "user-1", password: "pw", role: "user" }
      : null,
    isAuthenticated: authState.isAuthenticated,
    isAdmin: false,
    isUser: authState.isAuthenticated,
    maxStocks: null,
    maxIndices: null,
    loading: false,
    login: loginMock,
    adminLogin: vi.fn(async () => ({ ok: true as const })),
    logout: vi.fn(),
    getHeaders: stableGetHeaders,
  }),
}));

vi.mock("./Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

function seedPortfolio(): void {
  localStorage.setItem(
    STORAGE_KEY_PORTFOLIO,
    JSON.stringify([
      { id: "p1", ticker: "7203", name: "トヨタ自動車", shares: 10, averageCost: 2800 },
    ]),
  );
}

function stubQuotes(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, stockUniverse: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

function renderPage() {
  return render(<PortfolioManagerPage onNavigate={() => {}} onOpenStockDetail={() => {}} />);
}

function renderSidebar() {
  return render(
    <Sidebar currentView="portfolio" navigateTo={() => {}} isOpen onRequestClose={() => {}} />,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  authState.isAuthenticated = false;
  loginMock.mockReset();
  loginMock.mockResolvedValue({ ok: true });
  stubQuotes();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PortfolioManagerPage authentication gate (behavioral, U-2)", () => {
  it("locks unauthenticated visitors on the gate and never shows holdings", () => {
    seedPortfolio();
    renderPage();

    expect(screen.getByText("ポートフォリオのロック解除")).not.toBeNull();
    expect(screen.getByLabelText(/アクセスパスワード|管理者パスワード/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "ログインして利用開始" })).not.toBeNull();
    // The back control renders in each responsive layout; one is enough.
    expect(
      screen.getAllByRole("button", { name: "ダッシュボードへ戻る" }).length,
    ).toBeGreaterThan(0);
    // Seeded holdings stay hidden behind the gate.
    expect(screen.queryByText(/保有株式一覧/)).toBeNull();
  });

  it("reports a rejected password as an assertive alert without unlocking", async () => {
    loginMock.mockResolvedValueOnce({ ok: false, error: "パスワードが正しくありません" });
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "一般ユーザー" }));
    fireEvent.change(screen.getByLabelText(/アクセスパスワード/), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ログインして利用開始" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("パスワードが正しくありません");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    // Still locked: no holdings leak through the failed attempt.
    expect(screen.queryByText(/保有株式一覧/)).toBeNull();
  });

  it("shows seeded holdings with no gate once authenticated", async () => {
    seedPortfolio();
    authState.isAuthenticated = true;
    renderPage();

    await waitFor(() => expect(screen.queryByText(/保有株式一覧/)).not.toBeNull());
    expect(screen.queryByText("ポートフォリオのロック解除")).toBeNull();
    expect(screen.getByText(/保有株式一覧 \(1銘柄\)/)).not.toBeNull();
  });
});

describe("Sidebar portfolio login badge (behavioral, U-2)", () => {
  it("marks the portfolio entry as login-required while logged out", () => {
    authState.isAuthenticated = false;
    renderSidebar();

    // Both the desktop rail and the mobile drawer badge the locked entry.
    expect(screen.getAllByText("要ログイン").length).toBeGreaterThan(0);
  });

  it("drops the badge once authenticated", () => {
    authState.isAuthenticated = true;
    renderSidebar();

    expect(screen.queryByText("要ログイン")).toBeNull();
  });
});
