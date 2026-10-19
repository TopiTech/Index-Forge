import type { AuthSession } from "../types";

const AUTH_STORAGE_KEY = "custom_stock_index_auth";

function getSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Identity of the newest authentication attempt.
 *
 * The state is module scoped, not per hook instance: `useAuth()` is used by
 * a dozen components, and the login is started by one of them (the auth
 * modal) while the logout is performed in another (the header). A per
 * instance controller could not see the other instance's request, so the
 * in-flight login resolved after the logout and silently re-authenticated
 * (and re-persisted) the user.
 */
let authRequestId = 0;
let authAbortController: AbortController | null = null;

/** Cancel the authentication attempt that is currently running, if any. */
export function cancelPendingAuthAttempt(): void {
  authRequestId += 1;
  if (authAbortController) {
    authAbortController.abort();
    authAbortController = null;
  }
}

/** Start a new attempt, superseding every previous one. */
export function beginAuthAttempt(): { requestId: number; controller: AbortController } {
  cancelPendingAuthAttempt();
  const controller = new AbortController();
  authAbortController = controller;
  return { requestId: authRequestId, controller };
}

/**
 * True when the attempt identified by `requestId` is still the current one.
 *
 * A superseded attempt must not publish its result: the user may have logged
 * out, or started a newer attempt, in the meantime.
 */
export function isCurrentAuthAttempt(requestId: number): boolean {
  return requestId === authRequestId;
}

/**
 * Validate a session read back from browser storage.
 *
 * The stored payload is untrusted: it can be left over from an older build,
 * hand-edited, or written by another script on the same origin. Casting it to
 * `AuthSession` without checking the shape made a payload such as
 * `{"role":"admin"}` render the admin surface and send `x-admin-key` on every
 * request, even though the Worker would reject it with 401.
 */
export function sanitizeAuthSession(raw: unknown): AuthSession | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const role = record.role === "admin" || record.role === "user" ? record.role : null;
  if (!role) return null;

  const password = typeof record.password === "string" ? record.password : "";
  if (!password) return null;

  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "ユーザー";

  const readLimit = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    return value;
  };

  const session: AuthSession = {
    role,
    name,
    password,
    maxStocks: readLimit(record.maxStocks),
    maxIndices: readLimit(record.maxIndices),
  };
  if (typeof record.id === "string" && record.id) {
    session.id = record.id;
  }
  return session;
}

/**
 * Retrieve the current-tab auth session. Passwords are intentionally kept in
 * sessionStorage instead of persistent localStorage; legacy localStorage
 * entries are migrated and removed on first read.
 */
export function getStoredAuth(): AuthSession | null {
  try {
    const sessionStore = getSessionStorage();
    const localStore = getLocalStorage();
    const sessionRaw = sessionStore?.getItem(AUTH_STORAGE_KEY) || null;
    const legacyRaw = localStore?.getItem(AUTH_STORAGE_KEY) || null;
    const raw = sessionRaw || legacyRaw;
    if (!raw) return null;
    const session = sanitizeAuthSession(JSON.parse(raw));
    if (!session) return null;
    if (!sessionRaw && legacyRaw) {
      // Storage can be present but read-only (private browsing/quota policy).
      // A failed migration must not discard an otherwise valid legacy session:
      // the legacy entry is removed only after the sessionStorage write
      // actually succeeded.
      let migrated = false;
      try {
        if (sessionStore) {
          sessionStore.setItem(AUTH_STORAGE_KEY, legacyRaw);
          migrated = true;
        }
      } catch {
        // Keep using the parsed legacy session for this render.
      }
      if (migrated) {
        try {
          localStore?.removeItem(AUTH_STORAGE_KEY);
        } catch {
          // Best-effort cleanup; clearAuth will retry later.
        }
      }
    }
    return session;
  } catch {
    return null;
  }
}

