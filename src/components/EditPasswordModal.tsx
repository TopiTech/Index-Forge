import React, { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Sliders, X, AlertCircle, Sparkles } from "lucide-react";
import type { UserPasswordItem } from "../types";
import { useModalFocus } from "../hooks/useModalFocus";
import { generateSecurePassword } from "../lib/auth";

interface EditPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: UserPasswordItem | null;
  onSuccess: () => void;
  getHeaders: () => Record<string, string>;
}

export function EditPasswordModal({
  isOpen,
  onClose,
  item,
  onSuccess,
  getHeaders,
}: EditPasswordModalProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [unlimitedStocks, setUnlimitedStocks] = useState(false);
  const [maxStocks, setMaxStocks] = useState<number>(10);
  const [unlimitedIndices, setUnlimitedIndices] = useState(true);
  const [maxIndices, setMaxIndices] = useState<number>(5);
  const [newPassword, setNewPassword] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const handleClose = () => {
    if (!loading) onClose();
  };
  useModalFocus(isOpen, dialogRef, handleClose, nameInputRef);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setRole(item.role === "admin" ? "admin" : "user");
      if (item.max_stocks !== null && item.max_stocks !== undefined) {
        setUnlimitedStocks(false);
        setMaxStocks(item.max_stocks);
      } else {
        setUnlimitedStocks(true);
        setMaxStocks(10);
      }
      if (item.max_indices !== null && item.max_indices !== undefined) {
        setUnlimitedIndices(false);
        setMaxIndices(item.max_indices);
      } else {
        setUnlimitedIndices(true);
        setMaxIndices(5);
      }
      setNewPassword("");
      setIsActive(item.is_active === 1);
      setError(null);
    }
  }, [item, isOpen]);

  if (!isOpen || !item) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("名前を入力してください");
      return;
    }
    if (newPassword.trim() && (newPassword.trim().length < 8 || newPassword.trim().length > 100)) {
      setError("再設定するパスワードは8〜100文字で入力してください");
      return;
    }

    setLoading(true);
    setError(null);

    const isAdminRole = role === "admin";
    const sanitizedMaxStocks = isAdminRole || unlimitedStocks
      ? null
      : Math.min(500, Math.max(1, Math.floor(Number(maxStocks)) || 1));
    const sanitizedMaxIndices = isAdminRole || unlimitedIndices
      ? null
      : Math.min(100, Math.max(1, Math.floor(Number(maxIndices)) || 1));

    try {
      const payload: Record<string, unknown> = {
        id: item.id,
        name: name.trim(),
        role,
        maxStocks: sanitizedMaxStocks,
        maxIndices: sanitizedMaxIndices,
        isActive,
      };
      if (newPassword.trim()) {
        payload.password = newPassword.trim();
      }

      const res = await fetch("/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...getHeaders(),
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSuccess();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `更新に失敗しました (HTTP ${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新処理中にエラーが発生しました");
    } finally {
      setLoading(false);
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
        aria-labelledby="edit-password-modal-title"
        data-modal-dialog
        ref={dialogRef}
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        style={{
          width: "100%",
          maxWidth: 480,
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-cyan)",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.8), 0 0 30px var(--accent-glow)",
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
            <Sliders size={18} style={{ color: "var(--accent-text)" }} />
            <h2 id="edit-password-modal-title" style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>
              パスワード設定の編集
            </h2>
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

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ padding: 20 }}>
          {error && (
            <div
              role="alert"
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: "8px 12px",
                background: "rgba(255, 51, 102, 0.15)",
                border: "1px solid var(--neon-red)",
                borderRadius: 6,
                color: "var(--neon-red)",
                fontSize: 12,
                marginBottom: 16,
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Name */}
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="edit-pw-name"
              style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 5 }}
            >
              アカウント名 / 用途 <span style={{ color: "var(--neon-red)" }}>*</span>
            </label>
            <input
              id="edit-pw-name"
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 山田太郎 / 営業推進チーム"
              required
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "var(--bg-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                color: "var(--text-primary)",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Role */}
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="edit-pw-role"
              style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 5 }}
            >
              権限ロール
            </label>
            <select
              id="edit-pw-role"
              value={role}
              onChange={(e) => {
                const nextRole = e.target.value as "user" | "admin";
                setRole(nextRole);
                if (nextRole === "admin") {
                  setUnlimitedStocks(true);
                  setUnlimitedIndices(true);
                }
              }}
              disabled={item.id === "admin-master"}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "var(--bg-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                color: "var(--text-primary)",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            >
              <option value="user">一般ユーザー（制限付き編集）</option>
              <option value="admin">管理者（全指数フル管理）</option>
            </select>
          </div>

          {/* Stocks Limit */}
          <div style={{ marginBottom: 14 }}>
            <div className="row space-between" style={{ marginBottom: 5 }}>
              <label htmlFor="edit-pw-max-stocks" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                最大銘柄数制限 {role === "admin" && <span style={{ color: "var(--accent-text)", fontSize: 11 }}>(管理者: 無制限)</span>}
              </label>
              <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6, cursor: role === "admin" ? "not-allowed" : "pointer", opacity: role === "admin" ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  checked={role === "admin" || unlimitedStocks}
                  disabled={role === "admin"}
                  onChange={(e) => setUnlimitedStocks(e.target.checked)}
                />
                <span>無制限</span>
              </label>
            </div>
            {role !== "admin" && !unlimitedStocks && (
              <input
                id="edit-pw-max-stocks"
                type="number"
                min={1}
                max={500}
                value={maxStocks}
                onChange={(e) => setMaxStocks(Math.min(500, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  color: "var(--text-primary)",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            )}
          </div>

          {/* Indices Limit */}
          <div style={{ marginBottom: 14 }}>
            <div className="row space-between" style={{ marginBottom: 5 }}>
              <label htmlFor="edit-pw-max-indices" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                作成可能 指数上限数 {role === "admin" && <span style={{ color: "var(--accent-text)", fontSize: 11 }}>(管理者: 無制限)</span>}
              </label>
              <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6, cursor: role === "admin" ? "not-allowed" : "pointer", opacity: role === "admin" ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  checked={role === "admin" || unlimitedIndices}
                  disabled={role === "admin"}
                  onChange={(e) => setUnlimitedIndices(e.target.checked)}
                />
                <span>無制限</span>
              </label>
            </div>
            {role !== "admin" && !unlimitedIndices && (
              <input
                id="edit-pw-max-indices"
                type="number"
                min={1}
                max={100}
                value={maxIndices}
                onChange={(e) => setMaxIndices(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  color: "var(--text-primary)",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            )}
          </div>

          {/* Password Reset (Optional) */}
          <div style={{ marginBottom: 14 }}>
            <div className="row space-between" style={{ marginBottom: 5 }}>
              <label htmlFor="edit-pw-secret" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                パスワード再設定 <span className="muted tiny">（変更する場合のみ入力）</span>
              </label>
              <button
                type="button"
                onClick={() => setNewPassword(generateSecurePassword(12))}
                className="btn btn-sm btn-outline"
                style={{ padding: "2px 6px", fontSize: 11 }}
              >
                <Sparkles size={11} /> 生成
              </button>
            </div>
            <input
              id="edit-pw-secret"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="新しいパスワード（8文字以上）"
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "var(--bg-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                color: "var(--text-primary)",
                fontSize: 13,
                boxSizing: "border-box",
                fontFamily: "monospace",
              }}
            />
          </div>

          {/* Active Status */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={isActive}
                disabled={item.id === "admin-master"}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span style={{ color: isActive ? "var(--neon-green)" : "var(--neon-red)", fontWeight: 600 }}>
                {isActive ? "アカウント有効" : "アカウント一時停止（無効）"}
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={handleClose}
              className="btn btn-sm btn-outline"
              disabled={loading}
              style={{ padding: "8px 16px" }}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="btn btn-sm btn-default"
              disabled={loading}
              style={{ padding: "8px 16px" }}
            >
              {loading ? "保存中..." : "変更を保存"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
