import type { AuthSession, UserPasswordItem } from "../types";

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
 * The current session of this tab, kept in memory.
 *
 * SEC-06 / R51 (corrected): this is *not* a fallback copy of a persisted
 * session, it is the primary one. `useAuth()` is instantiated by a dozen
 * components, and without a shared in-memory session every other instance
 * would only see what storage happens to return.
 *
 * The plaintext access password must never reach `localStorage`: an entry
 * there survives browser restarts and is readable by any script on the origin.
 * When `sessionStorage` rejects a write, or is unavailable, the session stays
 * in this module and is therefore gone after a reload — the user is asked to
 * log in again, which is the intended trade-off (previously the password was
 * copied into `localStorage` instead).
 */
let memoryAuthSession: AuthSession | null = null;

/** Bounds and character set of the opaque token issued by the Worker. */
const ADMIN_TOKEN_MIN_LENGTH = 8;
const ADMIN_TOKEN_MAX_LENGTH = 512;
const ADMIN_TOKEN_ALLOWED = /^[A-Za-z0-9._~+/=-]+$/;

/**
 * Validate an administrator session token before it is used as a header value.
 *
 * The token is opaque to the client, so the check is a bound on size and a
 * whitelist of characters — enough to reject `undefined`, an empty string and
 * header-injection attempts (CR/LF), while staying format agnostic. The Worker
 * remains the authority on whether the token is valid.
 */
export function sanitizeAdminToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  if (token.length < ADMIN_TOKEN_MIN_LENGTH || token.length > ADMIN_TOKEN_MAX_LENGTH) return undefined;
  if (!ADMIN_TOKEN_ALLOWED.test(token)) return undefined;
  return token;
}

/** Remove the plaintext legacy entry an older build may have written. */
function removeLegacyAuthEntry(): void {
  try {
    getLocalStorage()?.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Storage can be unavailable or read-only; the entry is then simply left
    // behind. New sessions are never written there, so it cannot be refreshed.
  }
}