function notifyAuthChanged(): void {
  if (typeof globalThis !== "undefined") {
    type AuthEventTarget = { dispatchEvent?: (event: Event) => boolean };
    const target = ((globalThis as unknown as { window?: AuthEventTarget }).window ||
      globalThis) as unknown as AuthEventTarget;
    if (typeof target.dispatchEvent === "function" && typeof Event !== "undefined") {
      try {
        target.dispatchEvent(new Event("auth-changed"));
      } catch {
        // Event dispatch is best effort in non-browser environments.
      }
    }
  }
}

/**
 * Persist auth session for the current tab only.
 */
export function storeAuth(session: AuthSession): void {
  try {
    const serialized = JSON.stringify(session);
    const sessionStore = getSessionStorage();
    const localStore = getLocalStorage();
    if (sessionStore) {
      try {
        sessionStore.setItem(AUTH_STORAGE_KEY, serialized);
        try {
          localStore?.removeItem(AUTH_STORAGE_KEY);
        } catch {
          // Do not fail a successful session write because legacy cleanup failed.
        }
      } catch (sessionError) {
        // Some browsers expose sessionStorage but reject writes. Preserve the
        // documented fallback behavior rather than losing a successful login.
        try {
          localStore?.setItem(AUTH_STORAGE_KEY, serialized);
        } catch {
          console.error("Failed to store auth in available browser storage:", sessionError);
          return;
        }
      }
    } else {
      // Fallback for non-browser/older environments where sessionStorage is
      // unavailable; the application still needs to remain usable there.
      try {
        localStore?.setItem(AUTH_STORAGE_KEY, serialized);
      } catch (storageError) {
        console.error("Failed to store auth:", storageError);
        return;
      }
    }
    notifyAuthChanged();
  } catch (err) {
    console.error("Failed to store auth:", err);
  }
}

/**
 * Clear auth session from localStorage
 */
export function clearAuth(): void {
  try {
    getSessionStorage()?.removeItem(AUTH_STORAGE_KEY);
    getLocalStorage()?.removeItem(AUTH_STORAGE_KEY);
    notifyAuthChanged();
  } catch {
    // Storage may be unavailable or read-only.
  }
}

/**
 * Returns HTTP headers for authenticated requests
 */
export function getAuthHeaders(session?: AuthSession | null): Record<string, string> {
  const current = session || getStoredAuth();
  if (!current?.password) return {};
  return {
    "x-auth-password": current.password,
    ...(current.role === "admin" ? { "x-admin-key": current.password } : {}),
  };
}

/**
 * Verify password against the worker API
 *
 * `signal` lets the caller cancel an attempt that has been superseded (for
 * example because the user logged out while the request was in flight). A
 * cancelled attempt must not persist a session.
 */
export async function verifyPassword(
  password: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
  try {
    const trimmed = password.trim();
    if (!trimmed) {
      return { ok: false, error: "パスワードを入力してください" };
    }

    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-auth-mode": "user" },
      body: JSON.stringify({ password: trimmed, role: "user", userOnly: true }),
      signal,
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (signal?.aborted) {
      return { ok: false, error: "認証がキャンセルされました" };
    }
    if (!res.ok || data.ok !== true) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : "パスワードが正しくありません",
      };
    }

    // 防御的検証: 一般ユーザー認証で管理者ロールが返却された場合は管理者ログインへの誘導エラーとする
    if (data.role === "admin") {
      return {
        ok: false,
        error: "管理者としてログインするには「管理者ログイン」から秘密の暗号およびTurnstile認証を行ってください",
      };
    }

    const role = data.role === "user" ? data.role : null;
    if (!role) {
      return { ok: false, error: "認証応答が不正です" };
    }

    const session: AuthSession = {
      role: "user",
      name: typeof data.name === "string" ? data.name : "ユーザー",
      password: trimmed,
      maxStocks: typeof data.maxStocks === "number" ? data.maxStocks : null,
      maxIndices: typeof data.maxIndices === "number" ? data.maxIndices : null,
      id: typeof data.id === "string" ? data.id : undefined,
    };

    storeAuth(session);
    return { ok: true, session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "認証通信エラーが発生しました";
    return { ok: false, error: msg };
  }
}

