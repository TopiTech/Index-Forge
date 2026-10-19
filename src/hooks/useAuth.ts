import { useState, useCallback, useEffect } from "react";
import type { AuthSession } from "../types";
import { getStoredAuth, clearAuth, verifyPassword, adminLogin, getAuthHeaders } from "../lib/auth";

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

  const login = useCallback(async (password: string): Promise<{ ok: boolean; error?: string }> => {
    setLoading(true);
    try {
      const res = await verifyPassword(password);
      if (res.ok && res.session) {
        setSession(res.session);
        return { ok: true };
      }
      return { ok: false, error: res.error || "認証に失敗しました" };
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAdminLogin = useCallback(
    async (
      password: string,
      secretCode: string,
      turnstileToken: string,
    ): Promise<{
      ok: boolean;
      error?: string;
      locked?: boolean;
      remainingSeconds?: number;
      remainingAttempts?: number;
    }> => {
      setLoading(true);
      try {
        const res = await adminLogin(password, secretCode, turnstileToken);
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
        setLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(() => {
    clearAuth();
    setSession(null);
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
