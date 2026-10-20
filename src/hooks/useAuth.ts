import { useState, useCallback, useEffect, useRef } from "react";
import type { AuthSession } from "../types";
import {
  getStoredAuth,
  clearAuth,
  verifyPassword,
  adminLogin,
  getAuthHeaders,
  beginAuthAttempt,
  cancelPendingAuthAttempt,
  isCurrentAuthAttempt,
} from "../lib/auth";

/** Result of an authentication attempt. */
export interface AuthAttemptResult {
  ok: boolean;
  error?: string;
  /**
   * True when the attempt was superseded (a newer attempt or a logout) and
   * therefore did not actually fail. The caller must not report it as a
   * wrong password and must not reset the Turnstile widget, whose solved
   * token is still valid.
   */
  cancelled?: boolean;
  locked?: boolean;
  remainingSeconds?: number;
  remainingAttempts?: number;
}

function isSameSession(prev: AuthSession | null, next: AuthSession | null): boolean {
  if (!prev || !next) return prev === next;
  return (
    prev.id === next.id &&
    prev.password === next.password &&
    prev.role === next.role &&
    prev.maxStocks === next.maxStocks &&
    prev.maxIndices === next.maxIndices &&
    prev.name === next.name &&
    prev.adminToken === next.adminToken
  );
}

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredAuth());
  const [loading, setLoading] = useState(false);

  /**
   * Identity of the attempt *this instance* started.
   *
   * The identity of the newest attempt is module scoped (see `lib/auth`),
   * because a logout performed by another instance must be able to supersede
   * this one's login. The busy flag however is per instance and belongs to the
   * attempt it started: when that attempt settles the spinner has to stop even
   * if another instance already superseded it (UI-08), otherwise a losing
   * attempt left its form disabled forever.
   */
  const instanceRequestIdRef = useRef<number | null>(null);

  /**
   * Latest session for `logout()` without re-creating the callback on every
   * session change (consumers keep it in dependency arrays).
   */
  const sessionRef = useRef<AuthSession | null>(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Sync with the module-level session and cross-component/cross-tab events
  useEffect(() => {
    const syncSession = () => {
      const current = getStoredAuth();
      setSession((prev) => (isSameSession(prev, current) ? prev : current));
    };

    if (typeof window !== "undefined") {
      window.addEventListener("auth-changed", syncSession);
      window.addEventListener("storage", syncSession);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("auth-changed", syncSession);
        window.removeEventListener("storage", syncSession);
      }
    };
  }, []);

  /**
   * Clear the busy flag when this instance's own attempt settles.
   *
   * It must NOT be gated on `isCurrentAuthAttempt()`: an attempt that lost the
   * race still has to release the form it disabled (UI-08). Applying the
   * result of a superseded attempt stays gated — see the call sites.
   */
  const settleAttempt = useCallback((requestId: number) => {
    if (instanceRequestIdRef.current !== requestId) return;
    instanceRequestIdRef.current = null;
    setLoading(false);
  }, []);

  const login = useCallback(
    async (password: string): Promise<AuthAttemptResult> => {
      // The attempt identity is module scoped: the logout that supersedes it
      // can be performed by a different `useAuth()` instance.
      const { requestId, controller } = beginAuthAttempt();
      instanceRequestIdRef.current = requestId;
      setLoading(true);
      try {
        const res = await verifyPassword(password, controller.signal);
        if (!isCurrentAuthAttempt(requestId)) {
          // Superseded by a newer attempt or by a logout: the result must not
          // be applied and is not a failure.
          return { ok: false, cancelled: true };
        }
        if (res.ok && res.session) {
          setSession(res.session);
          return { ok: true };
        }
        return { ok: false, error: res.error || "認証に失敗しました" };
      } finally {
        settleAttempt(requestId);
      }
    },
    [settleAttempt],
  );

  const handleAdminLogin = useCallback(
    async (
      password: string,
      secretCode: string,
      turnstileToken: string,
    ): Promise<AuthAttemptResult> => {
      const { requestId, controller } = beginAuthAttempt();
      instanceRequestIdRef.current = requestId;
      setLoading(true);
      try {
        const res = await adminLogin(password, secretCode, turnstileToken, controller.signal);
        if (!isCurrentAuthAttempt(requestId)) {
          return { ok: false, cancelled: true };
        }
        if (res.ok && res.session) {
          setSession(res.session);
          return { ok: true };
        }
        return {
          ok: false,
          error: res.error || "管理者認証に失敗しました",
          locked: res.locked,
          remainingSeconds: res.remainingSeconds,
          remainingAttempts: res.remainingAttempts,
        };
      } finally {
        settleAttempt(requestId);
      }
    },
    [settleAttempt],
  );

  const logout = useCallback(() => {
    // A login that is still in flight must not re-authenticate the user after
    // they logged out. The attempt is tracked globally, so the cancellation
    // also covers a login that was started by another component.
    cancelPendingAuthAttempt();
    instanceRequestIdRef.current = null;

    // SEC-01: revoke the server-side administrator session before dropping the
    // local copy. Best effort: a failed request leaves an expiring session row
    // behind, which is why the local state is cleared synchronously either way
    // (and this must not make logout async).
    const current = sessionRef.current;
    if (current) {
      const headers = getAuthHeaders(current);
      if (Object.keys(headers).length > 0) {
        void fetch("/api/auth/logout", { method: "POST", headers }).catch(() => {});
      }
    }

    clearAuth();
    setSession(null);
    setLoading(false);
  }, []);

  const isAuthenticated = Boolean(session);
  const isAdmin = session?.role === "admin";
  const isUser = session?.role === "user";
  const maxStocks = session?.maxStocks ?? null;
  const maxIndices = session?.maxIndices ?? null;

  const getHeaders = useCallback((): Record<string, string> => {
    return getAuthHeaders(session);
  }, [session]);

  return {
    session,
    isAuthenticated,
    isAdmin,
    isUser,
    maxStocks,
    maxIndices,
    loading,
    login,
    adminLogin: handleAdminLogin,
    logout,
    getHeaders,
  };
}