/**
 * Generate a cryptographically secure random password.
 * Uses characters without visually ambiguous pairs (e.g. 0, O, 1, l, I).
 */
export function generateSecurePassword(length = 10): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const charsLength = chars.length;
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomValues[i] % charsLength);
  }
  return result;
}

/**
 * Retrieve Turnstile configuration and admin lockout status from the Worker API
 */
export async function getTurnstileConfig(): Promise<{
  siteKey: string;
  lockout?: { locked: boolean; remainingSeconds: number; remainingAttempts: number };
}> {
  try {
    const res = await fetch("/api/auth/turnstile-config");
    if (!res.ok) {
      return { siteKey: "1x00000000000000000000AA" };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      siteKey?: string;
      lockout?: { locked: boolean; remainingSeconds: number; remainingAttempts: number };
    };
    return {
      siteKey: data.siteKey || "1x00000000000000000000AA",
      lockout: data.lockout,
    };
  } catch (e) {
    console.warn("Failed to fetch Turnstile config:", e);
    return { siteKey: "1x00000000000000000000AA" };
  }
}

/**
 * Perform dedicated administrator login with password, secret code, and Turnstile verification.
 */
export async function adminLogin(
  password: string,
  secretCode: string,
  turnstileToken: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  session?: AuthSession;
  error?: string;
  locked?: boolean;
  remainingSeconds?: number;
  remainingAttempts?: number;
}> {
  try {
    const trimmedPwd = password.trim();
    const trimmedCode = secretCode.normalize("NFC").trim();
    const trimmedToken = turnstileToken.trim();

    if (!trimmedPwd) {
      return { ok: false, error: "管理者パスワードを入力してください" };
    }
    if (!trimmedCode) {
      return { ok: false, error: "秘密の暗号を入力してください" };
    }
    if (!trimmedToken) {
      return { ok: false, error: "Turnstile認証（ロボット確認）を完了してください" };
    }

    const res = await fetch("/api/auth/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: trimmedPwd,
        secretCode: trimmedCode,
        turnstileToken: trimmedToken,
      }),
      signal,
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (signal?.aborted) {
      return { ok: false, error: "認証がキャンセルされました" };
    }
    if (!res.ok || data.ok !== true) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : "管理者ログインに失敗しました",
        locked: Boolean(data.locked),
        remainingSeconds: typeof data.remainingSeconds === "number" ? data.remainingSeconds : undefined,
        remainingAttempts: typeof data.remainingAttempts === "number" ? data.remainingAttempts : undefined,
      };
    }

    const role = data.role === "admin" ? "admin" : null;
    if (!role) {
      return { ok: false, error: "管理者権限の認証応答が不正です" };
    }

    const session: AuthSession = {
      role: "admin",
      name: typeof data.name === "string" ? data.name : "管理者",
      password: trimmedPwd,
      maxStocks: null,
      maxIndices: null,
      id: typeof data.id === "string" ? data.id : "admin-master",
    };

    storeAuth(session);
    return { ok: true, session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "管理者認証通信エラーが発生しました";
    return { ok: false, error: msg };
  }
}

/**
 * Change administrator secret code
 */
export async function changeAdminSecretCode(
  currentSecretCode: string,
  newSecretCode: string,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const authHeaders = headers || getAuthHeaders();
    const res = await fetch("/api/admin/admin-secret-code", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        currentSecretCode: currentSecretCode.normalize("NFC").trim(),
        newSecretCode: newSecretCode.normalize("NFC").trim(),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.ok !== true) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : "秘密の暗号の更新に失敗しました",
      };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "通信エラーが発生しました";
    return { ok: false, error: msg };
  }
}
