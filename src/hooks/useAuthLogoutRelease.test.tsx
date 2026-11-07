// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAuth } from "./useAuth";
import * as apiContract from "../lib/apiContract";
import { storeAuth } from "../lib/auth";

describe("useAuth logout response lifecycle release", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("releases response lifecycle when admin logout POST resolves", async () => {
    const releaseSpy = vi.spyOn(apiContract, "releaseResponse");

    storeAuth({
      role: "admin",
      name: "Administrator",
      password: "valid-admin-password",
      adminToken: "test-admin-session-token-12345",
      maxStocks: null,
      maxIndices: null,
    });

    let logoutCalled = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/logout")) {
        logoutCalled = true;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current.isAdmin).toBe(true);

    await act(async () => {
      result.current.logout();
      // Wait microtasks so fetchWithNetworkMark's .then() resolves
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(logoutCalled).toBe(true);
    expect(releaseSpy).toHaveBeenCalled();
    expect(result.current.session).toBe(null);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("handles user logout without calling admin logout endpoint", async () => {
    const releaseSpy = vi.spyOn(apiContract, "releaseResponse");

    storeAuth({
      role: "user",
      name: "NormalUser",
      password: "valid-user-password",
      maxStocks: 10,
      maxIndices: 5,
    });

    let logoutCalled = false;
    globalThis.fetch = vi.fn(async () => {
      logoutCalled = true;
      return new Response("Not Found", { status: 404 });
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current.isUser).toBe(true);

    await act(async () => {
      result.current.logout();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(logoutCalled).toBe(false);
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(result.current.session).toBe(null);
  });

  it("safely clears local state even when network fails during admin logout", async () => {
    storeAuth({
      role: "admin",
      name: "Administrator",
      password: "valid-admin-password",
      adminToken: "test-admin-session-token-12345",
      maxStocks: null,
      maxIndices: null,
    });

    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network error during logout");
    });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      expect(() => result.current.logout()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(result.current.session).toBe(null);
    expect(result.current.isAuthenticated).toBe(false);
  });
});
