// @vitest-environment jsdom
/**
 * DOM-level regression tests for the UI hardening:
 *
 * - the static asset recovery script must not reload forever when the browser
 *   blocks sessionStorage;
 * - the freshness context must not invent a "last updated" timestamp for data
 *   that was never fetched;
 * - the technical chart must not repeat its D1 write when only the quote
 *   object was replaced;
 * - the authentication mode switch is a toggle group, not a tab list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
// The recovery script is read through Vite's `?raw` suffix: the jsdom
// environment externalizes the Node built-ins, so `fs`/`path` are unusable
// here.
import assetRecoverySource from "../../public/asset-error-recovery.js?raw";
import { StockTechnicalChart } from "./StockTechnicalChart";
import { AuthModal } from "./AuthModal";
import {
  FreshnessProvider,
  useActiveFreshness,
  useRegisterFreshness,
  type TabFreshness,
} from "../contexts/FreshnessContext";
import { createStockQuote } from "../test-helpers/quote";
import type { PageView } from "../lib/navigation";

// The Turnstile widget loads an external script and polls for the challenge;
// the mode switch does not depend on it.
vi.mock("./TurnstileWidget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile-widget-stub" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// recharts' ResponsiveContainer needs a ResizeObserver, which jsdom does not
// implement.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

describe("static asset recovery script", () => {
  const source = assetRecoverySource;

  interface CapturedListener {
    type: string;
    listener: EventListener;
    options: boolean | undefined;
  }

  function installScript(): {
    listeners: CapturedListener[];
    setTimeoutSpy: ReturnType<typeof vi.spyOn>;
  } {
    const listeners: CapturedListener[] = [];
    vi.spyOn(window, "addEventListener").mockImplementation(((
      type: string,
      listener: EventListener,
      options?: boolean | AddEventListenerOptions,
    ) => {
      listeners.push({ type, listener, options: options as boolean | undefined });
    }) as typeof window.addEventListener);
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation((() => 0) as never);
    new Function(source)();
    return { listeners, setTimeoutSpy };
  }

  function fireAssetError(listeners: CapturedListener[]): void {
    const script = document.createElement("script");
    document.body.appendChild(script);
    const event = new Event("error");
    Object.defineProperty(event, "target", { value: script });
    for (const entry of listeners) {
      if (entry.type === "error") {
        entry.listener(event);
      }
    }
  }

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("does not schedule a reload when the browser blocks sessionStorage", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage is blocked");
      },
    });

    try {
      const { listeners, setTimeoutSpy } = installScript();
      const root = document.getElementById("root") as HTMLElement;

      fireAssetError(listeners);

      // No reload may be scheduled: the flag can never be persisted, so a
      // reload would schedule another reload on every load.
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      // The recovery panel is shown instead.
      expect(root.textContent).toContain("リソースの読み込みに失敗しました");
    } finally {
      if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    }
  });

  it("schedules exactly one reload when the retry flag is not set yet", () => {
    window.sessionStorage.clear();
    const { listeners, setTimeoutSpy } = installScript();

    fireAssetError(listeners);

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(document.getElementById("root")?.textContent ?? "").not.toContain(
      "リソースの読み込みに失敗しました",
    );
  });

  it("shows the recovery panel when the retry already happened", () => {
    const key = `asset_reload_retry_${window.location.pathname}`;
    window.sessionStorage.setItem(key, "true");
    const { listeners, setTimeoutSpy } = installScript();

    fireAssetError(listeners);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(document.getElementById("root")?.textContent ?? "").toContain(
      "リソースの読み込みに失敗しました",
    );
  });
});

describe("freshness context", () => {
  interface FreshnessState {
    updatedAt: number | null;
    loading: boolean;
    typeLabel: string;
    benchmarkUpdatedAt: number | null;
    calculationUpdatedAt: number | null;
  }

  function FreshnessProbe({
    view,
    testId = "freshness",
    explicitProps,
  }: {
    view: PageView;
    testId?: string;
    explicitProps?: Partial<TabFreshness>;
  }) {
    const freshness = useActiveFreshness(view, explicitProps);
    return (
      <span data-testid={testId}>
        {JSON.stringify({
          updatedAt: freshness.updatedAt ?? null,
          loading: freshness.loading ?? false,
          typeLabel: freshness.typeLabel ?? null,
          benchmarkUpdatedAt: freshness.benchmarkUpdatedAt ?? null,
          calculationUpdatedAt: freshness.calculationUpdatedAt ?? null,
        })}
      </span>
    );
  }

  function RegisteringView({ view, updatedAt }: { view: PageView; updatedAt: number }) {
    useRegisterFreshness(view, { updatedAt, loading: false });
    return null;
  }

  function readFreshness(element: HTMLElement): FreshnessState {
    return JSON.parse(element.textContent ?? "{}") as FreshnessState;
  }

  it("does not invent a timestamp for a view that never fetched data", () => {
    const { getByTestId } = render(
      <FreshnessProvider>
        <FreshnessProbe view="screener" />
      </FreshnessProvider>,
    );

    const state = readFreshness(getByTestId("freshness"));

    expect(state.updatedAt).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.typeLabel).toBe("スクリーナー");
  });

  it("does not leak another view's timestamp into a view without its own", () => {
    const registeredAt = 1_700_000_000_000;
    const { getByTestId } = render(
      <FreshnessProvider>
        <RegisteringView view="market" updatedAt={registeredAt} />
        <FreshnessProbe view="market" testId="market-freshness" />
        <FreshnessProbe view="screener" testId="screener-freshness" />
      </FreshnessProvider>,
    );

    // The view that registered the timestamp still reports it.
    expect(readFreshness(getByTestId("market-freshness")).updatedAt).toBe(registeredAt);

    // UI-04: the screener fetched nothing, so it must not borrow the market
    // page's fetch time as its own "last updated" (that rendered the LIVE
    // badge for data it never loaded). It resolves to `null` instead.
    const screener = readFreshness(getByTestId("screener-freshness"));
    expect(screener.updatedAt).toBeNull();
    expect(screener.loading).toBe(false);
  });

  it("still resolves the dashboard's own timestamps", () => {
    const dashboardAt = 1_700_000_001_000;
    const { getByTestId } = render(
      <FreshnessProvider>
        <RegisteringView view="dashboard" updatedAt={dashboardAt} />
        <FreshnessProbe view="dashboard" testId="dashboard-freshness" />
      </FreshnessProvider>,
    );

    expect(readFreshness(getByTestId("dashboard-freshness")).updatedAt).toBe(dashboardAt);
  });

  it("resolves the dashboard's explicit benchmark and calculation timestamps", () => {
    const benchmarkAt = 1_700_000_002_000;
    const calculationAt = 1_700_000_003_000;
    const { getByTestId } = render(
      <FreshnessProvider>
        <FreshnessProbe
          view="dashboard"
          testId="dashboard-freshness"
          explicitProps={{
            benchmarkUpdatedAt: benchmarkAt,
            calculationUpdatedAt: calculationAt,
          }}
        />
      </FreshnessProvider>,
    );

    const dashboard = readFreshness(getByTestId("dashboard-freshness"));
    expect(dashboard.benchmarkUpdatedAt).toBe(benchmarkAt);
    expect(dashboard.calculationUpdatedAt).toBe(calculationAt);
    expect(dashboard.updatedAt).toBe(benchmarkAt);
  });
});

describe("authentication mode switch", () => {
  it("exposes the administrator and general-user modes as a named toggle group", () => {
    // The Turnstile configuration request fails in the test environment; the
    // modal falls back to the default site key.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network disabled in test");
      }),
    );

    render(<AuthModal isOpen onClose={vi.fn()} />);

    // UI-13: the two modes share one form, so they are toggle buttons in a
    // named group — not tabs without a tabpanel to control.
    const group = screen.getByRole("group", { name: "認証モード切替" });
    expect(screen.queryByRole("tablist")).toBeNull();

    const adminButton = within(group).getByRole("button", { name: /管理者ログイン/ });
    const userButton = within(group).getByRole("button", { name: /一般ユーザー/ });

    // The selection state is exposed through aria-pressed.
    expect(adminButton.getAttribute("aria-pressed")).toBe("true");
    expect(userButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(userButton);

    expect(adminButton.getAttribute("aria-pressed")).toBe("false");
    expect(userButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the administrator lockout out of the general-user mode", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network disabled in test");
      }),
    );

    render(<AuthModal isOpen onClose={vi.fn()} />);

    const group = screen.getByRole("group", { name: "認証モード切替" });
    const userButton = within(group).getByRole("button", { name: /一般ユーザー/ });
    fireEvent.click(userButton);

    // The general-user form is never disabled by the administrator lockout.
    const passwordInput = screen.getByLabelText(/アクセスパスワード/) as HTMLInputElement;
    expect(passwordInput.disabled).toBe(false);
    expect(screen.queryByText(/管理者ログインが一時ロックされています/)).toBeNull();
  });
});

describe("technical chart preflight write", () => {
  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("writes the price cache only once for an unchanged ticker", async () => {
    const syncCalls: string[] = [];
    const calculateCalls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sync-prices") {
        syncCalls.push(url);
        return jsonResponse({ ok: true });
      }
      if (url === "/api/calculate") {
        calculateCalls.push(url);
        return jsonResponse({
          stockUniverse: [
            {
              ticker: "7203",
              series: Array.from({ length: 10 }, (_, index) => ({
                date: `2026-03-${String(index + 1).padStart(2, "0")}`,
                close: 2800 + index,
              })),
            },
          ],
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const quote = createStockQuote({ ticker: "7203" });
    const { rerender } = render(<StockTechnicalChart stock={quote} />);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(syncCalls).toHaveLength(1);

    // The quote object is replaced (a refresh), but the ticker is unchanged:
    // the historical series cannot have changed, so the write must not repeat.
    await act(async () => {
      rerender(<StockTechnicalChart stock={{ ...quote, price: 2900 }} />);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The effect really did run again (the chart re-read the history)...
    expect(calculateCalls.length).toBeGreaterThanOrEqual(2);
    // ...but the D1 write was not repeated.
    expect(syncCalls).toHaveLength(1);
  });

  it("retries the preflight write when it failed", async () => {
    let syncCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sync-prices") {
        syncCalls += 1;
        // The first write fails: it must be retried on the next run.
        return new Response("error", { status: 500 });
      }
      if (url === "/api/calculate") {
        return jsonResponse({ stockUniverse: [] });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const quote = createStockQuote({ ticker: "7203" });
    const { rerender } = render(<StockTechnicalChart stock={quote} />);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(syncCalls).toBe(1);

    // The quote changes, so the effect runs again: the failed write must be
    // retried instead of being considered done.
    await act(async () => {
      rerender(<StockTechnicalChart stock={{ ...quote, price: 2900 }} />);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(syncCalls).toBe(2);
  });
});
