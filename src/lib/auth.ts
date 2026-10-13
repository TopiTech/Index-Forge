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
    const session = JSON.parse(raw) as AuthSession;
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
 */
export async function verifyPassword(
  password: string,
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
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
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
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

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
