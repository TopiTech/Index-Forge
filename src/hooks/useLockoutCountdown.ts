import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Owns the "temporarily locked out until N seconds from now" state that the
 * auth surfaces share.
 *
 * One owner matters for two reasons:
 * - the interval must not depend on the value it decrements (that recreates
 *   the timer every tick and makes the advertised time drift);
 * - every surface (admin login, auth modal, inline portfolio auth) must apply
 *   the same expiry rule, otherwise they disagree about when the lock ends.
 */

export interface LockoutCountdownOptions {
  /** Runs once when the countdown reaches zero (e.g. clear the lockout error). */
  onExpire?: () => void;
}

export interface LockoutCountdown {
  isLocked: boolean;
  remainingSeconds: number;
  /** Applies a lockout state reported by the server. */
  syncLockout: (locked: boolean, seconds: number) => void;
  /** Releases the lock immediately. */
  clearLockout: () => void;
}

function normalizeSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

export function useLockoutCountdown(options?: LockoutCountdownOptions): LockoutCountdown {
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const onExpireRef = useRef(options?.onExpire);
  const expiresAtRef = useRef<number | null>(null);

  useEffect(() => {
    onExpireRef.current = options?.onExpire;
  });

  useEffect(() => {
    if (!isLocked) return;

    const tick = () => {
      if (expiresAtRef.current === null) return;
      const remaining = Math.max(0, Math.ceil((expiresAtRef.current - Date.now()) / 1000));
      setRemainingSeconds(remaining);
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") {
        return;
      }
      tick();
    };

    const timer = setInterval(tick, 1000);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    return () => {
      clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [isLocked]);

  useEffect(() => {
    if (!isLocked || remainingSeconds > 0) return;
    expiresAtRef.current = null;
    setIsLocked(false);
    onExpireRef.current?.();
  }, [isLocked, remainingSeconds]);

  const syncLockout = useCallback((locked: boolean, seconds: number) => {
    const norm = normalizeSeconds(seconds);
    if (locked && norm > 0) {
      expiresAtRef.current = Date.now() + norm * 1000;
      setRemainingSeconds(norm);
      setIsLocked(true);
    } else {
      expiresAtRef.current = null;
      setRemainingSeconds(0);
      setIsLocked(false);
    }
  }, []);

  const clearLockout = useCallback(() => {
    expiresAtRef.current = null;
    setIsLocked(false);
    setRemainingSeconds(0);
  }, []);

  return { isLocked, remainingSeconds, syncLockout, clearLockout };
}
