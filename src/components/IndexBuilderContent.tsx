import React, { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Trash2,
  Sliders,
  Check,
  RefreshCw,
  KeyRound,
  Sparkles,
  Scale,
  Zap,
  Copy,
  ExternalLink,
} from "lucide-react";
import type { BasketItem } from "../types";
import type { CustomIndex } from "../data/indices";
import { useAuth } from "../hooks/useAuth";
import { AuthModal } from "./AuthModal";
import { useToast } from "./Toast";
import { equalizeWeightsExact, redistributeWeightsExact } from "../lib/indexEngine";
import { searchPopularStocks, PRESET_STOCKS, type PopularStock } from "../data/popularStocks";
import { toFiniteNumberOr } from "../lib/downloadFileName";
import { useSimulation } from "../hooks/useSimulation";
import { SimulationPreview } from "./SimulationPreview";

export interface StrategyPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  stocks: { ticker: string; name: string; theme: string; weight: number }[];
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "ai-semi",
    name: "先端AI・次世代半導体",
    badge: "成長テーマ",
    description: "国内AI投資と半導体製造装置の主要企業で構成",
    stocks: [
      { ticker: "8035", name: "東京エレクトロン", theme: "半導体", weight: 30 },
      { ticker: "6857", name: "アドバンテスト", theme: "半導体検査", weight: 25 },
      { ticker: "9984", name: "ソフトバンクグループ", theme: "AI・投資", weight: 25 },
      { ticker: "3778", name: "さくらインターネット", theme: "クラウド・AI", weight: 20 },
    ],
  },
  {
    id: "dividend-value",
    name: "高配当メガバリュー",
    badge: "安定・好配当",
    description: "メガバンク・総合商社・通信インフラの代表的バリュー株",
    stocks: [
      { ticker: "8306", name: "三菱UFJ FG", theme: "メガバンク", weight: 25 },
      { ticker: "8058", name: "三菱商事", theme: "総合商社", weight: 25 },
      { ticker: "9432", name: "日本電信電話 (NTT)", theme: "通信・IOWN", weight: 25 },
      { ticker: "7203", name: "トヨタ自動車", theme: "モビリティ", weight: 25 },
    ],
  },
  {
    id: "entertainment-ip",
    name: "グローバルIP・エンタメ",
    badge: "IP・ブランド",
    description: "世界に誇るゲーム・IPコンテンツ・FA精密電機",
    stocks: [
      { ticker: "7974", name: "任天堂", theme: "ゲーム・IP", weight: 35 },
      { ticker: "6758", name: "ソニーグループ", theme: "エンタメ・電機", weight: 35 },
      { ticker: "6861", name: "キーエンス", theme: "FA・センサ", weight: 30 },
    ],
  },
  {
    id: "tech-leaders",
    name: "日本テック・リーダーズ",
    badge: "大型ハイテク",
    description: "時価総額上位のテクノロジー・イノベーション企業群",
    stocks: [
      { ticker: "6501", name: "日立製作所", theme: "社会イノベーション", weight: 25 },
      { ticker: "6920", name: "レーザーテック", theme: "最先端マスク検査", weight: 25 },
      { ticker: "8035", name: "東京エレクトロン", theme: "半導体", weight: 25 },
      { ticker: "9984", name: "ソフトバンクグループ", theme: "AI・投資", weight: 25 },
    ],
  },
];

// SAMPLE_STOCKS is now PRESET_STOCKS from ../data/popularStocks

export interface IndexBuilderContentProps {
  onSave: (
    index: CustomIndex,
    ownerToken?: string,
  ) => Promise<{ ok: boolean; error?: string; ownerToken?: string }>;
  onClose?: () => void;
  onPreviewInDashboard?: (index: CustomIndex) => void;
  isFullPage?: boolean;
}

function WeightNumberInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (newVal: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(() => String(Number(value.toFixed(1))));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(String(Number(value.toFixed(1))));
    }
  }, [value, isFocused]);

  const commit = () => {
    setIsFocused(false);
    const parsed = parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(Number(value.toFixed(1))));
      return;
    }
    const clamped = Math.min(100, Math.max(0.1, Number(parsed.toFixed(1))));
    setDraft(String(clamped));
    onChange(clamped);
  };

  return (
    <input
      type="number"
      min={0.1}
      max={100}
      step={0.5}
      value={draft}
      onFocus={() => setIsFocused(true)}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const parsed = parseFloat(next);
        if (Number.isFinite(parsed) && parsed >= 0.1 && parsed <= 100) {
          onChange(Number(parsed.toFixed(1)));
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      aria-label={ariaLabel}
      className="input-search builder-weight-number-input"
    />
  );
}

