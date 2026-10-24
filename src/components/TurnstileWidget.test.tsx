// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/**
 * Turnstile loader behaviour.
 *
 * The widget keeps one module-level load promise so several login forms share a
 * single script. These tests drive that loader through its real entry points
 * (the injected script, the global onload callback, the 8s watchdog and the
 * widget's own callbacks) instead of reading the component source.
 */
const TURNSTILE_SCRIPT_SELECTOR = 'script[src*="challenges.cloudflare.com/turnstile"]';

type TurnstileHandle = NonNullable<Window["turnstile"]>;
type RenderParams = Parameters<TurnstileHandle["render"]>[1];

function installTurnstile() {
  const renderFn = vi.fn((_container: HTMLElement | string, _params: RenderParams): string => {
    return "widget-1";
  });
  const reset = vi.fn();
  const remove = vi.fn();
  window.turnstile = { render: renderFn, reset, remove };
  return { renderFn, reset, remove };
}

function clearTurnstileEnvironment() {
  document.querySelectorAll(TURNSTILE_SCRIPT_SELECTOR).forEach((script) => script.remove());
  delete window.turnstile;
  delete window.onloadTurnstileCallback;
}

beforeEach(() => {
  // The loader installs a watchdog timeout, so every case runs on fake timers.
  vi.useFakeTimers();
  vi.resetModules();
  clearTurnstileEnvironment();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearTurnstileEnvironment();
});

describe("TurnstileWidget", () => {
  it("shares one script load, clears the watchdog and the global callback once it settles", async () => {
    const { TurnstileWidget } = await import("./TurnstileWidget");
    const onVerify = vi.fn();

    render(<TurnstileWidget siteKey="site-key" onVerify={onVerify} />);

    expect(document.querySelector(TURNSTILE_SCRIPT_SELECTOR)).not.toBeNull();
    const onLoad = window.onloadTurnstileCallback;
    expect(typeof onLoad).toBe("function");
    expect(vi.getTimerCount()).toBe(1);

    const { renderFn } = installTurnstile();
    await act(async () => {
      onLoad?.();
    });

    // The watchdog and the global entry point are released as soon as the
    // script reported back: neither a pending timer nor a stale closure stays.
    expect(window.onloadTurnstileCallback).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    expect(renderFn).toHaveBeenCalledTimes(1);
    const params = renderFn.mock.calls[0][1];
    expect(params.sitekey).toBe("site-key");
    expect(params.theme).toBe("dark");

    act(() => params.callback?.("token-1"));
    expect(onVerify).toHaveBeenCalledWith("token-1");
  });

  it("reports the watchdog timeout, drops the failed script and can retry", async () => {
    const { TurnstileWidget } = await import("./TurnstileWidget");

    render(<TurnstileWidget siteKey="site-key" onVerify={vi.fn()} />);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(8000);
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "セキュリティ認証の読み込みに失敗しました",
    );
    expect(window.onloadTurnstileCallback).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    // A failed script must not be reused by the retry path.
    expect(document.querySelector(TURNSTILE_SCRIPT_SELECTOR)).toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: "認証を再試行" }).click();
    });
    // The retry injects a fresh script (the failed one was removed above) and
    // clears the error state while it loads.
    expect(document.querySelector(TURNSTILE_SCRIPT_SELECTOR)).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.onloadTurnstileCallback).toBeTypeOf("function");
  });

  it("exposes the widget as a labelled region", async () => {
    const { TurnstileWidget } = await import("./TurnstileWidget");

    render(<TurnstileWidget siteKey="site-key" onVerify={vi.fn()} />);

    expect(
      screen.getByRole("region", { name: "Cloudflare Turnstile セキュリティ認証" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Turnstile ウィジェット表示領域")).toBeTruthy();
  });

  it("removes the widget on unmount and ignores late timeout callbacks", async () => {
    const { renderFn, reset, remove } = installTurnstile();
    const { TurnstileWidget } = await import("./TurnstileWidget");

    const { unmount } = render(<TurnstileWidget siteKey="site-key" onVerify={vi.fn()} />);
    await act(async () => {});

    expect(renderFn).toHaveBeenCalledTimes(1);
    const params = renderFn.mock.calls[0][1];

    unmount();

    expect(remove).toHaveBeenCalledWith("widget-1");
    // The callback belongs to a widget that no longer exists: it must not reset
    // anything (the reset would otherwise target a removed widget id).
    act(() => params["timeout-callback"]?.());
    expect(reset).not.toHaveBeenCalled();
  });
});
