import React, { useRef, useState, useMemo } from "react";
import { Plus, AlertCircle, Sparkles } from "lucide-react";
import type { BasketItem } from "../types";
import { searchPopularStocks, PRESET_STOCKS } from "../data/popularStocks";
import { toFiniteNumberOr } from "../lib/downloadFileName";
import { ModalBase } from "./ModalBase";

interface AddStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  indexName: string;
  currentCount: number;
  maxStocks: number | null;
  onAddStock: (stock: BasketItem) => Promise<{ ok: boolean; error?: string }>;
}

export function AddStockModal({
  isOpen,
  onClose,
  indexName,
  currentCount,
  maxStocks,
  onAddStock,
}: AddStockModalProps) {
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [theme, setTheme] = useState("");
  const [weight, setWeight] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickerInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (!loading) onClose();
  };

  const popularSuggestions = useMemo(() => {
    const query = ticker || name;
    if (!query.trim() || query.trim().length < 1) return [];
    return searchPopularStocks(query, 4);
  }, [ticker, name]);

  const isLimitReached = maxStocks !== null && maxStocks > 0 && currentCount >= maxStocks;

  const handleSelectPreset = (p: { ticker: string; name: string; theme: string }) => {
    setTicker(p.ticker);
    setName(p.name);
    setTheme(p.theme);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLimitReached) {
      setError(`このパスワードの上限（最大${maxStocks}銘柄）に達しているため、追加できません`);
      return;
    }

    const cleanTicker = ticker.trim().toUpperCase();
    const cleanName = name.trim();
    if (!cleanTicker || !cleanName) {
      setError("銘柄コードと銘柄名は必須です");
      return;
    }

    if (!/^[A-Za-z0-9.-]+$/.test(cleanTicker) || cleanTicker.length > 20) {
      setError("銘柄コードは英数字、ハイフン、ピリオド（最大20文字）で入力してください (例: 7203, AAPL)");
      return;
    }

    if (cleanName.length > 100) {
      setError("銘柄名は100文字以内で入力してください");
      return;
    }

    if (theme.trim().length > 100) {
      setError("テーマ・業種は100文字以内で入力してください");
      return;
    }

    const numericWeight = Number(weight);
    if (!Number.isFinite(numericWeight) || numericWeight <= 0 || numericWeight > 100) {
      setError("構成比率は0.1%から100%の間で入力してください");
      return;
    }

    setLoading(true);
    setError(null);
    const res = await onAddStock({
      ticker: cleanTicker,
      name: cleanName,
      theme: theme.trim() || "カスタム",
      weight: numericWeight,
    });
    setLoading(false);

    if (res.ok) {
      setTicker("");
      setName("");
      setTheme("");
      setWeight(10);
      onClose();
    } else {
      setError(res.error || "銘柄の追加に失敗しました");
    }
  };

  const modalFooter = (
    <div className="row space-between flex-wrap" style={{ width: "100%", gap: 10, alignItems: "center" }}>
      <div className="muted tiny">
        ※ 追加後はD1データベースに即座に同期・保存されます
      </div>
      <div className="row" style={{ gap: 10 }}>
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
          form="add-stock-form"
          className="btn btn-sm btn-default"
          disabled={loading || isLimitReached || !ticker.trim() || !name.trim()}
          style={{ minWidth: 100 }}
        >
          {loading ? "追加中..." : "銘柄を追加"}
        </button>
      </div>
    </div>
  );

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      title="構成銘柄の追加"
      subtitle={<span id="add-stock-modal-description">対象指数: {indexName}</span>}
      ariaDescribedBy="add-stock-modal-description"
      icon={<Plus size={18} style={{ color: "var(--accent-text)" }} />}
      maxWidth={620}
      initialFocusRef={tickerInputRef}
      footer={modalFooter}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Stock Limit Meter */}
        <div
          style={{
            padding: "10px 14px",
            background: isLimitReached ? "rgba(255, 51, 102, 0.1)" : "var(--accent-subtle)",
            border: `1px solid ${isLimitReached ? "var(--neon-red)" : "var(--border-subtle)"}`,
            borderRadius: 8,
          }}
        >
          <div className="row space-between" style={{ fontSize: 12 }}>
            <span style={{ fontWeight: 600, color: isLimitReached ? "var(--neon-red)" : "var(--accent-text)" }}>
              銘柄登録状況
            </span>
            <span className="mono">
              {currentCount} / {maxStocks ? `${maxStocks} 銘柄` : "無制限"}
            </span>
          </div>
          {isLimitReached && (
            <div style={{ fontSize: 12, color: "var(--neon-red)", marginTop: 4 }}>
              ⚠️ 現在のパスワードで許可されている銘柄数上限 ({maxStocks}銘柄) に達しています。追加するには既存銘柄を削除するか管理者にお問い合わせください。
            </div>
          )}
        </div>

        {error && (
          <div
            id="add-stock-modal-error"
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
            }}
          >
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Quick presets */}
        <div>
          <div className="row" style={{ gap: 6, marginBottom: 8, fontSize: 12, color: "var(--text-secondary)" }}>
            <Sparkles size={13} style={{ color: "var(--accent-text)" }} />
            <span>プリセット銘柄から選択:</span>
          </div>
          <div className="row flex-wrap" style={{ gap: 6, maxHeight: 110, overflowY: "auto" }}>
            {PRESET_STOCKS.map((p) => (
              <button
                key={p.ticker}
                type="button"
                onClick={() => handleSelectPreset(p)}
                disabled={isLimitReached}
                style={{
                  padding: "4px 8px",
                  background: ticker === p.ticker ? "var(--surface-selection)" : "var(--surface-inset)",
                  border: `1px solid ${ticker === p.ticker ? "var(--accent-border)" : "var(--border-subtle)"}`,
                  borderRadius: 6,
                  color: ticker === p.ticker ? "var(--text-on-selection)" : "var(--text-secondary)",
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span className="mono" style={{ color: "var(--accent-text)" }}>{p.ticker}</span>
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Custom Input Form */}
        <form onSubmit={handleSubmit} id="add-stock-form">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label htmlFor="add-stock-ticker" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                銘柄コード <span style={{ color: "var(--neon-red)" }}>*</span>
              </label>
              <input
                id="add-stock-ticker"
                ref={tickerInputRef}
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="例: 7203, AAPL"
                disabled={isLimitReached}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "add-stock-modal-error" : undefined}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  color: "var(--text-primary)",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label htmlFor="add-stock-name" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                銘柄名 <span style={{ color: "var(--neon-red)" }}>*</span>
              </label>
              <input
                id="add-stock-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: トヨタ自動車"
                disabled={isLimitReached}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  color: "var(--text-primary)",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          {/* Incremental suggestions if typing */}
          {popularSuggestions.length > 0 && (
            <div className="row flex-wrap" style={{ gap: 6, alignItems: "center", marginBottom: 14 }}>
              <span className="mono tiny muted" style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 3 }}>
                <Sparkles size={11} style={{ color: "var(--accent-text)" }} /> 候補補完:
              </span>
              {popularSuggestions.map((s) => (
                <button
                  key={s.ticker}
                  type="button"
                  onClick={() => handleSelectPreset(s)}
                  className="tag tag-muted"
                  style={{
                    cursor: "pointer",
                    fontSize: 10,
                    padding: "2px 6px",
                    background: "var(--accent-subtle)",
                    border: "1px solid var(--accent-border)",
                    color: "var(--text-primary)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                  title="クリックして自動入力"
                >
                  <strong style={{ color: "var(--accent-text)" }}>{s.ticker}</strong>
                  <span>{s.name}</span>
                  <span className="muted" style={{ fontSize: 9 }}>({s.theme})</span>
                </button>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <div>
              <label htmlFor="add-stock-theme" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                テーマ / セクター
              </label>
              <input
                id="add-stock-theme"
                type="text"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="例: EV・モビリティ"
                disabled={isLimitReached}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  color: "var(--text-primary)",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label htmlFor="add-stock-weight" style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                構成比率 (重み)
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="add-stock-weight"
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.5"
                  value={weight}
                  onChange={(e) => setWeight(toFiniteNumberOr(e.target.value, 10))}
                  disabled={isLimitReached}
                  style={{
                    width: "100%",
                    padding: "8px 24px 8px 10px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    color: "var(--text-primary)",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
                <span style={{ position: "absolute", right: 8, top: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                  %
                </span>
              </div>
            </div>
          </div>
        </form>
      </div>
    </ModalBase>
  );
}
