import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_REQUEST_TIMEOUT_MS,
  adminLogin,
  changeAdminSecretCode,
  verifyPassword,
} from "./auth";
import { REQUEST_TIMEOUT_MESSAGE } from "./apiContract";

/**
 * A fetch that never settles on its own but rejects when the caller's
 * AbortController fires, like the real fetch implementation.
 *
 * `fetchWithNetworkMark` enforces its deadline by aborting the request, so a
 * mock that ignores the signal would just hang the suite rather than exercise
 * the timeout path.
 */
function stubAbortAwareHangingFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted by deadline")),
            { once: true },
          );
        }),
    ),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("authentication request deadlines", () => {
  it("fails a stalled password login with the timeout message instead of hanging", async () => {
    vi.useFakeTimers();
    stubAbortAwareHangingFetch();

    const attempt = verifyPassword("valid-password");
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    const result = await attempt;

    expect(result).toEqual({ ok: false, error: REQUEST_TIMEOUT_MESSAGE });
  });

  it("fails a stalled administrator login with the timeout message", async () => {
    vi.useFakeTimers();
    stubAbortAwareHangingFetch();

    const attempt = adminLogin("admin-password", "secret-code", "turnstile-token");
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    const result = await attempt;

    expect(result).toEqual({ ok: false, error: REQUEST_TIMEOUT_MESSAGE });
  });

  it("fails a stalled administrator secret-code change with the timeout message", async () => {
    vi.useFakeTimers();
    stubAbortAwareHangingFetch();

    const attempt = changeAdminSecretCode("old-secret-code", "new-secret-code", {});
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    const result = await attempt;

    expect(result).toEqual({ ok: false, error: REQUEST_TIMEOUT_MESSAGE });
  });
});
