import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORK_UNREACHABLE_MESSAGE } from "./apiContract";
import { adminLogin, verifyPassword } from "./auth";

/**
 * S5 product decision: a transport rejection is shown with the shared
 * connection-check message. The auth entry points used to surface the raw
 * browser `TypeError` text; this pins the deliberate replacement.
 */
describe("auth network-failure message", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the shared message when a user password request cannot reach the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(verifyPassword("secret-password")).resolves.toEqual({
      ok: false,
      error: NETWORK_UNREACHABLE_MESSAGE,
    });
  });

  it("returns the shared message when the administrator login request cannot reach the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const result = await adminLogin("admin-password", "secret-code", "turnstile-token");

    expect(result.ok).toBe(false);
    expect(result.error).toBe(NETWORK_UNREACHABLE_MESSAGE);
  });
});
