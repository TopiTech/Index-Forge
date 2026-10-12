/**
 * Regression tests for the legacy-session migration in lib/auth.
 *
 * getStoredAuth() migrates a legacy localStorage session into sessionStorage.
 * The migration must only delete the legacy entry after the sessionStorage
 * write succeeded: in an environment where sessionStorage is missing or
 * read-only (private browsing, storage policy), deleting it unconditionally
 * destroyed the only copy of the session and logged the user out on reload.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStoredAuth, storeAuth, clearAuth, getAuthHeaders } from "./auth";
import type { AuthSession } from "../types";

const AUTH_KEY = "custom_stock_index_auth";

const SESSION: AuthSession = {
  role: "admin",
  name: "管理者",
  password: "secret-password",
  maxStocks: null,
  maxIndices: null,
  id: "admin-master",
};

function createStorage(initial: Record<string, string> = {}, options: { failWrites?: boolean } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (options.failWrites) throw new Error("QuotaExceededError");
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getStoredAuth legacy migration", () => {
  it("migrates a legacy localStorage session into sessionStorage and removes the legacy copy", () => {
    const session = createStorage();
    const local = createStorage({ [AUTH_KEY]: JSON.stringify(SESSION) });
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    const stored = getStoredAuth();
    expect(stored?.password).toBe(SESSION.password);
    expect(session.data.get(AUTH_KEY)).toBe(JSON.stringify(SESSION));
    expect(local.data.has(AUTH_KEY)).toBe(false);
  });

  it("keeps the legacy session when the sessionStorage write fails", () => {
    const session = createStorage({}, { failWrites: true });
    const local = createStorage({ [AUTH_KEY]: JSON.stringify(SESSION) });
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    const stored = getStoredAuth();
    expect(stored?.password).toBe(SESSION.password);
    // The only copy of the session must survive so a reload stays logged in.
    expect(local.data.has(AUTH_KEY)).toBe(true);
  });

  it("keeps the legacy session when sessionStorage is unavailable", () => {
    const local = createStorage({ [AUTH_KEY]: JSON.stringify(SESSION) });
    vi.stubGlobal("sessionStorage", undefined);
    vi.stubGlobal("localStorage", local.storage);

    const stored = getStoredAuth();
    expect(stored?.password).toBe(SESSION.password);
    expect(local.data.has(AUTH_KEY)).toBe(true);
  });

  it("prefers the current sessionStorage entry over a legacy one", () => {
    const newer: AuthSession = { ...SESSION, password: "newer-password", role: "user" };
    const session = createStorage({ [AUTH_KEY]: JSON.stringify(newer) });
    const local = createStorage({ [AUTH_KEY]: JSON.stringify(SESSION) });
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    const stored = getStoredAuth();
    expect(stored?.password).toBe("newer-password");
  });
});

describe("storeAuth / clearAuth", () => {
  it("stores into sessionStorage and cleans up the legacy localStorage copy", () => {
    const session = createStorage();
    const local = createStorage({ [AUTH_KEY]: JSON.stringify(SESSION) });
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    storeAuth(SESSION);
    expect(session.data.get(AUTH_KEY)).toBe(JSON.stringify(SESSION));
    expect(local.data.has(AUTH_KEY)).toBe(false);

    clearAuth();
    expect(session.data.has(AUTH_KEY)).toBe(false);
  });

  it("falls back to localStorage when sessionStorage writes are rejected", () => {
    const session = createStorage({}, { failWrites: true });
    const local = createStorage();
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    storeAuth(SESSION);
    expect(local.data.get(AUTH_KEY)).toBe(JSON.stringify(SESSION));
  });

  it("sends the password header for authenticated requests", () => {
    const session = createStorage({ [AUTH_KEY]: JSON.stringify(SESSION) });
    const local = createStorage();
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    expect(getAuthHeaders()).toEqual({
      "x-auth-password": SESSION.password,
      "x-admin-key": SESSION.password,
    });
  });
});
