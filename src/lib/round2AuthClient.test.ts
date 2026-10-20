// @vitest-environment jsdom
/**
 * Round 2 — client half of SEC-01/SEC-06 plus the admin-response contracts
 * (UI-16 / UI-38).
 *
 * Covered here:
 * - SEC-01: the administrator session token is validated, persisted with the
 *   session and sent as `x-admin-session`, while `x-auth-password` /
 *   `x-admin-key` stay for backward compatibility.
 * - SEC-06: a `sessionStorage` that rejects writes (or is unavailable) must
 *   never fall back to `localStorage`; the session stays in memory for the tab
 *   and a reload asks for a new login.
 * - `logout()`: fires a best-effort `POST /api/auth/logout` that carries the
 *   administrator session, then clears the local state synchronously.
 * - UI-16: `/api/admin/passwords` rows are validated field by field and
 *   malformed rows (or a non-list payload) never reach the typed table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  clearAuth,
  getAuthHeaders,
  getStoredAuth,
  sanitizeAuthSession,
  sanitizeUserPasswordList,
  storeAuth,
} from "./auth";
import { useAuth } from "../hooks/useAuth";
import type { AuthSession } from "../types";

const AUTH_KEY = "custom_stock_index_auth";

/** 64 hex characters — the shape the Worker issues. */
const ADMIN_TOKEN = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";

const ADMIN_SESSION: AuthSession = {
  role: "admin",
  name: "管理者",
  password: "admin-pass",
  maxStocks: null,
  maxIndices: null,
  id: "admin-master",
  adminToken: ADMIN_TOKEN,
};

const USER_SESSION: AuthSession = {
  role: "user",
  name: "一般ユーザー",
  password: "user-pass",
  maxStocks: 10,
  maxIndices: 3,
  id: "pwd-1",
};

interface FakeStorage {
  data: Map<string, string>;
  storage: Storage;
}

function createStorage(
  initial: Record<string, string> = {},
  options: { failWrites?: boolean } = {},
): FakeStorage {
  const data = new Map(Object.entries(initial));
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      if (options.failWrites) throw new Error("QuotaExceededError");
      data.set(key, value);
    },
  };
  return { data, storage };
}

