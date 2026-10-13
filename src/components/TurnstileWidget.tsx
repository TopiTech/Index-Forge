import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";
import { ShieldCheck, RefreshCw, AlertCircle } from "lucide-react";

export interface TurnstileWidgetRef {
  reset: () => void;
}

interface TurnstileWidgetProps {
  siteKey: string;
  onVerify: (token: string) => void;
  onError?: (error?: string) => void;
  onExpire?: () => void;
  theme?: "auto" | "light" | "dark";
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        params: {
          sitekey: string;
          theme?: "auto" | "light" | "dark";
          callback?: (token: string) => void;
          "error-callback"?: (error?: string) => void;
          "expired-callback"?: () => void;
          "timeout-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    onloadTurnstileCallback?: () => void;
  }
}

let turnstileScriptLoading = false;
let turnstileScriptLoaded = false;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (turnstileScriptLoaded && window.turnstile) return Promise.resolve();

  return new Promise((resolve) => {
    if (window.turnstile) {
      turnstileScriptLoaded = true;
      resolve();
      return;
    }

    if (turnstileScriptLoading) {
      const interval = setInterval(() => {
        if (window.turnstile) {
          clearInterval(interval);
          turnstileScriptLoaded = true;
          resolve();
        }
      }, 50);
      return;
    }

    turnstileScriptLoading = true;
    window.onloadTurnstileCallback = () => {
      turnstileScriptLoaded = true;
      resolve();
    };

    const existingScript = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback&render=explicit";
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        turnstileScriptLoading = false;
        resolve(); // Continue gracefully without hanging
      };
      document.head.appendChild(script);
    }
  });
}

export const TurnstileWidget = forwardRef<TurnstileWidgetRef, TurnstileWidgetProps>(
  ({ siteKey, onVerify, onError, onExpire, theme = "dark" }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const onVerifyRef = useRef(onVerify);
    const onErrorRef = useRef(onError);
    const onExpireRef = useRef(onExpire);

    useEffect(() => {
      onVerifyRef.current = onVerify;
      onErrorRef.current = onError;
      onExpireRef.current = onExpire;
    });

    const resetWidget = () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current);
        } catch (e) {
          console.warn("Failed to reset Turnstile widget:", e);
        }
      }
    };

    useImperativeHandle(ref, () => ({
      reset: resetWidget,
    }));

    useEffect(() => {
      let isMounted = true;

      loadTurnstileScript()
        .then(() => {
          if (!isMounted || !containerRef.current || !window.turnstile) {
            if (isMounted && !window.turnstile) {
              setLoadError("セキュリティ認証の読み込みに失敗しました");
            }
            return;
          }

          try {
            // Clean up previous widget if exists
            if (widgetIdRef.current) {
              try {
                window.turnstile.remove(widgetIdRef.current);
              } catch {
                // Ignore removal errors
              }
              widgetIdRef.current = null;
            }

            containerRef.current.innerHTML = "";
            const id = window.turnstile.render(containerRef.current, {
              sitekey: siteKey,
              theme,
              callback: (token: string) => {
                if (!isMounted) return;
                setLoadError(null);
                onVerifyRef.current(token);
              },
              "error-callback": (err?: string) => {
                if (!isMounted) return;
                setLoadError("認証エラーが発生しました。再試行してください。");
                if (onErrorRef.current) onErrorRef.current(err);
              },
              "expired-callback": () => {
                if (!isMounted) return;
                if (onExpireRef.current) onExpireRef.current();
              },
              "timeout-callback": () => {
                if (!isMounted) return;
                resetWidget();
              },
            });
            widgetIdRef.current = id;
          } catch (renderError) {
            console.error("Turnstile render error:", renderError);
            if (isMounted) {
              setLoadError("Turnstileウィジェットの描画に失敗しました");
            }
          }
        })
        .catch((err) => {
          if (isMounted) {
            setLoadError("認証サービスの接続に失敗しました");
            console.error(err);
          }
        });

      return () => {
        isMounted = false;
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            // Ignore clean up error
          }
          widgetIdRef.current = null;
        }
      };
    }, [siteKey, theme]);

    return (
      <div
        className="turnstile-wrapper"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 70,
          background: "rgba(15, 23, 42, 0.4)",
          border: "1px dashed var(--border-subtle, rgba(255, 255, 255, 0.15))",
          borderRadius: 8,
          padding: "10px 14px",
          marginTop: 12,
          marginBottom: 16,
          position: "relative",
        }}
      >
        <div
          ref={containerRef}
          style={{
            display: "flex",
            justifyContent: "center",
            width: "100%",
            minHeight: 65,
          }}
        />

        {loadError && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "var(--neon-red, #ff3366)",
              fontSize: 12,
              marginTop: 6,
            }}
          >
            <AlertCircle size={14} />
            <span>{loadError}</span>
            <button
              type="button"
              onClick={resetWidget}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--accent-text, #38bdf8)",
                cursor: "pointer",
                padding: "2px 4px",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
              }}
            >
              <RefreshCw size={12} />
              再試行
            </button>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--text-muted, #94a3b8)",
            marginTop: 4,
          }}
        >
          <ShieldCheck size={12} style={{ color: "var(--neon-cyan, #00ffff)" }} />
          <span>Cloudflare Turnstile による人間認証</span>
        </div>
      </div>
    );
  },
);

TurnstileWidget.displayName = "TurnstileWidget";
