import React, { useRef, useState } from "react";
import { KeyRound, AlertCircle } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { ModalBase } from "./ModalBase";

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
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (!loading) onClose();
  };

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
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      icon={<KeyRound size={18} style={{ color: "var(--accent-text)" }} />}
      maxWidth={440}
      initialFocusRef={passwordInputRef}
      ariaDescribedBy="auth-modal-description"
    >
      <form onSubmit={handleSubmit} style={{ padding: "4px 0" }}>
        <p
          id="auth-modal-description"
          className="muted"
          style={{ fontSize: 13, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}
        >
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

        <div className="row" style={{ gap: 10, justifyContent: "flex-end", paddingTop: 8 }}>
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
    </ModalBase>
  );
}