function readPersistedSession(): Record<string, unknown> | null {
  const raw = window.sessionStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function readHeader(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers;
  if (!headers || Array.isArray(headers) || headers instanceof Headers) return null;
  const record = headers as Record<string, string>;
  return record[name] ?? null;
}

beforeEach(() => {
  clearAuth();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAuth();
});

describe("SEC-01: administrator session token", () => {
  it("persists the token with the session and sends it as x-admin-session", () => {
    storeAuth(ADMIN_SESSION);

    expect(getStoredAuth()?.adminToken).toBe(ADMIN_TOKEN);
    expect(readPersistedSession()?.adminToken).toBe(ADMIN_TOKEN);

    // The legacy headers stay: a deployment that has not migrated yet (and the
    // test-runtime fallback) still authenticate with the password.
    expect(getAuthHeaders()).toEqual({
      "x-auth-password": "admin-pass",
      "x-admin-key": "admin-pass",
      "x-admin-session": ADMIN_TOKEN,
    });
  });

  it("does not send x-admin-session for a general user session", () => {
    storeAuth(USER_SESSION);

    expect(getStoredAuth()?.adminToken).toBeUndefined();
    expect(getAuthHeaders()).toEqual({ "x-auth-password": "user-pass" });
  });

  it("keeps the token when the session is restored from the persisted payload", () => {
    storeAuth(ADMIN_SESSION);
    const persistedRaw = window.sessionStorage.getItem(AUTH_KEY);
    expect(persistedRaw).not.toBeNull();

    // Exactly what getStoredAuth() does after a reload: parse the tab's
    // sessionStorage payload and re-validate it before trusting it.
    const restored = sanitizeAuthSession(JSON.parse(persistedRaw ?? "null"));
    expect(restored?.role).toBe("admin");
    expect(restored?.adminToken).toBe(ADMIN_TOKEN);
    expect(getAuthHeaders(restored)["x-admin-session"]).toBe(ADMIN_TOKEN);
  });

  it("drops a token that is not a plausible header value", () => {
    const invalidTokens: unknown[] = [
      "",
      "short",
      "x".repeat(513),
      "token with space",
      "toke\nn-long-enough",
      42,
      null,
      { token: ADMIN_TOKEN },
    ];
    for (const adminToken of invalidTokens) {
      const session = sanitizeAuthSession({ role: "admin", password: "p", adminToken });
      expect(session).not.toBeNull();
      expect(session?.adminToken).toBeUndefined();
      expect(getAuthHeaders(session)).not.toHaveProperty("x-admin-session");
    }
  });

  it("never attaches an administrator token to a user session", () => {
    const session = sanitizeAuthSession({
      role: "user",
      password: "p",
      adminToken: ADMIN_TOKEN,
    });
    expect(session?.role).toBe("user");
    expect(session?.adminToken).toBeUndefined();
  });
});

describe("SEC-06: no localStorage fallback for the plaintext session", () => {
  it("keeps the session in memory when sessionStorage rejects writes", () => {
    const local = createStorage();
    const session = createStorage({}, { failWrites: true });
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    storeAuth(ADMIN_SESSION);

    // Nothing was written to localStorage, and the tab-local store refused the
    // value rather than keeping a stale copy.
    expect(local.data.has(AUTH_KEY)).toBe(false);
    expect(session.data.has(AUTH_KEY)).toBe(false);

    // Other hook instances of the same tab still see the session.
    expect(getStoredAuth()?.adminToken).toBe(ADMIN_TOKEN);
    expect(getAuthHeaders()).toEqual({
      "x-auth-password": "admin-pass",
      "x-admin-key": "admin-pass",
      "x-admin-session": ADMIN_TOKEN,
    });
  });

  it("keeps the session in memory when sessionStorage is unavailable", () => {
    const local = createStorage();
    vi.stubGlobal("sessionStorage", undefined);
    vi.stubGlobal("localStorage", local.storage);

    storeAuth(ADMIN_SESSION);

    expect(local.data.has(AUTH_KEY)).toBe(false);
    expect(getStoredAuth()?.password).toBe("admin-pass");
  });

  it("adopts a legacy localStorage session once and removes the plaintext copy", () => {
    const session = createStorage();
    const local = createStorage({ [AUTH_KEY]: JSON.stringify(USER_SESSION) });
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    expect(getStoredAuth()?.password).toBe("user-pass");
    // The legacy entry is a one-shot migration source, never re-created.
    expect(local.data.has(AUTH_KEY)).toBe(false);

    // A reload (fresh module state) must not find it again; simulate it by
    // clearing the in-memory copy while keeping the tab's storage.
    clearAuth();
    expect(getStoredAuth()).toBeNull();
    expect(local.data.has(AUTH_KEY)).toBe(false);
  });

  it("removes the tab entry on clearAuth so a later read asks for a login", () => {
    const session = createStorage();
    const local = createStorage();
    vi.stubGlobal("sessionStorage", session.storage);
    vi.stubGlobal("localStorage", local.storage);

    storeAuth(USER_SESSION);
    expect(session.data.has(AUTH_KEY)).toBe(true);

    clearAuth();
    expect(session.data.has(AUTH_KEY)).toBe(false);
    expect(local.data.has(AUTH_KEY)).toBe(false);
    expect(getStoredAuth()).toBeNull();
  });
});

describe("logout() revokes the administrator session", () => {
  it("posts x-admin-session to /api/auth/logout and clears the state synchronously", () => {
    storeAuth(ADMIN_SESSION);

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAuth());
    expect(result.current.isAdmin).toBe(true);

    act(() => {
      result.current.logout();
    });

    expect(result.current.session).toBeNull();
    expect(getStoredAuth()).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_KEY)).toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/logout");
    expect(init?.method).toBe("POST");
    expect(readHeader(init, "x-admin-session")).toBe(ADMIN_TOKEN);
    expect(readHeader(init, "x-auth-password")).toBe("admin-pass");
  });

  it("still clears the session when the revoke request fails", async () => {
    storeAuth(USER_SESSION);

    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.logout();
    });

    // Let the rejected best-effort request settle: it must be swallowed.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.session).toBeNull();
    expect(getStoredAuth()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("UI-16: /api/admin/passwords row validation", () => {
  const validRow = {
    id: "pwd-1",
    name: "リサーチチームA",
    role: "user",
    max_stocks: 10,
    max_indices: 5,
    is_active: 1,
    created_at: 1_700_000_000,
  };

  it("keeps a well-formed row", () => {
    expect(sanitizeUserPasswordList([validRow])).toEqual([validRow]);
  });

  it("drops rows with an unusable id, name, role or flag", () => {
    const rows = sanitizeUserPasswordList([
      { ...validRow, id: "" },
      { ...validRow, id: "   " },
      { ...validRow, id: 42 },
      { ...validRow, id: undefined },
      { ...validRow, name: 7 },
      { ...validRow, role: "root" },
      { ...validRow, is_active: 2 },
      { ...validRow, is_active: true },
      { ...validRow, is_active: "1" },
      null,
      "nope",
      [],
    ]);

    expect(rows).toEqual([]);
  });

  it("drops rows whose limits or timestamps are not numeric", () => {
    const rows = sanitizeUserPasswordList([
      { ...validRow, max_stocks: "10" },
      { ...validRow, max_stocks: -1 },
      { ...validRow, max_indices: Number.NaN },
      { ...validRow, created_at: Number.POSITIVE_INFINITY },
      { ...validRow, created_at: "1700000000" },
      { ...validRow, created_at: undefined },
    ]);

    expect(rows).toEqual([]);
  });

  it("accepts unlimited limits and a missing max_indices", () => {
    const rows = sanitizeUserPasswordList([
      {
        id: "pwd-2",
        name: "無制限アカウント",
        role: "admin",
        max_stocks: null,
        is_active: 0,
        created_at: 1_700_000_001,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows?.[0].max_stocks).toBeNull();
    expect(rows?.[0].max_indices).toBeNull();
    expect(rows?.[0].is_active).toBe(0);
  });

  it("reports a non-list payload instead of an empty list", () => {
    // The caller must be able to tell "no accounts issued" from "the response
    // was a 403/500 body", otherwise the admin sees an empty table after an
    // expired session.
    expect(sanitizeUserPasswordList({ error: "管理者セッションが必要です" })).toBeNull();
    expect(sanitizeUserPasswordList(null)).toBeNull();
    expect(sanitizeUserPasswordList("[]")).toBeNull();
    expect(sanitizeUserPasswordList([])).toEqual([]);
  });

  it("drops an invalid row but keeps the valid ones around it", () => {
    const rows = sanitizeUserPasswordList([
      { ...validRow, id: "pwd-a" },
      { ...validRow, id: "" },
      { ...validRow, id: "pwd-b", max_indices: null },
    ]);

    expect(rows?.map((row) => row.id)).toEqual(["pwd-a", "pwd-b"]);
  });
});
