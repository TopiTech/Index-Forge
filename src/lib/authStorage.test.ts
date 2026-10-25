/**
 * Regression tests for the auth session storage contract (SEC-06 / R51).
 *
 * `getStoredAuth()` migrates a legacy localStorage session once: the entry is
 * adopted into memory (and into sessionStorage when the browser allows it) and
 * then deleted, because `storeAuth()` never writes to localStorage again — the
 * plaintext access password must not survive the tab. A rejected or missing
 * sessionStorage therefore means "memory only": the tab keeps working, and a
 * reload asks for a new login instead of silently restoring credentials.
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
  // Reset the module-level session so one test cannot leak into the next.
  clearAuth();
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

  it("keeps the legacy session in memory when the sessionStorage write fails", () => {
    const session = createStorage({}, { failWrites: true });
    const local = createStorage({ [AUTH_KEY]: JSON.stringify(SESSION) });
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    const stored = getStoredAuth();
    // The tab keeps working for this page load...
    expect(stored?.password).toBe(SESSION.password);
    // ...but the plaintext entry is gone: nothing is written back, and a
    // reload must ask for a new login instead of restoring the password.
    expect(local.data.has(AUTH_KEY)).toBe(false);
  });

  it("keeps the legacy session in memory when sessionStorage is unavailable", () => {
    const local = createStorage({ [AUTH_KEY]: JSON.stringify(SESSION) });
    vi.stubGlobal("sessionStorage", undefined);
    vi.stubGlobal("localStorage", local.storage);

    const stored = getStoredAuth();
    expect(stored?.password).toBe(SESSION.password);
    expect(local.data.has(AUTH_KEY)).toBe(false);
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

  it("keeps the session in memory only when sessionStorage writes are rejected", () => {
    const session = createStorage({}, { failWrites: true });
    const local = createStorage();
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    storeAuth(SESSION);
    // SEC-06: the plaintext session must never be copied to localStorage.
    expect(local.data.has(AUTH_KEY)).toBe(false);
    // Other instances of this tab still see the login.
    expect(getStoredAuth()?.password).toBe(SESSION.password);
    expect(getStoredAuth()?.adminToken).toBeUndefined();
  });

  it("keeps the session in memory only when sessionStorage is unavailable", () => {
    const local = createStorage();
    vi.stubGlobal("sessionStorage", undefined);
    vi.stubGlobal("localStorage", local.storage);

    storeAuth(SESSION);
    expect(local.data.has(AUTH_KEY)).toBe(false);
    expect(getStoredAuth()?.password).toBe(SESSION.password);
  });

  it("sends the password header for authenticated requests", () => {
    const session = createStorage({ [AUTH_KEY]: JSON.stringify(SESSION) });
    const local = createStorage();
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    // C-2: the duplicate `x-admin-key` alias is no longer sent (the Worker
    // treats it identically to `x-auth-password`, so it only doubled
    // exposure). The session token still rides along for mixed endpoints.
    expect(getAuthHeaders()).toEqual({
      "x-auth-password": SESSION.password,
    });
  });
});

describe("storeAuth は検証を失敗したセッションを保持しない (C-01)", () => {
  it("sanitizeAuthSession が拒否するセッションはメモリにもストレージにも残らない", () => {
    const session = createStorage();
    const local = createStorage();
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    // 役割が不正 / パスワード欠落 / 非オブジェクト: いずれも保存以前の契約違反。
    storeAuth({ role: "root", password: "x" } as unknown as AuthSession);
    storeAuth({ role: "admin" } as unknown as AuthSession);
    storeAuth(["admin"] as unknown as AuthSession);

    expect(session.data.has(AUTH_KEY)).toBe(false);
    // メモリセッションも作られない: 以前は sanitize 失敗時に生値が入り、
    // 再読み込みなしでも権限昇格した役割で扱われていた。
    expect(getStoredAuth()).toBeNull();
  });

  it("検証に失敗した書き込みは、既存の有効なセッションを追い出さない", () => {
    const session = createStorage();
    const local = createStorage();
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    storeAuth(SESSION);
    storeAuth({ role: "user", password: "" } as unknown as AuthSession);

    expect(getStoredAuth()?.password).toBe(SESSION.password);
    expect(session.data.get(AUTH_KEY)).toBe(JSON.stringify(SESSION));
  });

  it("sessionStorage が無い環境でも不正セッションはメモリに保持されない", () => {
    const local = createStorage();
    vi.stubGlobal("sessionStorage", undefined);
    vi.stubGlobal("localStorage", local.storage);

    storeAuth({ role: "root", password: "x" } as unknown as AuthSession);

    expect(getStoredAuth()).toBeNull();
  });
});
