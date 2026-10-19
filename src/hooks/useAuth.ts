import { useState, useCallback, useEffect } from "react";
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

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredAuth());
  const [loading, setLoading] = useState(false);

  // Sync with localStorage and cross-component/cross-tab events
  useEffect(() => {
    const syncSession = () => {
      const current = getStoredAuth();
      setSession((prev) => {
        if (!prev && !current) return prev;
        if (
          prev &&
          current &&
          prev.id === current.id &&
          prev.password === current.password &&
          prev.role === current.role &&
          prev.maxStocks === current.maxStocks &&
          prev.maxIndices === current.maxIndices &&
          prev.name === current.name
        ) {
          return prev;
        }
        return current;
      });
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

  const login = useCallback(async (password: string): Promise<AuthAttemptResult> => {
    // The attempt identity is module scoped: the logout that supersedes it
    // can be performed by a different `useAuth()` instance.
    const { requestId, controller } = beginAuthAttempt();
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
      if (isCurrentAuthAttempt(requestId)) {
        setLoading(false);
      }
    }
  }, []);

  const handleAdminLogin = useCallback(
    async (
      password: string,
      secretCode: string,
      turnstileToken: string,
    ): Promise<AuthAttemptResult> => {
      const { requestId, controller } = beginAuthAttempt();
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
        if (isCurrentAuthAttempt(requestId)) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const logout = useCallback(() => {
    // A login that is still in flight must not re-authenticate the user after
    // they logged out. The attempt is tracked globally, so the cancellation
    // also covers a login that was started by another component.
    cancelPendingAuthAttempt();
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
