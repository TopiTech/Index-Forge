import React, { useRef, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, X, AlertCircle } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useModalFocus } from "../hooks/useModalFocus";

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
  title = "パスワード認証",
  description = "銘柄の追加・削除や指数の編集を行うには、パスワードを入力してください。",
}: AuthModalProps) {
  const { login, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const handleClose = () => {
    if (!loading) onClose();
  };
  useModalFocus(isOpen, dialogRef, handleClose, passwordInputRef);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("パスワードを入力してください");
      return;
    }

    setError(null);
    const res = await login(password.trim());
    if (res.ok) {
      setPassword("");
      if (onSuccess) onSuccess();
      onClose();
    } else {
      setError(res.error || "パスワードが正しくありません");
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal-overlay)" as unknown as number,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--surface-overlay)",
        backdropFilter: "blur(8px)",
        padding: 16,
      }}
    >
      <motion.div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        aria-describedby="auth-modal-description"
        data-modal-dialog
        ref={dialogRef}
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        style={{
          width: "100%",
          maxWidth: 440,
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-cyan)",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.8), 0 0 30px rgba(0,229,255,0.2)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="row space-between"
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "linear-gradient(90deg, var(--accent-subtle), transparent)",
          }}
        >
          <div className="row" style={{ gap: 8 }}>
            <KeyRound size={18} style={{ color: "var(--accent-text)" }} />
            <h2 id="auth-modal-title" style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>{title}</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            aria-label="閉じる"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 22px" }}>
          <p id="auth-modal-description" className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
            {description}
          </p>

          {error && (
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

          <div style={{ marginBottom: 18 }}>
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
              アクセスパスワード
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="auth-modal-password-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="ユーザーパスワードまたは管理者パスワード"
                ref={passwordInputRef}
                autoComplete="current-password"
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
                }}
              >
                {showPassword ? "隠す" : "表示"}
              </button>
            </div>
            <div id="auth-modal-hint" className="muted tiny" style={{ marginTop: 6 }}>
              ※ 管理者パスワードまたは管理者が作成したユーザーパスワードを入力してください
            </div>
          </div>

          <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={handleClose}
              className="btn btn-sm btn-outline"
              disabled={loading}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="btn btn-sm btn-default"
              disabled={loading || !password.trim()}
              style={{ minWidth: 100 }}
            >
              {loading ? "認証中..." : "ロック解除"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
