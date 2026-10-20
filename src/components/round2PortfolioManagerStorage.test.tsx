// @vitest-environment jsdom
/**
 * Behavioural regression tests for the portfolio page: the cross-tab sync
 * (`storage` event) and the authentication transition.
 *
 * Round-2 remediation ledger, TEST-03 → R18 and R12:
 *
 *  - R18: the page re-serialized its whole in-memory array on every change
 *    and did not listen for the `storage` event, so a second tab's holdings
 *    were silently deleted when the first tab wrote its stale array. The
 *    page now subscribes to the event and reloads the persisted lists.
 *
 *  - R12: the auth transition mutated a ref and called `setState` during
 *    render. A discarded render left the "already handled" flag flipped while
 *    the queued state update was never committed, so the portfolio stayed
 *    empty with no error shown anywhere. The transition now lives in an
 *    effect keyed on `isAuthenticated` and must run exactly once per auth
 *    change.
 *
 * The tests render the real page and drive it through the browser APIs
 * (`StorageEvent`, the add-position form, a mocked `useAuth`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const { authState, loadCalls } = vi.hoisted(() => ({
  authState: { isAuthenticated: true },
  loadCalls: { portfolio: 0, watchlist: 0 },
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: authState.isAuthenticated ? { id: "user-1", password: "pw", role: "user" } : null,
    isAuthenticated: authState.isAuthenticated,
    isAdmin: false,
    isUser: authState.isAuthenticated,
    maxStocks: null,
    maxIndices: null,
    loading: false,
    login: vi.fn(async () => ({ ok: true })),
    adminLogin: vi.fn(async () => ({ ok: true })),
    logout: vi.fn(),
    getHeaders: () => ({}),
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

/**
 * The storage module is wrapped so the test can count how often the page
 * reads the persisted lists. The auth transition has to apply the persisted
 * state exactly once per auth change, and the counter is the only way to
 * observe "exactly once" from the outside.
 */
vi.mock("../lib/portfolioStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portfolioStorage")>();
  return {
    ...actual,
    loadPortfolioPositions: (...args: Parameters<typeof actual.loadPortfolioPositions>) => {
      loadCalls.portfolio += 1;
      return actual.loadPortfolioPositions(...args);
    },
    loadWatchlist: (...args: Parameters<typeof actual.loadWatchlist>) => {
      loadCalls.watchlist += 1;
      return actual.loadWatchlist(...args);
    },
  };
});

import { PortfolioManagerPage } from "./PortfolioManagerPage";
import { STORAGE_KEY_PORTFOLIO, STORAGE_KEY_WATCHLIST } from "../lib/portfolioStorage";

interface SeededPosition {
  id: string;
  ticker: string;
  name: string;
  shares: number;
  averageCost: number;
}

function position(id: string, ticker: string, shares: number, averageCost: number): SeededPosition {
  return { id, ticker, name: `${ticker} テスト`, shares, averageCost };
}

function seedPortfolio(positions: SeededPosition[]): void {
  localStorage.setItem(STORAGE_KEY_PORTFOLIO, JSON.stringify(positions));
}

function seedWatchlist(tickers: string[]): void {
  localStorage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(tickers));
}

/** Simulate a write performed by another tab. */
function dispatchStorageEvent(key: string | null): void {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      newValue: key === null ? null : localStorage.getItem(key),
      storageArea: localStorage,
    }),
  );
}

function page() {
  return (
    <PortfolioManagerPage onNavigate={() => {}} onOpenStockDetail={() => {}} />
  );
}

/** Number of holdings the page currently displays. */
function holdingsCount(): number {
  const text = screen.getByText(/保有株式一覧/).textContent ?? "";
  const match = /保有株式一覧 \((\d+)銘柄\)/.exec(text);
  return match ? Number(match[1]) : -1;
}

/** Number of watchlist entries the page currently displays. */
function watchlistCount(): number {
  const text = screen.getByText(/監視中ウォッチリスト/).textContent ?? "";
  const match = /監視中ウォッチリスト \((\d+)銘柄\)/.exec(text);
  return match ? Number(match[1]) : -1;
}

function storedTickers(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY_PORTFOLIO);
  const parsed: unknown = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) =>
    entry && typeof entry === "object" && typeof (entry as { ticker?: unknown }).ticker === "string"
      ? ((entry as { ticker: string }).ticker)
      : "",
  );
}

/**
 * Fill the add-position form and submit it.
 *
 * Every step is its own event: React Testing Library wraps a single event in
 * `act`, so the modal is mounted before the form is filled and the submit
 * handler sees the values that were entered.
 */