/** Parse one storage entry into a usable session, or null when it is unusable. */
function readSessionFromStore(store: Storage | null): AuthSession | null {
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(AUTH_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return sanitizeAuthSession(JSON.parse(raw));
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
  // SEC-01: the administrator session token is only meaningful for an admin
  // session. A token on a user session (or a malformed one) is dropped rather
  // than persisted, so a hand-edited payload cannot smuggle a header value.
  if (role === "admin") {
    const adminToken = sanitizeAdminToken(record.adminToken);
    if (adminToken) session.adminToken = adminToken;
  }
  return session;
}

/**
 * Retrieve the current-tab auth session.
 *
 * Order of precedence: the tab's `sessionStorage` entry (what a reload of this
 * tab sees, when the browser allowed the write), then the module-level memory
 * session, then a one-shot migration read of a legacy `localStorage` entry.
 *
 * The legacy entry is adopted into memory and deleted on read: it is never
 * re-created (see `storeAuth`), so a later reload requires a fresh login.
 */
export function getStoredAuth(): AuthSession | null {
  const sessionStore = getSessionStorage();
  const persisted = readSessionFromStore(sessionStore);
  if (persisted) {
    memoryAuthSession = persisted;
    // A plaintext legacy copy is obsolete once the tab has its own entry.
    removeLegacyAuthEntry();
    return persisted;
  }

  if (memoryAuthSession) return memoryAuthSession;

  const legacyStore = getLocalStorage();
  const legacy = readSessionFromStore(legacyStore);
  if (!legacy) return null;

  memoryAuthSession = legacy;
  try {
    sessionStore?.setItem(AUTH_STORAGE_KEY, JSON.stringify(legacy));
  } catch {
    // sessionStorage unavailable/read-only: this tab keeps the in-memory
    // session only and will ask for a login after a reload.
  }
  try {
    legacyStore?.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Best effort: the entry cannot be re-created, and clearAuth retries.
  }
  return legacy;
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
 * Store the auth session for the current tab.
 *
 * SEC-06: `sessionStorage` is used when it accepts the write; otherwise the
 * session lives only in this module's memory and is discarded on reload. There
 * is deliberately no `localStorage` fallback — the plaintext password must not
 * survive the tab.
 */
export function storeAuth(session: AuthSession): void {
  const sanitized = sanitizeAuthSession(session) ?? session;
  memoryAuthSession = sanitized;

  const sessionStore = getSessionStorage();
  if (sessionStore) {
    try {
      sessionStore.setItem(AUTH_STORAGE_KEY, JSON.stringify(sanitized));
    } catch (err) {
      // Keep the login usable for this tab, but make sure an older tab-local
      // entry cannot shadow the newer in-memory session on the next read.
      console.warn(
        "sessionStorage rejected the auth session; keeping it in memory only (a reload requires a new login):",
        err,
      );
      try {
        sessionStore.removeItem(AUTH_STORAGE_KEY);
      } catch {
        // Storage is read-only: the in-memory session is all we have.
      }
    }
  }

  // A leftover plaintext entry from a build that still wrote one is removed,
  // never refreshed.
  removeLegacyAuthEntry();
  notifyAuthChanged();
}

/**
 * Clear auth session from memory and from the tab's storage (including a
 * legacy `localStorage` entry).
 */
export function clearAuth(): void {
  memoryAuthSession = null;
  try {
    getSessionStorage()?.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Storage may be unavailable or read-only.
  }
  try {
    getLocalStorage()?.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Storage may be unavailable or read-only.
  }
  notifyAuthChanged();
}

/**
 * Drop the administrator session token while keeping the user session.
 *
 * The administrator session expires after eight hours. When the Worker
 * rejects a privileged call with 403 the client must not keep presenting the
 * dead token: the administrator surface has to ask for a fresh login, while
 * the user's own session (and the access password it carries) stays usable.
 */
export function clearAdminSession(): void {
  const current = memoryAuthSession ?? getStoredAuth();
  if (!current || !current.adminToken) return;
  const next: AuthSession = { ...current };
  delete next.adminToken;
  memoryAuthSession = next;
  const sessionStore = getSessionStorage();
  if (sessionStore) {
    try {
      sessionStore.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The in-memory session is authoritative for this tab.
    }
  }
  notifyAuthChanged();
}

/**
 * Returns HTTP headers for authenticated requests.
 *
 * `x-admin-session` is the credential every `/api/admin/*` endpoint requires
 * (SEC-01). `x-auth-password`/`x-admin-key` are still sent for backward
 * compatibility with endpoints and deployments that have not migrated yet; the
 * Worker ignores them for privileged paths.
 */
export function getAuthHeaders(session?: AuthSession | null): Record<string, string> {
  const current = session || getStoredAuth();
  if (!current?.password) return {};
  const headers: Record<string, string> = { "x-auth-password": current.password };
  if (current.role === "admin") {
    headers["x-admin-key"] = current.password;
    const adminToken = sanitizeAdminToken(current.adminToken);
    if (adminToken) headers["x-admin-session"] = adminToken;
  }
  return headers;
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

/** Turnstile test site key; used whenever the Worker cannot be reached. */
const DEFAULT_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";

/**
 * Validate the lockout block of `/api/auth/turnstile-config`.
 *
 * A malformed block must not be trusted: it drives the administrator form's
 * disabled state (UI-06), so a garbage value would either lock the form
 * forever or throw while rendering. Anything unexpected is treated as "no
 * lockout reported" — the Worker still enforces the lock server-side.
 */
function sanitizeAdminLockout(
  raw: unknown,
): { locked: boolean; remainingSeconds: number; remainingAttempts: number } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.locked !== "boolean") return undefined;
  if (typeof record.remainingSeconds !== "number" || !Number.isFinite(record.remainingSeconds)) {
    return undefined;
  }
  if (typeof record.remainingAttempts !== "number" || !Number.isFinite(record.remainingAttempts)) {
    return undefined;
  }
  return {
    locked: record.locked,
    remainingSeconds: record.remainingSeconds,
    remainingAttempts: record.remainingAttempts,
  };
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
      return { siteKey: DEFAULT_TURNSTILE_SITE_KEY };
    }
    // UI-38: a non-JSON body must not throw (the catch below would hide the
    // configuration) and the payload is validated field by field.
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const siteKey =
      typeof data.siteKey === "string" && data.siteKey.trim()
        ? data.siteKey
        : DEFAULT_TURNSTILE_SITE_KEY;
    return { siteKey, lockout: sanitizeAdminLockout(data.lockout) };
  } catch (e) {
    console.warn("Failed to fetch Turnstile config:", e);
    return { siteKey: DEFAULT_TURNSTILE_SITE_KEY };
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

    // SEC-01: without the session token the admin surface cannot work — every
    // `/api/admin/*` call would be rejected — so report it instead of
    // rendering a console that fails on every action.
    const adminToken = sanitizeAdminToken(data.adminToken);
    if (!adminToken) {
      return {
        ok: false,
        error:
          "管理者セッションを取得できませんでした。通信状態を確認して、もう一度管理者ログインしてください",
      };
    }

    const session: AuthSession = {
      role: "admin",
      name: typeof data.name === "string" ? data.name : "管理者",
      password: trimmedPwd,
      maxStocks: null,
      maxIndices: null,
      id: typeof data.id === "string" ? data.id : "admin-master",
      adminToken,
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

/**
 * Extract a displayable message from an API error body.
 *
 * UI-38: an error response may be `{error}`, `{ok:false,error}` or a non-JSON
 * gateway/500 page. The last case must never throw and must still tell the
 * operator what to do next.
 */
export function readApiErrorMessage(payload: unknown, status: number, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message = (payload as Record<string, unknown>).error;
    if (typeof message === "string" && message.trim()) return message;
  }
  const detail = status > 0 ? ` (HTTP ${status})` : "";
  return `${fallback}${detail}。通信状態を確認して再試行してください。`;
}

/**
 * Validate one row of `GET /api/admin/passwords` before it is typed.
 *
 * UI-16: the previous `Array.isArray(data) ? data : []` accepted any shape, so
 * a malformed row reached the table and, from there, `PUT`/`DELETE
 * /api/admin/passwords` with an `undefined` id. Every field the UI reads is
 * checked; a row that does not match is dropped instead of rendered.
 */
function sanitizeUserPasswordItem(raw: unknown): UserPasswordItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return null;

  if (typeof record.name !== "string") return null;
  const name = record.name.trim();

  const role = record.role === "admin" || record.role === "user" ? record.role : null;
  if (!role) return null;

  // `undefined` means "invalid" (drop the row), `null` means "no limit".
  const readLimit = (value: unknown): number | null | undefined => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
    return value;
  };

  const maxStocks = readLimit(record.max_stocks);
  if (maxStocks === undefined) return null;
  const maxIndices = readLimit(record.max_indices);
  if (maxIndices === undefined) return null;

  const isActive = record.is_active;
  if (isActive !== 0 && isActive !== 1) return null;

  const createdAt = record.created_at;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt < 0) return null;

  const item: UserPasswordItem = {
    id,
    name,
    role,
    max_stocks: maxStocks,
    max_indices: maxIndices,
    is_active: isActive,
    created_at: createdAt,
  };
  const updatedAt = record.updated_at;
  if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) {
    item.updated_at = updatedAt;
  }
  return item;
}

/**
 * Sanitize the administrator password list.
 *
 * Returns `null` when the payload is not a list at all (the caller must then
 * report a malformed response instead of rendering "no accounts issued"), and
 * the valid rows — possibly none — otherwise.
 */
export function sanitizeUserPasswordList(raw: unknown): UserPasswordItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: UserPasswordItem[] = [];
  for (const row of raw) {
    const item = sanitizeUserPasswordItem(row);
    if (item) items.push(item);
  }
  return items;
}
