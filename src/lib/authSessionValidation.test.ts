// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAuth,
  DEFAULT_TURNSTILE_SITE_KEY,
  getStoredAuth,
  getTurnstileConfig,
  turnstileFallbackSiteKey,
  verifyPassword,
} from "./auth";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAuth();
});

describe("verifyPassword response validation", () => {
  it("returns the same sanitized session it persists when the quota is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            role: "user",
            name: "一般ユーザー",
            maxStocks: -5,
            maxIndices: Number.POSITIVE_INFINITY,
            id: "pwd-1234",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await verifyPassword("valid-password");

    expect(result.ok).toBe(true);
    expect(result.session?.maxStocks).toBeNull();
    expect(result.session?.maxIndices).toBeNull();
    expect(result.session).toEqual(getStoredAuth());
  });

  it("never falls back to the public test key on a production host", async () => {
    expect(turnstileFallbackSiteKey("localhost")).toBe(DEFAULT_TURNSTILE_SITE_KEY);
    expect(turnstileFallbackSiteKey("indexforge.example")).toBe("");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );

    const config = await getTurnstileConfig("indexforge.example");
    expect(config.siteKey).toBe("");
    expect(config.unavailable).toBe(true);
  });

  it("keeps valid positive limits on both paths", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, role: "user", name: "一般ユーザー", maxStocks: 12, maxIndices: 3 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await verifyPassword("valid-password");

    expect(result.session?.maxStocks).toBe(12);
    expect(result.session?.maxIndices).toBe(3);
    expect(result.session).toEqual(getStoredAuth());
  });
});
