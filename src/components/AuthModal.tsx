import React, { useRef, useState, useEffect } from "react";
import { KeyRound, Shield, AlertCircle, Eye, EyeOff, User, Lock } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useLockoutCountdown } from "../hooks/useLockoutCountdown";
import { ModalBase } from "./ModalBase";
import { TurnstileWidget, type TurnstileWidgetRef } from "./TurnstileWidget";
import { getTurnstileConfig } from "../lib/auth";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  title?: string;
  description?: string;
}

export function AuthModal({
  isOpen,
  onClose,
  onSuccess,
  title = "ログイン認証",
  description = "独自指数の作成や銘柄編集、ポートフォリオ管理を行うにはログインしてください。",
}: AuthModalProps) {
  const { login, adminLogin, loading } = useAuth();

  // Mode: "admin" (default to fulfill Turnstile + Secret Code requirement) or "user"
  const [authMode, setAuthMode] = useState<"admin" | "user">("admin");

  // Fields
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [secretCode, setSecretCode] = useState("");
  const [showSecretCode, setShowSecretCode] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("1x00000000000000000000AA");

  // Lockout / Rate limit info
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    isLocked,
    remainingSeconds: lockoutRemainingSeconds,
    syncLockout,
  } = useLockoutCountdown({ onExpire: () => setError(null) });

  const passwordInputRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<TurnstileWidgetRef>(null);

  // Fetch Turnstile configuration and admin lockout state when opened
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    getTurnstileConfig()
      .then((cfg) => {
        if (!isMounted) return;
        if (cfg.siteKey) {
          setTurnstileSiteKey(cfg.siteKey);
        }
        if (cfg.lockout) {
          syncLockout(cfg.lockout.locked, cfg.lockout.remainingSeconds);
          setRemainingAttempts(cfg.lockout.remainingAttempts);
        }
      })
      .catch(() => {
        // Ignore transient config fetch failures.
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, syncLockout]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || [],
    );
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown")
      nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;

    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  };

  const handleClose = () => {
    if (!loading && !isSubmitting) {
      setError(null);
      setPassword("");
      setSecretCode("");
      setTurnstileToken("");
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (authMode === "admin") {
      // Admin Login flow (Password + Secret Code + Turnstile)
      if (isLocked) {
        setError(`アカウントが一時ロックされています。残り約${Math.ceil(lockoutRemainingSeconds / 60)}分後に再試行してください。`);
        return;
      }
      if (!password.trim()) {
        setError("管理者パスワードを入力してください");
        return;
      }
      if (!secretCode.trim()) {
        setError("秘密の暗号を入力してください（ひらがな・カタカナも入力可能です）");
        return;
      }
      if (!turnstileToken.trim()) {
        setError("Turnstile認証（ロボット確認）を完了してください");
        return;
      }

      setIsSubmitting(true);
      const res = await adminLogin(
        password.trim(),
        secretCode.normalize("NFC").trim(),
        turnstileToken.trim(),
      );
      setIsSubmitting(false);

      if (res.ok) {
        setPassword("");
        setSecretCode("");
        setTurnstileToken("");
        if (onSuccess) onSuccess();
        onClose();
      } else if (res.cancelled) {
        // The attempt was superseded (a newer attempt or a logout). It did
        // not fail, so no error is shown and the solved Turnstile token is
        // kept.
        return;
      } else {
        if (res.locked) {
          syncLockout(true, res.remainingSeconds || 900);
          setRemainingAttempts(0);
        } else if (typeof res.remainingAttempts === "number") {
          setRemainingAttempts(res.remainingAttempts);
        }
        setError(res.error || "管理者認証に失敗しました");
        if (turnstileRef.current) {
          turnstileRef.current.reset();
          setTurnstileToken("");
        }
      }
    } else {
      // General User Login flow (Password only)
      if (!password.trim()) {
        setError("アクセスパスワードを入力してください");
        return;
      }

      setIsSubmitting(true);
      const res = await login(password.trim());
      setIsSubmitting(false);

      if (res.ok) {
        setPassword("");
        if (onSuccess) onSuccess();
        onClose();
      } else if (!res.cancelled) {
        setError(res.error || "パスワードが正しくありません");
      }
    }
  };

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      icon={authMode === "admin" ? <Shield size={18} style={{ color: "var(--neon-cyan)" }} /> : <KeyRound size={18} style={{ color: "var(--accent-text)" }} />}
      maxWidth={460}
      initialFocusRef={passwordInputRef}
      ariaDescribedBy="auth-modal-description"
    >
      <form id="auth-modal-form" onSubmit={handleSubmit} style={{ padding: "4px 0" }}>
        {/* Mode Selector Tabs */}
        <div
          role="tablist"
          aria-label="認証モード切替"
          style={{
            display: "flex",
            gap: 6,
            padding: 4,
            background: "rgba(15, 23, 42, 0.6)",
            borderRadius: 10,
            border: "1px solid var(--border-subtle)",
            marginBottom: 16,
          }}
        >
          <button
            type="button"
            role="tab"
            id="auth-modal-tab-admin"
            aria-selected={authMode === "admin"}
            aria-controls="auth-modal-form"
            tabIndex={authMode === "admin" ? 0 : -1}
            onKeyDown={handleTabKeyDown}
            onClick={() => {
              setAuthMode("admin");
              setError(null);
            }}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              transition: "all 0.15s ease",
              background: authMode === "admin" ? "var(--bg-card-hover, rgba(0, 229, 255, 0.15))" : "transparent",
              color: authMode === "admin" ? "var(--neon-cyan, #00e5ff)" : "var(--text-muted)",
              boxShadow: authMode === "admin" ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
            }}
          >
            <Shield size={14} />
            管理者ログイン
          </button>
          <button
            type="button"
            role="tab"
            id="auth-modal-tab-user"
            aria-selected={authMode === "user"}
            aria-controls="auth-modal-form"
            tabIndex={authMode === "user" ? 0 : -1}
            onKeyDown={handleTabKeyDown}
            onClick={() => {
              setAuthMode("user");
              setError(null);
            }}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              transition: "all 0.15s ease",
              background: authMode === "user" ? "var(--bg-card-hover, rgba(255, 255, 255, 0.1))" : "transparent",
              color: authMode === "user" ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: authMode === "user" ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
            }}
          >
            <User size={14} />
            一般ユーザー
          </button>
        </div>

        <p
          id="auth-modal-description"
          className="muted"
          style={{ fontSize: 13, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}
        >
          {authMode === "admin"
            ? "マスター管理者としてログインします。パスワード、秘密の暗号、Turnstileロボット認証を入力してください。"
            : description}
        </p>

        {/* Lockout Warning */}
        {isLocked && (
          <div
            role="alert"
            aria-live="assertive"
            className="row"
            style={{
              gap: 8,
              padding: "10px 12px",
              background: "rgba(255, 51, 102, 0.2)",
              border: "1px solid var(--neon-red)",
              borderRadius: 8,
              color: "var(--neon-red)",
              fontSize: 12,
              marginBottom: 16,
            }}
          >
            <Lock size={16} style={{ flexShrink: 0 }} />
            <div>
              <strong>セキュリティロック発動中</strong>
              <div style={{ marginTop: 2 }}>
                試行回数の上限に達したため一時ロックされています。
                残り約{Math.ceil(lockoutRemainingSeconds / 60)}分（{lockoutRemainingSeconds}秒）後に再試行できます。
              </div>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && !isLocked && (
          <div
            id="auth-modal-error"
            role="alert"
            aria-live="assertive"
            className="row"
            style={{
              gap: 8,
              padding: "10px 12px",
              background: "rgba(255, 51, 102, 0.15)",
              border: "1px solid var(--neon-red)",
              borderRadius: 8,
              color: "var(--neon-red)",
              fontSize: 12,
              marginBottom: 16,
            }}
          >
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Password input (Common for admin and user) */}
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="auth-modal-password-input"
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-secondary)",
              marginBottom: 6,
            }}
          >
            {authMode === "admin" ? "管理者パスワード" : "アクセスパスワード"} <span style={{ color: "var(--neon-red)" }}>*必須</span>
          </label>
          <div style={{ position: "relative" }}>
            <input
              id="auth-modal-password-input"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={authMode === "admin" ? "管理者パスワード" : "ユーザー用アクセスパスワード"}
              ref={passwordInputRef}
              autoComplete="current-password"
              disabled={isLocked || loading || isSubmitting}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "auth-modal-error auth-modal-hint" : "auth-modal-hint"}
              style={{
                width: "100%",
                padding: "10px 40px 10px 12px",
                background: "var(--bg-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                color: "var(--text-primary)",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              className="password-visibility-btn"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
              aria-pressed={showPassword}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 11,
                padding: "4px",
                display: "flex",
                alignItems: "center",
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div id="auth-modal-hint" className="muted tiny" style={{ marginTop: 6 }}>
            {authMode === "admin"
              ? "※ マスター管理者のパスワードを入力してください"
              : "※ 管理者が発行したユーザーパスワード（アクセスパスワード）を入力してください（管理者の方は「管理者ログイン」タブをご利用ください）"}
          </div>
        </div>

        {/* Admin-only fields: Secret Code + Turnstile */}
        {authMode === "admin" && (
          <>
            {/* Secret Code Input (Hiragana, Katakana, Alpha-numeric supported via IME-enabled text input + WebkitTextSecurity) */}
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="auth-modal-secret-code-input"
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  marginBottom: 6,
                }}
              >
                秘密の暗号 (Admin Secret Code) <span style={{ color: "var(--neon-red)" }}>*必須</span>
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="auth-modal-secret-code-input"
                  type="text"
                  inputMode="text"
                  lang="ja"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  value={secretCode}
                  onChange={(e) => setSecretCode(e.target.value)}
                  placeholder="ひらがな・カタカナ・英数字・記号で入力"
                  disabled={isLocked || loading || isSubmitting}
                  style={{
                    width: "100%",
                    padding: "10px 40px 10px 12px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 14,
                    boxSizing: "border-box",
                    WebkitTextSecurity: showSecretCode ? "none" : "disc",
                  } as React.CSSProperties}
                />
                <button
                  type="button"
                  className="password-visibility-btn"
                  onClick={() => setShowSecretCode(!showSecretCode)}
                  aria-label={showSecretCode ? "秘密の暗号を隠す" : "秘密の暗号を表示"}
                  aria-pressed={showSecretCode}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: 11,
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {showSecretCode ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="muted tiny" style={{ marginTop: 6, lineHeight: 1.4 }}>
                ※ ひらがな・カタカナ・漢字・英数記号も自由に入力できます（全角・半角完全対応）。
                {remainingAttempts !== null && (
                  <span style={{ marginLeft: 6, color: remainingAttempts <= 2 ? "var(--neon-red)" : "inherit" }}>
                    (残り試行可能回数: {remainingAttempts}回)
                  </span>
                )}
              </div>
            </div>

            {/* Cloudflare Turnstile Verification Widget */}
            {!isLocked && (
              <div style={{ marginBottom: 16 }}>
                <span
                  id="auth-modal-turnstile-label"
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: 4,
                  }}
                >
                  ロボット検証 (Turnstile) <span style={{ color: "var(--neon-red)" }}>*必須</span>
                </span>
                <TurnstileWidget
                  ref={turnstileRef}
                  siteKey={turnstileSiteKey}
                  onVerify={(token) => {
                    setTurnstileToken(token);
                    setError(null);
                  }}
                  onError={(err) => {
                    setError(err || "セキュリティ認証エラーが発生しました");
                  }}
                  onExpire={() => {
                    setTurnstileToken("");
                  }}
                />
              </div>
            )}
          </>
        )}

        <div className="row" style={{ gap: 10, justifyContent: "flex-end", paddingTop: 8 }}>
          <button
            type="button"
            onClick={handleClose}
            className="btn btn-sm btn-outline"
            disabled={loading || isSubmitting}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className="btn btn-sm btn-default"
            disabled={
              loading ||
              isSubmitting ||
              isLocked ||
              !password.trim() ||
              (authMode === "admin" && (!secretCode.trim() || !turnstileToken.trim()))
            }
            style={{
              minWidth: 110,
              background: authMode === "admin" ? "var(--neon-cyan, #00e5ff)" : undefined,
              color: authMode === "admin" ? "#0a0e17" : undefined,
              fontWeight: 600,
            }}
          >
            {loading || isSubmitting
              ? "認証中..."
              : authMode === "admin"
              ? "管理者ログイン"
              : "ロック解除"}
          </button>
        </div>
      </form>
    </ModalBase>
  );
}
