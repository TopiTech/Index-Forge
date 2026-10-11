import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Briefcase,
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  Sparkles,
  BookmarkPlus,
  Check,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { ModalBase } from "./ModalBase";
import {
  loadPortfolioPositions,
  savePortfolioPositions,
  loadWatchlist,
  saveWatchlist,
  calculatePortfolioSummary,
  convertPortfolioToCustomIndexBasket,
  type PortfolioPosition,
} from "../lib/portfolioStorage";
import { getStockFundamentals } from "../lib/marketDataService";
import { POPULAR_STOCKS } from "../data/popularStocks";
import type { PageView } from "../lib/navigation";
import { useToast } from "./Toast";

interface PortfolioManagerPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
  onConvertAndCreateCustomIndex?: (basket: { ticker: string; name: string; theme: string; weight: number }[]) => void;
}

export function PortfolioManagerPage({
  onNavigate,
  onOpenStockDetail,
  onConvertAndCreateCustomIndex,
}: PortfolioManagerPageProps) {
  const { isAuthenticated, login, loading: authLoading } = useAuth();
  const [positions, setPositions] = useState<PortfolioPosition[]>(() =>
    isAuthenticated ? loadPortfolioPositions() : []
  );
  const [watchlist, setWatchlist] = useState<string[]>(() =>
    isAuthenticated ? loadWatchlist() : []
  );
  const [activeTab, setActiveTab] = useState<"HOLDINGS" | "WATCHLIST">("HOLDINGS");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const { success, info } = useToast();

  // Auth gate inline login state
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  // New position form state
  const [newTicker, setNewTicker] = useState("7203");
  const [newShares, setNewShares] = useState("100");
  const [newAverageCost, setNewAverageCost] = useState("2500");

  // Synchronize positions & watchlist when auth state changes
  useEffect(() => {
    if (isAuthenticated) {
      setPositions(loadPortfolioPositions());
      setWatchlist(loadWatchlist());
    } else {
      setPositions([]);
      setWatchlist([]);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      savePortfolioPositions(positions);
    }
  }, [positions, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      saveWatchlist(watchlist);
    }
  }, [watchlist, isAuthenticated]);

  const handleInlineLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = authPassword.trim();
    if (!trimmed) {
      setAuthError("パスワードを入力してください");
      return;
    }

    setAuthError(null);
    setIsSubmittingAuth(true);
    const res = await login(trimmed);
    setIsSubmittingAuth(false);
    if (res.ok) {
      setPositions(loadPortfolioPositions());
      setWatchlist(loadWatchlist());
      setAuthPassword("");
      success("ログインしました。ポートフォリオ管理機能をご利用いただけます。");
    } else {
      setAuthError(res.error || "パスワードが正しくありません");
    }
  };

  const summary = calculatePortfolioSummary(positions);
  const isTotalProfitPositive = summary.totalProfit >= 0;
  const isDailyProfitPositive = summary.dailyTotalChange >= 0;

  const handleAddPosition = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = newTicker.trim().toUpperCase();
    const shares = parseFloat(newShares);
    const avgCost = parseFloat(newAverageCost);

    if (!ticker || isNaN(shares) || shares <= 0 || isNaN(avgCost) || avgCost <= 0) {
      return;
    }

    const fund = getStockFundamentals(ticker);
    const newPos: PortfolioPosition = {
      id: `pos-${Date.now()}`,
      ticker,
      name: fund.name,
      shares,
      averageCost: avgCost,
      acquiredAt: new Date().toISOString().split("T")[0],
    };

    setPositions((prev) => [...prev, newPos]);
    setIsAddModalOpen(false);
    success(`「${fund.name} (${ticker})」を保有ポートフォリオに追加しました`);
  };

  const handleDeletePosition = (id: string, name: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
    info(`「${name}」をポートフォリオから削除しました`);
  };

  const handleRemoveFromWatchlist = (ticker: string) => {
    setWatchlist((prev) => prev.filter((t) => t !== ticker));
    info(`「${ticker}」をウォッチリストから削除しました`);
  };

  const handleConvertToCustomIndex = () => {
    const basket = convertPortfolioToCustomIndexBasket(positions);
    if (basket.length === 0) return;

    if (onConvertAndCreateCustomIndex) {
      onConvertAndCreateCustomIndex(basket);
    } else {
      onNavigate("builder");
    }
    success(`保有ポートフォリオ（${basket.length}銘柄）を指数ビルダーに一括エクスポートしました！`);
  };

  if (!isAuthenticated) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="page-container portfolio-manager-page portfolio-auth-gate"
      >
        {/* Subpage Top Bar */}
        <div
          className="subpage-nav-bar"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "24px",
          }}
        >
          <button
            type="button"
            onClick={() => onNavigate("dashboard")}
            className="btn btn-default subpage-back-btn"
            aria-label="ダッシュボードへ戻る"
          >
            <ArrowLeft size={16} />
            <span>ダッシュボードに戻る</span>
          </button>
          <span className="mono tiny muted uppercase">ASSET MANAGEMENT · LOGIN REQUIRED</span>
        </div>

        {/* Hero Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <span className="badge badge-accent mono tiny">
              <Lock size={12} /> AUTH REQUIRED
            </span>
            <span className="tiny muted mono">MEMBERS ONLY</span>
          </div>
          <h1 className="page-header-title" style={{ fontSize: "1.9rem", margin: "4px 0 8px" }}>
            マイ・ポートフォリオ & ウォッチリスト
          </h1>
          <p
            className="muted"
            style={{ maxWidth: "620px", margin: "0 auto", fontSize: "0.95rem", lineHeight: 1.6 }}
          >
            実際の保有株式の損益・利回り管理、ウォッチリスト、および保有資産に基づく客観的カスタム指数バックテストはログインユーザー限定の機能です。
          </p>
        </div>

        {/* Login Form Card */}
        <div style={{ maxWidth: "480px", margin: "0 auto 40px" }}>
          <div
            className="card portfolio-gate-card"
            style={{
              padding: "32px 28px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-cyan)",
              borderRadius: "16px",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.4), 0 0 30px rgba(0, 229, 255, 0.12)",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  margin: "0 auto 14px",
                  borderRadius: "50%",
                  background: "rgba(0, 229, 255, 0.12)",
                  border: "1px solid var(--border-cyan)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Lock size={26} style={{ color: "var(--neon-cyan)" }} />
              </div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 6px" }}>
                ポートフォリオのロック解除
              </h2>
              <p className="tiny muted" style={{ margin: 0 }}>
                パスワードを入力してポートフォリオ管理機能を開始してください
              </p>
            </div>

            {authError && (
              <div
                role="alert"
                aria-live="assertive"
                className="row"
                style={{
                  gap: 8,
                  padding: "10px 14px",
                  background: "rgba(255, 51, 102, 0.15)",
                  border: "1px solid var(--neon-red)",
                  borderRadius: "8px",
                  color: "var(--neon-red)",
                  fontSize: "13px",
                  marginBottom: "18px",
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleInlineLogin}>
              <div style={{ marginBottom: "18px" }}>
                <label
                  htmlFor="portfolio-auth-input"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: "6px",
                  }}
                >
                  アクセスパスワード
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="portfolio-auth-input"
                    type={showPassword ? "text" : "password"}
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="ユーザーまたは管理者パスワード"
                    autoComplete="current-password"
                    disabled={isSubmittingAuth || authLoading}
                    style={{
                      width: "100%",
                      padding: "11px 44px 11px 14px",
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "8px",
                      color: "var(--text-primary)",
                      fontSize: "14px",
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
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="tiny muted" style={{ margin: "6px 0 0", fontSize: "11px" }}>
                  ※ 管理者パスワード、または管理者が発行したユーザーパスワードを入力してください
                </p>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => onNavigate("dashboard")}
                  className="btn btn-default"
                  style={{ flex: 1 }}
                >
                  ダッシュボードへ戻る
                </button>
                <button
                  type="submit"
                  className="btn btn-accent"
                  style={{
                    flex: 2,
                    display: "inline-flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  disabled={isSubmittingAuth || authLoading || !authPassword.trim()}
                >
                  <KeyRound size={15} />
                  <span>{isSubmittingAuth || authLoading ? "認証中..." : "ログインして利用開始"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "18px" }}>
            <span className="mono tiny muted uppercase">FEATURE HIGHLIGHTS</span>
            <h3 style={{ fontSize: "1.1rem", margin: "4px 0 0" }}>ログインで利用可能になる機能</h3>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "16px",
            }}
          >
            <div className="card" style={{ padding: "20px 22px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                <div
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    background: "rgba(0, 229, 255, 0.12)",
                    color: "var(--neon-cyan)",
                    display: "flex",
                  }}
                >
                  <Briefcase size={20} />
                </div>
                <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>リアルタイム損益・利回り管理</h4>
              </div>
              <p className="tiny muted" style={{ margin: 0, lineHeight: 1.6 }}>
                保有株数や取得単価を登録し、時価評価額、トータル損益、本日前日比損益および年間予想配当金をリアルタイムで一元管理できます。
              </p>
            </div>

            <div className="card" style={{ padding: "20px 22px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                <div
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    background: "rgba(168, 85, 247, 0.12)",
                    color: "#a855f7",
                    display: "flex",
                  }}
                >
                  <Sparkles size={20} />
                </div>
                <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>ワンクリック指数化バックテスト</h4>
              </div>
              <p className="tiny muted" style={{ margin: 0, lineHeight: 1.6 }}>
                保有株式の時価評価額比率からオリジナルカスタム指数を瞬時に自動生成し、日経平均やS&P 500との客観的なリスク・リターン比較を実行できます。
              </p>
            </div>

            <div className="card" style={{ padding: "20px 22px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                <div
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    background: "rgba(16, 185, 129, 0.12)",
                    color: "#10b981",
                    display: "flex",
                  }}
                >
                  <BookmarkPlus size={20} />
                </div>
                <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>銘柄監視ウォッチリスト</h4>
              </div>
              <p className="tiny muted" style={{ margin: 0, lineHeight: 1.6 }}>
                気になる銘柄を登録して株価や前日比騰落率を素早く確認でき、財務指標やインタラクティブチャート分析へシームレスにアクセスできます。
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container portfolio-manager-page"
    >
      {/* Top Banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "24px",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span className="badge badge-accent mono tiny">ASSET & WATCHLIST TRACKER</span>
            <span className="tiny muted mono">REAL PORTFOLIO MANAGEMENT</span>
          </div>
          <h2 className="page-header-title">マイ・ポートフォリオ & ウォッチリスト</h2>
          <p className="muted tiny" style={{ margin: "4px 0 0" }}>
            実際の保有株式の損益・利回り管理と、ワンクリックでの客観的カスタム指数バックテスト
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-sm btn-accent"
            onClick={handleConvertToCustomIndex}
            title="保有株の評価額比率でオリジナル指数を即座に作成し、ベンチマーク比較バックテストを実行"
          >
            <Sparkles size={14} />
            <span>★ ワンクリックで指数化</span>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setIsAddModalOpen(true)}
          >
            <Plus size={14} />
            <span>保有銘柄を追加</span>
          </button>
        </div>
      </div>

      {/* Financial Summary KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        <div className="card" style={{ padding: "16px 18px" }}>
          <span className="tiny muted mono uppercase">総評価額 (現在価値)</span>
          <div className="mono bold" style={{ fontSize: "1.6rem", marginTop: 4 }}>
            ¥{summary.totalMarketValue.toLocaleString()}
          </div>
          <span className="tiny muted">取得総額: ¥{summary.totalCost.toLocaleString()}</span>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <span className="tiny muted mono uppercase">トータル含み損益</span>
          <div
            className="mono bold"
            style={{
              fontSize: "1.6rem",
              marginTop: 4,
              color: isTotalProfitPositive ? "var(--color-positive)" : "var(--color-negative)",
            }}
          >
            {isTotalProfitPositive ? "+" : ""}
            ¥{summary.totalProfit.toLocaleString()}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.85rem",
              fontWeight: 600,
              color: isTotalProfitPositive ? "var(--color-positive)" : "var(--color-negative)",
            }}
            className="mono"
          >
            {isTotalProfitPositive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            <span>
              {isTotalProfitPositive ? "+" : ""}
              {summary.totalProfitPercent.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <span className="tiny muted mono uppercase">前日比 損益</span>
          <div
            className="mono bold"
            style={{
              fontSize: "1.6rem",
              marginTop: 4,
              color: isDailyProfitPositive ? "var(--color-positive)" : "var(--color-negative)",
            }}
          >
            {isDailyProfitPositive ? "+" : ""}
            ¥{summary.dailyTotalChange.toLocaleString()}
          </div>
          <span className="tiny muted">本日の保有資産変動</span>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <span className="tiny muted mono uppercase">年間予想配当金合計</span>
          <div className="mono bold" style={{ fontSize: "1.6rem", marginTop: 4, color: "#10b981" }}>
            ¥{summary.totalAnnualDividend.toLocaleString()}
          </div>
          <span className="tiny muted mono" style={{ color: "var(--accent-text)" }}>
            ポートフォリオ利回り: {summary.dividendYield.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "16px",
          borderBottom: "1px solid var(--border-subtle)",
          paddingBottom: "8px",
        }}
      >
        <button
          type="button"
          className={`btn btn-sm ${activeTab === "HOLDINGS" ? "btn-accent" : "btn-ghost"}`}
          onClick={() => setActiveTab("HOLDINGS")}
        >
          <Briefcase size={14} />
          <span>保有株式一覧 ({positions.length}銘柄)</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeTab === "WATCHLIST" ? "btn-accent" : "btn-ghost"}`}
          onClick={() => setActiveTab("WATCHLIST")}
        >
          <BookmarkPlus size={14} />
          <span>監視中ウォッチリスト ({watchlist.length}銘柄)</span>
        </button>
      </div>

      {/* Tab 1: Holdings Table */}
      {activeTab === "HOLDINGS" && (
        <div className="card" style={{ padding: "20px" }}>
          {positions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px" }}>
              <Briefcase size={36} className="muted" style={{ marginBottom: 12 }} />
              <p style={{ fontWeight: 600 }}>登録された保有銘柄がありません</p>
              <button
                type="button"
                className="btn btn-sm btn-accent"
                onClick={() => setIsAddModalOpen(true)}
                style={{ marginTop: 12 }}
              >
                最初の保有株を登録する
              </button>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="constituents-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>銘柄</th>
                    <th style={{ textAlign: "right" }}>保有株数</th>
                    <th style={{ textAlign: "right" }}>取得単価</th>
                    <th style={{ textAlign: "right" }}>現在値</th>
                    <th style={{ textAlign: "right" }}>評価額</th>
                    <th style={{ textAlign: "right" }}>含み損益</th>
                    <th style={{ textAlign: "right" }}>損益率</th>
                    <th style={{ textAlign: "right" }}>構成比</th>
                    <th style={{ textAlign: "center" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.positions.map((p) => {
                    const isProfit = p.unrealizedProfit >= 0;
                    return (
                      <tr key={p.id}>
                        <td>
                          <div
                            role="button"
                            tabIndex={0}
                            style={{ cursor: "pointer" }}
                            onClick={() => onOpenStockDetail(p.ticker)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onOpenStockDetail(p.ticker);
                              }
                            }}
                            title="銘柄詳細を見る"
                            aria-label={`${p.name} (${p.ticker}) の詳細を見る`}
                          >
                            <span style={{ fontWeight: 600, color: "var(--accent-text)" }}>
                              {p.name}
                            </span>
                            <div className="tiny muted mono">
                              {p.ticker} · {p.theme}
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }} className="mono">
                          {p.shares.toLocaleString()}株
                        </td>
                        <td style={{ textAlign: "right" }} className="mono">
                          ¥{p.averageCost.toLocaleString()}
                        </td>
                        <td style={{ textAlign: "right" }} className="mono bold">
                          ¥{p.currentPrice.toLocaleString()}
                        </td>
                        <td style={{ textAlign: "right" }} className="mono bold">
                          ¥{p.marketValue.toLocaleString()}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: isProfit ? "var(--color-positive)" : "var(--color-negative)",
                          }}
                          className="mono bold"
                        >
                          {isProfit ? "+" : ""}
                          ¥{p.unrealizedProfit.toLocaleString()}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: isProfit ? "var(--color-positive)" : "var(--color-negative)",
                          }}
                          className="mono bold"
                        >
                          {isProfit ? "+" : ""}
                          {p.unrealizedProfitPercent.toFixed(2)}%
                        </td>
                        <td style={{ textAlign: "right" }} className="mono">
                          <span className="badge badge-default tiny">{p.weightPercent}%</span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className="btn btn-ghost tiny"
                            onClick={() => handleDeletePosition(p.id, p.name)}
                            title="削除"
                            style={{ padding: "4px" }}
                          >
                            <Trash2 size={14} className="muted" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Watchlist */}
      {activeTab === "WATCHLIST" && (
        <div className="card" style={{ padding: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
            {watchlist.map((ticker) => {
              const fund = getStockFundamentals(ticker);
              const isPos = fund.changePercent >= 0;
              return (
                <div
                  key={ticker}
                  role="button"
                  tabIndex={0}
                  className="card interactive-card"
                  style={{
                    padding: "14px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    border: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                  }}
                  onClick={() => onOpenStockDetail(ticker)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenStockDetail(ticker);
                    }
                  }}
                  aria-label={`${fund.name} (${ticker}) の詳細を見る`}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span className="mono bold">{ticker}</span>
                      <span className="badge badge-default tiny mono">{fund.market}</span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem", marginTop: 2 }}>
                      {fund.name}
                    </div>
                    <div className="tiny muted">{fund.theme}</div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div className="mono bold" style={{ fontSize: "1.1rem" }}>
                      ¥{fund.price.toLocaleString()}
                    </div>
                    <div
                      className="mono tiny bold"
                      style={{ color: isPos ? "var(--color-positive)" : "var(--color-negative)" }}
                    >
                      {isPos ? "+" : ""}{fund.changePercent.toFixed(2)}%
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost tiny"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFromWatchlist(ticker);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      title="ウォッチリストから削除"
                      aria-label={`${fund.name} をウォッチリストから削除`}
                      style={{ padding: "2px", marginTop: 4 }}
                    >
                      <Trash2 size={12} className="muted" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Position Modal */}
      <ModalBase
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="保有銘柄の新規登録"
        icon={<Briefcase size={18} style={{ color: "var(--accent-text)" }} />}
        maxWidth={480}
      >
        <form onSubmit={handleAddPosition}>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="position-ticker-select" className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
              銘柄コードまたはプリセット
            </label>
            <select
              id="position-ticker-select"
              className="select-styled"
              style={{ width: "100%", padding: "8px 12px" }}
              value={newTicker}
              onChange={(e) => {
                setNewTicker(e.target.value);
                const f = getStockFundamentals(e.target.value);
                setNewAverageCost(String(f.price));
              }}
            >
              {POPULAR_STOCKS.map((s) => (
                <option key={s.ticker} value={s.ticker}>
                  {s.ticker} - {s.name} ({s.theme})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label htmlFor="position-shares-input" className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
              保有株数
            </label>
            <input
              id="position-shares-input"
              type="number"
              className="input-styled mono"
              style={{ width: "100%", padding: "8px 12px" }}
              value={newShares}
              onChange={(e) => setNewShares(e.target.value)}
              min="1"
              step="1"
              required
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label htmlFor="position-avg-cost-input" className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
              平均取得単価 (円またはドル)
            </label>
            <input
              id="position-avg-cost-input"
              type="number"
              className="input-styled mono"
              style={{ width: "100%", padding: "8px 12px" }}
              value={newAverageCost}
              onChange={(e) => setNewAverageCost(e.target.value)}
              min="1"
              step="0.1"
              required
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              className="btn btn-default"
              onClick={() => setIsAddModalOpen(false)}
            >
              キャンセル
            </button>
            <button type="submit" className="btn btn-accent">
              <Check size={14} />
              <span>登録する</span>
            </button>
          </div>
        </form>
      </ModalBase>
    </motion.div>
  );
}
