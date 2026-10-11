import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase,
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  Sparkles,
  PieChart,
  BookmarkPlus,
  ArrowRight,
  Layers,
  Coins,
  X,
  Check,
} from "lucide-react";
import {
  loadPortfolioPositions,
  savePortfolioPositions,
  loadWatchlist,
  saveWatchlist,
  calculatePortfolioSummary,
  convertPortfolioToCustomIndexBasket,
  type PortfolioPosition,
  type PositionCalculation,
} from "../lib/portfolioStorage";
import { getStockFundamentals } from "../lib/marketDataService";
import { POPULAR_STOCKS } from "../data/popularStocks";
import type { PageView } from "../lib/navigation";
import type { CustomIndex } from "../data/indices";
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
  const [positions, setPositions] = useState<PortfolioPosition[]>(loadPortfolioPositions);
  const [watchlist, setWatchlist] = useState<string[]>(loadWatchlist);
  const [activeTab, setActiveTab] = useState<"HOLDINGS" | "WATCHLIST">("HOLDINGS");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const { success, info } = useToast();

  // New position form state
  const [newTicker, setNewTicker] = useState("7203");
  const [newShares, setNewShares] = useState("100");
  const [newAverageCost, setNewAverageCost] = useState("2500");

  useEffect(() => {
    savePortfolioPositions(positions);
  }, [positions]);

  useEffect(() => {
    saveWatchlist(watchlist);
  }, [watchlist]);

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container portfolio-manager-page"
      style={{ maxWidth: "1280px", margin: "0 auto", padding: "16px 20px 48px" }}
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
          <h2 style={{ fontSize: "1.65rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            マイ・ポートフォリオ & ウォッチリスト
          </h2>
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
                            style={{ cursor: "pointer" }}
                            onClick={() => onOpenStockDetail(p.ticker)}
                            title="銘柄詳細を見る"
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
                  className="card interactive-card"
                  style={{
                    padding: "14px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    border: "1px solid var(--border-subtle)",
                  }}
                  onClick={() => onOpenStockDetail(ticker)}
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
                      title="ウォッチリストから削除"
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
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="modal-backdrop" onClick={() => setIsAddModalOpen(false)}>
            <div
              className="modal-card"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "480px", width: "90vw", padding: "24px" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>保有銘柄の新規登録</h3>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setIsAddModalOpen(false)}
                  style={{ padding: 4 }}
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAddPosition}>
                <div style={{ marginBottom: 14 }}>
                  <label className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
                    銘柄コードまたはプリセット
                  </label>
                  <select
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
                  <label className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
                    保有株数
                  </label>
                  <input
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
                  <label className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
                    平均取得単価 (円またはドル)
                  </label>
                  <input
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
            </div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
