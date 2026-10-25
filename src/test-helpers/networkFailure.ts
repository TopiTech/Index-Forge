import { expect, vi } from "vitest";
import { renderHook, type RenderHookOptions, type RenderHookResult } from "@testing-library/react";
import { NETWORK_UNREACHABLE_MESSAGE } from "../lib/apiContract";

/**
 * Shared harness for network-failure hook tests (FINISH follow-up).
 *
 * The "server unreachable" contract — a `fetch()` rejection means the server
 * was never reached, so the UI shows the connection-check hint while the
 * fallback stays intact — is exercised by `useIndices`, `useCalculation`
 * (and, via unit tests, `fetchWithNetworkMark` itself). Each of those suites
 * used to hand-roll the same stub-fetch / render / wait scaffolding; it now
 * lives here once, so the next transport change is proven in one place.
 */

/** Install a fetch double that rejects every request with `error`. */
export function installFailingFetch(error: unknown = new TypeError("Failed to fetch")) {
  const fetchMock = vi.fn(async (): Promise<Response> => {
    throw error;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Install a fetch double that hangs until the request signal aborts, then
 * rejects with an `AbortError` — the shape of a request killed by the
 * in-hook timeout (e.g. the 10s indices timer) rather than by the test.
 */
export function installAbortableHangingFetch() {
  const abortError = () => new DOMException("The operation was aborted.", "AbortError");
  const fetchMock = vi.fn(
    (...args: [RequestInfo | URL, RequestInit?]): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        const [, init] = args;
        if (init?.signal?.aborted) {
          reject(abortError());
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Render a hook with every fetch failing; returns the render result plus the mock. */
export function renderWithFailingFetch<Result, Props>(
  renderCallback: (props: Props) => Result,
  options?: RenderHookOptions<Props> & { fetchError?: unknown },
): RenderHookResult<Result, Props> & { fetchMock: ReturnType<typeof installFailingFetch> } {
  const { fetchError, ...renderOptions } = options ?? {};
  const fetchMock = installFailingFetch(fetchError);
  const rendered = renderHook(renderCallback, renderOptions);
  return { ...rendered, fetchMock };
}

/** Assert the UI-facing connection hint — and never raw browser English. */
export function expectConnectionHint(actual: string | null) {
  expect(actual).toBe(NETWORK_UNREACHABLE_MESSAGE);
  expect(actual).not.toContain("Failed to fetch");
}
