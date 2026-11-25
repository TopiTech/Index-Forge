import { useEffect, useRef, useState } from "react";
import { getTurnstileConfig, turnstileFallbackSiteKey } from "../lib/auth";

export interface TurnstileConfigLockout {
  locked: boolean;
  remainingSeconds: number;
  remainingAttempts: number;
}

export interface UseTurnstileConfigOptions {
  /** Fetch Turnstile configuration only when the login surface is active. */
  enabled: boolean;
  /** Called when the server explicitly reports Turnstile configuration is unavailable. */
  onUnavailable?: () => void;
  /** Called when the response includes administrator lockout status. */
  onLockout?: (lockout: TurnstileConfigLockout) => void;
}

export interface UseTurnstileConfigResult {
  siteKey: string;
  loading: boolean;
}

function getCurrentHostname(): string {
  return typeof window === "undefined" ? "" : window.location.hostname;
}

/**
 * Loads Cloudflare Turnstile configuration while keeping local-only test site
 * keys confined to local hosts and failing closed on non-local origins.
 */
export function useTurnstileConfig({
  enabled,
  onUnavailable,
  onLockout,
}: UseTurnstileConfigOptions): UseTurnstileConfigResult {
  const [siteKey, setSiteKey] = useState(() => turnstileFallbackSiteKey(getCurrentHostname()));
  const [loading, setLoading] = useState(() => !turnstileFallbackSiteKey(getCurrentHostname()));

  const onUnavailableRef = useRef(onUnavailable);
  const onLockoutRef = useRef(onLockout);
  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
    onLockoutRef.current = onLockout;
  });

  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;
    getTurnstileConfig()
      .then((cfg) => {
        if (!isMounted) return;
        setLoading(false);
        if (cfg.siteKey) {
          setSiteKey(cfg.siteKey);
        } else {
          setSiteKey("");
          if (cfg.unavailable) {
            onUnavailableRef.current?.();
          }
        }
        if (cfg.lockout) {
          onLockoutRef.current?.(cfg.lockout);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setLoading(false);
        const fallback = turnstileFallbackSiteKey(getCurrentHostname());
        setSiteKey(fallback);
      });

    return () => {
      isMounted = false;
    };
  }, [enabled]);

  return { siteKey, loading };
}