function addPosition(ticker: string, shares: string, averageCost: string): void {
  fireEvent.click(screen.getByRole("button", { name: /保有銘柄を追加/ }));
  fireEvent.change(screen.getByLabelText(/銘柄コード/), { target: { value: ticker } });
  fireEvent.change(screen.getByLabelText(/保有株数/), { target: { value: shares } });
  fireEvent.change(screen.getByLabelText(/平均取得単価/), { target: { value: averageCost } });
  fireEvent.click(screen.getByRole("button", { name: "登録する" }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  authState.isAuthenticated = true;
  loadCalls.portfolio = 0;
  loadCalls.watchlist = 0;
  // The page fetches live quotes for the displayed tickers; the request is
  // irrelevant here and must not reach the network.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PortfolioManagerPage cross-tab sync (R18)", () => {
  it("reloads the holdings when another tab writes the portfolio key", async () => {
    seedPortfolio([position("own-1", "7203", 100, 2500)]);
    render(page());

    expect(holdingsCount()).toBe(1);

    // Another tab persisted a different portfolio.
    seedPortfolio([
      position("other-1", "9984", 10, 8000),
      position("other-2", "6758", 5, 3000),
    ]);
    await act(async () => {
      dispatchStorageEvent(STORAGE_KEY_PORTFOLIO);
    });

    // This tab shows the other tab's holdings now.
    expect(holdingsCount()).toBe(2);
    expect(screen.getAllByText(/9984/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/6758/).length).toBeGreaterThan(0);
  });

  it("reloads the watchlist when another tab writes the watchlist key", async () => {
    seedPortfolio([position("own-1", "7203", 100, 2500)]);
    seedWatchlist(["7203"]);
    render(page());

    fireEvent.click(screen.getByRole("button", { name: /監視中ウォッチリスト/ }));
    expect(watchlistCount()).toBe(1);

    seedWatchlist(["7203", "9984"]);
    await act(async () => {
      dispatchStorageEvent(STORAGE_KEY_WATCHLIST);
    });

    expect(watchlistCount()).toBe(2);
    expect(screen.getAllByText("9984").length).toBeGreaterThan(0);
  });

  it("ignores a storage event while the user is not signed in", async () => {
    authState.isAuthenticated = false;
    seedPortfolio([position("other-1", "9984", 10, 8000)]);
    render(page());

    await act(async () => {
      dispatchStorageEvent(STORAGE_KEY_PORTFOLIO);
    });

    // The login gate is still shown and nothing was read from the storage.
    expect(screen.getByText(/ポートフォリオのロック解除/)).toBeTruthy();
    expect(loadCalls.portfolio).toBe(0);
    expect(loadCalls.watchlist).toBe(0);
  });

  it("keeps the other tab's holdings when this tab adds a position", async () => {
    seedPortfolio([position("own-1", "7203", 100, 2500)]);
    render(page());
    expect(holdingsCount()).toBe(1);

    // Another tab added a holding.
    seedPortfolio([
      position("own-1", "7203", 100, 2500),
      position("other-1", "9984", 10, 8000),
    ]);
    await act(async () => {
      dispatchStorageEvent(STORAGE_KEY_PORTFOLIO);
    });
    expect(holdingsCount()).toBe(2);

    // This tab adds its own position.
    addPosition("6758", "5", "3000");
    await act(async () => {});

    // The other tab's holding is neither dropped from the view nor from the
    // persisted payload.
    expect(holdingsCount()).toBe(3);
    expect(storedTickers().sort()).toEqual(["6758", "7203", "9984"]);
  });
});

describe("PortfolioManagerPage authentication transition (R12)", () => {
  it("applies the persisted holdings exactly once per auth change", async () => {
    authState.isAuthenticated = false;
    seedPortfolio([
      position("own-1", "7203", 100, 2500),
      position("own-2", "9984", 10, 8000),
    ]);
    seedWatchlist(["7203", "6758"]);

    const { rerender } = render(page());
    await act(async () => {});

    // Signed out: the persisted state is not read at all.
    expect(loadCalls.portfolio).toBe(0);
    expect(loadCalls.watchlist).toBe(0);
    expect(screen.getByText(/ポートフォリオのロック解除/)).toBeTruthy();

    // Sign in: the transition runs exactly once.
    await act(async () => {
      authState.isAuthenticated = true;
      rerender(page());
    });

    expect(loadCalls.portfolio).toBe(1);
    expect(loadCalls.watchlist).toBe(1);
    expect(holdingsCount()).toBe(2);
    expect(watchlistCount()).toBe(2);

    // The real holdings were neither cleared in the view nor in the storage.
    expect(storedTickers().sort()).toEqual(["7203", "9984"]);

    // Signing out does not run the transition's read path and does not wipe
    // the persisted holdings.
    await act(async () => {
      authState.isAuthenticated = false;
      rerender(page());
    });
    expect(loadCalls.portfolio).toBe(1);
    expect(storedTickers().sort()).toEqual(["7203", "9984"]);

    // Signing in again applies the transition exactly once more.
    await act(async () => {
      authState.isAuthenticated = true;
      rerender(page());
    });
    expect(loadCalls.portfolio).toBe(2);
    expect(loadCalls.watchlist).toBe(2);
    expect(holdingsCount()).toBe(2);
    expect(storedTickers().sort()).toEqual(["7203", "9984"]);
  });
});
