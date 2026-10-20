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

  useEffect(() => {
    onExpireRef.current = options?.onExpire;
  });

  useEffect(() => {
    if (!isLocked) return;
    // Pure updater: the unlock lives in the effect below, so React's purity
    // contract holds under StrictMode double-invocation.
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [isLocked]);

  useEffect(() => {
    if (!isLocked || remainingSeconds > 0) return;
    setIsLocked(false);
    onExpireRef.current?.();
  }, [isLocked, remainingSeconds]);

  const syncLockout = useCallback((locked: boolean, seconds: number) => {
    setRemainingSeconds(normalizeSeconds(seconds));
    setIsLocked(locked);
  }, []);

  const clearLockout = useCallback(() => {
    setIsLocked(false);
    setRemainingSeconds(0);
  }, []);

  return { isLocked, remainingSeconds, syncLockout, clearLockout };
}