export function IndexBuilderContent({
  onSave,
  onClose,
  onPreviewInDashboard,
  isFullPage = false,
}: IndexBuilderContentProps) {
  const { session, isAuthenticated, isUser, maxStocks } = useAuth();
  const { success: toastSuccess, info: toastInfo, error: toastError } = useToast();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [pendingSaveAfterAuth, setPendingSaveAfterAuth] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseValue, setBaseValue] = useState(1000);
  const [basket, setBasket] = useState<BasketItem[]>([
    { ticker: "9984", name: "ソフトバンクグループ", theme: "AI・投資", weight: 30 },
    { ticker: "8035", name: "東京エレクトロン", theme: "半導体", weight: 30 },
    { ticker: "7203", name: "トヨタ自動車", theme: "モビリティ", weight: 40 },
  ]);

  const [activeTab, setActiveTab] = useState<"builder" | "simulation">("builder");
  const [customTicker, setCustomTicker] = useState("");
  const [customName, setCustomName] = useState("");
  const [customTheme, setCustomTheme] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real-time unauthenticated simulation hook
  const simulation = useSimulation(basket, baseValue);

  const popularSuggestions = useMemo(() => {
    const query = customTicker || customName;
    if (!query.trim() || query.trim().length < 1) return [];
    return searchPopularStocks(query, 5).filter((s) => !basket.some((b) => b.ticker === s.ticker));
  }, [customTicker, customName, basket]);

  const isLimitReached =
    isUser && maxStocks !== null && maxStocks > 0 && basket.length >= maxStocks;

  const handleSelectSuggestion = (s: PopularStock) => {
    setCustomTicker(s.ticker);
    setCustomName(s.name);
    setCustomTheme(s.theme);
    setError(null);
  };

  const handleApplyPreset = (preset: StrategyPreset) => {
    setName(preset.name);
    setDescription(preset.description);
    setBasket(preset.stocks.map((s) => ({ ...s })));
    setError(null);
    toastInfo(`プリセット「${preset.name}」を適用しました`);
  };

  const handleAddStock = (stock: { ticker: string; name: string; theme: string }) => {
    if (isLimitReached) {
      setError(
        `このパスワードの上限（最大${maxStocks}銘柄）に達しているため、これ以上追加できません`,
      );
      return;
    }
    if (basket.some((b) => b.ticker === stock.ticker)) {
      setError(`銘柄コード ${stock.ticker} は既に追加されています`);
      return;
    }
    setError(null);
    const newWeight = Math.max(5, Math.floor(100 / (basket.length + 1)));
    setBasket([...basket, { ...stock, weight: newWeight }]);
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLimitReached) {
      setError(
        `このパスワードの上限（最大${maxStocks}銘柄）に達しているため、これ以上追加できません`,
      );
      return;
    }
    if (!customTicker.trim() || !customName.trim()) {
      setError("銘柄コードと銘柄名は必須です");
      return;
    }
    const cleanTicker = customTicker.trim().toUpperCase();
    if (!/^[A-Za-z0-9.-]+$/.test(cleanTicker) || cleanTicker.length > 20) {
      setError(
        "銘柄コードは半角英数字、ハイフン、ピリオド（最大20文字）のみ使用可能です (例: 7203, AAPL)",
      );
      return;
    }
    if (basket.some((b) => b.ticker === cleanTicker)) {
      setError(`銘柄コード ${cleanTicker} は既に追加されています`);
      return;
    }
    setError(null);
    setBasket([
      ...basket,
      {
        ticker: cleanTicker,
        name: customName.trim().slice(0, 100),
        theme: customTheme.trim().slice(0, 100) || "カスタム",
        weight: 10,
      },
    ]);
    setCustomTicker("");
    setCustomName("");
    setCustomTheme("");
  };

  const handleRemoveStock = (ticker: string) => {
    setBasket(basket.filter((b) => b.ticker !== ticker));
  };

  const handleWeightChange = (ticker: string, raw: string) => {
    const weight = Math.min(100, Math.max(0.1, toFiniteNumberOr(raw, 1)));
    setBasket(
      basket.map((b) => (b.ticker === ticker ? { ...b, weight } : b)),
    );
  };

  const handleEqualWeight = () => {
    if (basket.length === 0) return;
    setBasket(equalizeWeightsExact(basket));
  };

  const handleNormalizeWeights = () => {
    if (basket.length === 0) return;
    setBasket(redistributeWeightsExact(basket));
  };

  const totalWeight = basket.reduce((sum, b) => sum + b.weight, 0);

  const executeSave = async () => {
    if (!name.trim()) {
      setError("指数名を入力してください");
      return;
    }
    if (name.trim().length > 100) {
      setError("指数名は100文字以内で入力してください");
      return;
    }
    if (basket.length === 0) {
      setError("構成銘柄を1つ以上追加してください");
      return;
    }

    if (
      typeof baseValue !== "number" ||
      !Number.isFinite(baseValue) ||
      baseValue <= 0 ||
      baseValue > 1000000
    ) {
      setError("基準値は1〜1,000,000の正の数値を入力してください");
      return;
    }

    if (isUser && maxStocks !== null && maxStocks > 0 && basket.length > maxStocks) {
      setError(
        `このパスワードの上限（最大${maxStocks}銘柄）を超えています（現在${basket.length}銘柄）`,
      );
      return;
    }

    setSaving(true);
    setError(null);

    const ownerToken = crypto.randomUUID();
    const newIndex: CustomIndex = {
      id: `idx-${crypto.randomUUID()}`,
      name: name.trim(),
      description:
        description.trim().slice(0, 500) || `${basket.length}銘柄で構成されたカスタム指数`,
      baseValue,
      basket,
    };

    const res = await onSave(newIndex, ownerToken);
    setSaving(false);

    if (res.ok) {
      toastSuccess(`独自指数「${newIndex.name}」を作成・保存しました`);
      if (onClose) onClose();
    } else {
      setError(res.error || "保存に失敗しました");
    }
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      setPendingSaveAfterAuth(true);
      setIsAuthModalOpen(true);
      setError(null);
      return;
    }
    await executeSave();
  };

  const handleCopySettings = async () => {
    const config = {
      name: name.trim() || "未命名独自指数",
      baseValue,
      description: description.trim(),
      basket,
    };
    const text = JSON.stringify(config, null, 2);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      toastSuccess("指数設定（JSON）をクリップボードにコピーしました");
    } catch (err) {
      console.warn("Failed to copy index settings:", err);
      toastError("クリップボードへのコピーに失敗しました");
    }
  };

  const handlePreviewInDashboardClick = () => {
    if (basket.length === 0) {
      setError("構成銘柄を1つ以上追加してください");
      return;
    }
    const tempIndex: CustomIndex = {
      id: `temp-${Date.now()}`,
      name: name.trim() || "シミュレーションプレビュー指数",
      description: description.trim() || "シミュレーターから一時表示中の独自指数",
      baseValue,
      basket,
    };
    if (onPreviewInDashboard) {
      onPreviewInDashboard(tempIndex);
      toastInfo("ダッシュボードで一時プレビュー表示します");
    }
  };

  return (
    <div
      className="builder-content-root"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        maxHeight: isFullPage ? "none" : "85vh",
      }}
    >
      {/* Auth status & simulation banner */}
      <div className={`builder-auth-banner ${isAuthenticated ? "is-auth" : ""}`}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          {isAuthenticated ? (
            <>
              <KeyRound size={14} style={{ color: "var(--accent-text)" }} />
              <span>
                ログイン中: <strong>{session?.name}</strong>
              </span>
              <span className="mono tiny" style={{ color: "var(--accent-text)" }}>
                ({maxStocks ? `最大${maxStocks}銘柄` : "銘柄無制限"})
              </span>
            </>
          ) : (
            <>
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <span
                  className="badge"
                  style={{
                    background: "rgba(16, 185, 129, 0.2)",
                    color: "var(--neon-green)",
                    border: "1px solid rgba(16, 185, 129, 0.4)",
                    fontSize: 11,
                    padding: "2px 8px",
                  }}
                >
                  <Zap size={11} /> ゲスト・シミュレーション可能
                </span>
                <span style={{ color: "var(--text-secondary)" }}>
                  ログインなしで構成・バックテストを自由にお試しいただけます。保存時にパスワード認証できます。
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className="btn btn-sm btn-outline"
                style={{
                  padding: "2px 8px",
                  fontSize: 11,
                  borderColor: "var(--accent-border)",
                  color: "var(--accent-text)",
                }}
              >
                <KeyRound size={11} /> パスワード認証
              </button>
            </>
          )}
        </div>

        {/* Mobile Tab Switcher */}
        <div className="mobile-builder-tabs-container">
          <div className="mobile-builder-tabs-segmented" role="tablist" aria-label="ビルダーモード切替">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "builder"}
              className={`mobile-builder-tab-btn ${activeTab === "builder" ? "active" : ""}`}
              onClick={() => setActiveTab("builder")}
            >
              <Sliders size={13} />
              <span>構成・ウェイト</span>
              <span className="mobile-tab-count-badge mono">{basket.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "simulation"}
              className={`mobile-builder-tab-btn ${activeTab === "simulation" ? "active" : ""}`}
              onClick={() => setActiveTab("simulation")}
            >
              <Sparkles size={13} />
              <span>シミュレーション</span>
              {simulation && (
                <span className="mobile-tab-indicator-dot" title="計算完了" />
              )}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" aria-live="assertive" className="form-alert-error">
          {error}
        </div>
      )}

      {/* Main 2-column layout body */}
      <div
        className="builder-main-split"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          padding: "16px 20px",
          flex: 1,
          overflowY: "auto",
        }}
      >
        {/* Left Column: Form & Basket Controls */}
        <div
          className={`builder-left-pane ${activeTab === "builder" ? "active-pane" : ""}`}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {/* Strategy Presets quick bar */}
          <div>
            <div className="row space-between" style={{ marginBottom: 6 }}>
              <span className="mono tiny muted uppercase" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Sparkles size={11} style={{ color: "var(--accent-text)" }} /> 戦略プリセット（ワンクリック適用）
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {STRATEGY_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  className="preset-card-btn"
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    color: "inherit",
                  }}
                >
                  <div className="row space-between" style={{ marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 11, color: "var(--text-heading)" }}>
                      {preset.name}
                    </span>
                    <span
                      className="mono tiny"
                      style={{
                        fontSize: 9,
                        padding: "1px 4px",
                        borderRadius: 4,
                        background: "var(--accent-subtle)",
                        color: "var(--accent-text)",
                      }}
                    >
                      {preset.badge}
                    </span>
                  </div>
                  <div className="tiny muted" style={{ fontSize: 10, lineHeight: 1.2 }}>
                    {preset.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Basic Info: Name & Base Value */}
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div>
              <label
                htmlFor="builder-name-input"
                className="mono tiny muted uppercase"
                style={{ display: "block", marginBottom: 4 }}
              >
                指数名 *
              </label>
              <input
                id="builder-name-input"
                type="text"
                className="input-search"
                style={{ paddingLeft: 10, height: 34 }}
                placeholder="例: 次世代AIフロンティア指数"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label
                htmlFor="builder-base-input"
                className="mono tiny muted uppercase"
                style={{ display: "block", marginBottom: 4 }}
              >
                基準値 (Base Value)
              </label>
              <input
                id="builder-base-input"
                type="number"
                className="input-search"
                style={{ paddingLeft: 10, height: 34 }}
                placeholder="1000"
                value={baseValue}
                onChange={(e) => setBaseValue(toFiniteNumberOr(e.target.value, 1000))}
              />
            </div>
          </div>

          {/* Concept Description */}
          <div>
            <label
              htmlFor="builder-desc-input"
              className="mono tiny muted uppercase"
              style={{ display: "block", marginBottom: 4 }}
            >
              指数のコンセプト・説明
            </label>
            <input
              id="builder-desc-input"
              type="text"
              className="input-search"
              style={{ paddingLeft: 10, height: 32 }}
              placeholder="例: 国内AIスタートアップおよび先端半導体関連の加重平均指数"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Sample Stock Quick Picker */}
          <div>
            <div className="row space-between" style={{ marginBottom: 6 }}>
              <span className="mono tiny muted uppercase">代表銘柄クイック追加</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {PRESET_STOCKS.map((s: PopularStock) => {
                const isAdded = basket.some((b) => b.ticker === s.ticker);
                const isDisabled = isAdded || isLimitReached;
                return (
                  <button
                    key={s.ticker}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handleAddStock(s)}
                    className="tag"
                    style={{
                      cursor: isDisabled ? "default" : "pointer",
                      opacity: isDisabled ? 0.35 : 1,
                      border: isDisabled
                        ? "1px solid var(--border-subtle)"
                        : "1px solid var(--border-cyan)",
                      background: isDisabled ? "transparent" : "rgba(0,229,255,0.06)",
                      fontSize: 10,
                      padding: "3px 7px",
                    }}
                  >
                    <Plus size={9} style={{ marginRight: 3 }} />
                    {s.name} ({s.ticker})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Stock Form */}
          <form
            onSubmit={handleAddCustom}
            className="column"
            style={{
              gap: 6,
              padding: "8px 10px",
              background: "var(--surface-inset)",
              border: "1px dashed var(--border-subtle)",
              borderRadius: 8,
              opacity: isLimitReached ? 0.6 : 1,
            }}
          >
            <div className="row flex-wrap" style={{ gap: 6 }}>
              <input
                type="text"
                placeholder="コード (例: 6701)"
                aria-label="銘柄コード"
                className="input-search"
                disabled={isLimitReached}
                style={{ flex: "1 1 80px", height: 30, paddingLeft: 8, fontSize: 11 }}
                value={customTicker}
                onChange={(e) => setCustomTicker(e.target.value)}
              />
              <input
                type="text"
                placeholder="銘柄名 (例: NEC)"
                aria-label="銘柄名"
                className="input-search"
                disabled={isLimitReached}
                style={{ flex: "2 1 110px", height: 30, paddingLeft: 8, fontSize: 11 }}
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
              <input
                type="text"
                placeholder="テーマ"
                aria-label="テーマ"
                className="input-search"
                disabled={isLimitReached}
                style={{ flex: "1 1 80px", height: 30, paddingLeft: 8, fontSize: 11 }}
                value={customTheme}
                onChange={(e) => setCustomTheme(e.target.value)}
              />
              <button
                type="submit"
                disabled={isLimitReached}
                className="btn btn-sm btn-default"
                style={{ height: 30, fontSize: 11 }}
              >
                <Plus size={11} /> 追加
              </button>
            </div>

            {popularSuggestions.length > 0 && (
              <div className="row flex-wrap" style={{ gap: 4, alignItems: "center", paddingTop: 2 }}>
                <span className="mono tiny muted" style={{ fontSize: 9 }}>
                  <Sparkles size={9} style={{ color: "var(--accent-text)" }} /> 候補:
                </span>
                {popularSuggestions.map((s) => (
                  <button
                    key={s.ticker}
                    type="button"
                    onClick={() => handleSelectSuggestion(s)}
                    className="tag tag-muted"
                    style={{
                      cursor: "pointer",
                      fontSize: 9,
                      padding: "1px 5px",
                      background: "var(--accent-subtle)",
                      border: "1px solid var(--accent-border)",
                      color: "var(--text-primary)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <strong>{s.ticker}</strong> {s.name}
                  </button>
                ))}
              </div>
            )}
          </form>

          {/* Basket List & Weight Sliders */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="row space-between flex-wrap" style={{ gap: 6 }}>
              <span className="mono tiny bold uppercase" style={{ color: "var(--accent-text)" }}>
                構成銘柄 & ウェイト ({basket.length} 銘柄 / 合計:{" "}
                <span
                  style={{
                    color:
                      Math.abs(totalWeight - 100) <= 0.05
                        ? "var(--neon-green)"
                        : totalWeight > 100
                          ? "var(--neon-red)"
                          : "var(--neon-yellow)",
                  }}
                >
                  {totalWeight.toFixed(1)}%
                </span>
                {Math.abs(totalWeight - 100) > 0.05 ? " ※自動正規化" : ""})
              </span>
              <div className="row" style={{ gap: 4 }}>
                <button
                  type="button"
                  onClick={handleNormalizeWeights}
                  className="btn btn-sm btn-outline"
                  style={{ fontSize: 10, padding: "2px 6px", height: 22 }}
                  title="比率バランスを保ち100%に再配分"
                >
                  <Scale size={10} /> 100%に再配分
                </button>
                <button
                  type="button"
                  onClick={handleEqualWeight}
                  className="btn btn-sm btn-outline"
                  style={{ fontSize: 10, padding: "2px 6px", height: 22 }}
                  title="全銘柄を均等配分"
                >
                  均等配分
                </button>
              </div>
            </div>

            {/* Total Weight Progress Bar Indicator */}
            <div
              className="weight-total-bar-bg"
              style={{
                height: 4,
                background: "var(--border-subtle)",
                borderRadius: 2,
                overflow: "hidden",
                margin: "2px 0 6px",
              }}
              title={`合計ウェイト: ${totalWeight.toFixed(1)}%`}
              aria-label={`合計ウェイト: ${totalWeight.toFixed(1)}%`}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(totalWeight, 100)}%`,
                  background:
                    Math.abs(totalWeight - 100) <= 0.05
                      ? "var(--neon-green)"
                      : totalWeight > 100
                        ? "var(--neon-red)"
                        : "var(--neon-yellow)",
                  transition: "width 0.2s ease, background 0.2s ease",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxHeight: 210,
                overflowY: "auto",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                padding: 6,
                background: "var(--surface-neutral)",
              }}
            >
              {basket.length === 0 ? (
                <div className="tiny muted text-center" style={{ padding: "20px 0" }}>
                  銘柄がありません。上の代表銘柄やフォームから追加してください。
                </div>
              ) : (
                basket.map((item) => (
                  <div
                    key={item.ticker}
                    className="builder-basket-row"
                  >
                    <div className="builder-basket-info">
                      <div className="row" style={{ gap: 6, alignItems: "center" }}>
                        <span className="mono bold builder-ticker-badge">
                          {item.ticker}
                        </span>
                        <span className="builder-stock-name">{item.name}</span>
                      </div>
                      <span className="tiny muted builder-stock-theme">
                        {item.theme}
                      </span>
                    </div>

                    <div className="builder-basket-controls">
                      <input
                        type="range"
                        min={1}
                        max={100}
                        step={1}
                        value={item.weight}
                        onChange={(e) => handleWeightChange(item.ticker, e.target.value)}
                        className="builder-weight-slider"
                        aria-label={`${item.name}のウェイト比率スライダー`}
                      />
                      <div className="builder-weight-input-group row" style={{ alignItems: "center", gap: 2 }}>
                        <WeightNumberInput
                          value={item.weight}
                          onChange={(w) => handleWeightChange(item.ticker, String(w))}
                          ariaLabel={`${item.name}のウェイト比率数値`}
                        />
                        <span className="mono tiny bold" style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                          %
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveStock(item.ticker)}
                      className="builder-basket-remove-btn"
                      title={`${item.name}を削除`}
                      aria-label={`${item.name}を削除`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Simulation Preview */}
        <div
          className={`builder-right-pane ${activeTab === "simulation" ? "active-pane" : ""}`}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <SimulationPreview
            simulation={simulation}
            baseValue={baseValue}
            indexName={name.trim()}
          />
        </div>
      </div>

      {/* Footer Controls */}
      <div
        className="row space-between flex-wrap"
        style={{
          padding: "12px 20px",
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--surface-footer)",
          gap: 10,
          alignItems: "center",
        }}
      >
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          {onPreviewInDashboard && (
            <button
              type="button"
              onClick={handlePreviewInDashboardClick}
              className="btn btn-outline"
              style={{ fontSize: 12, padding: "6px 12px" }}
              title="保存せずにダッシュボードでフル分析を体験"
            >
              <ExternalLink size={13} /> ダッシュボードで一時プレビュー
            </button>
          )}

          <button
            type="button"
            onClick={handleCopySettings}
            className="btn btn-outline"
            style={{ fontSize: 12, padding: "6px 10px" }}
            title="指数構成をJSONとしてコピー"
          >
            <Copy size={13} /> 設定コピー
          </button>
        </div>

        <div className="row" style={{ gap: 10 }}>
          {onClose && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={onClose}
              disabled={saving}
              style={{ fontSize: 12 }}
            >
              キャンセル
            </button>
          )}

          <button
            type="button"
            className="btn btn-default"
            onClick={handleSubmit}
            disabled={saving || basket.length === 0}
            style={{ fontSize: 12, padding: "6px 16px" }}
          >
            {saving ? (
              <>
                <RefreshCw size={13} className="animate-spin" /> 保存中...
              </>
            ) : isAuthenticated ? (
              <>
                <Check size={13} /> 指数を保存・追跡開始
              </>
            ) : (
              <>
                <KeyRound size={13} /> 認証して指数を保存
              </>
            )}
          </button>
        </div>
      </div>

      {/* Auth Modal for continuing save after login */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
          setPendingSaveAfterAuth(false);
        }}
        onSuccess={() => {
          setIsAuthModalOpen(false);
          setError(null);
          if (pendingSaveAfterAuth) {
            setPendingSaveAfterAuth(false);
            // Re-trigger save
            setTimeout(() => {
              executeSave();
            }, 100);
          }
        }}
      />
    </div>
  );
}
