import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  BookmarkPlus,
  Briefcase,
  Share2,
  ExternalLink,
  ArrowLeft,
  BarChart2,
  PieChart,
  ShieldCheck,
  CheckCircle,
} from "lucide-react";
import {
  getStockFundamentals,
  type StockQuoteFundamentals,
} from "../lib/marketDataService";
import type { PageView } from "../lib/navigation";
import { useToast } from "./Toast";

interface StockDetailPageProps {
  ticker?: string;
  onNavigate: (view: PageView, searchParams?: string) => void;
  onAddToIndex?: (ticker: string, name: string, theme: string) => void;
  onAddToWatchlist?: (ticker: string) => void;
  onAddToPortfolio?: (ticker: string, currentPrice: number) => void;
}

export function StockDetailPage({
  ticker = "7203",
  onNavigate,
  onAddToIndex,
  onAddToWatchlist,
  onAddToPortfolio,
}: StockDetailPageProps) {
  const [stock, setStock] = useState<StockQuoteFundamentals>(() =>
    getStockFundamentals(ticker),
  );
  const [activeTab, setActiveTab] = useState<"CHART" | "FINANCIALS" | "PEERS">("CHART");
  const { success } = useToast();

  useEffect(() => {
    setStock(getStockFundamentals(ticker));
  }, [ticker]);

  const isPositive = stock.changePercent >= 0;

  // Calculate 52-week price position percentage
  const yearRange = stock.yearHigh - stock.yearLow || 1;
  const yearPositionPct = Math.max(
    0,
    Math.min(100, ((stock.price - stock.yearLow) / yearRange) * 100),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container stock-detail-page"
      style={{ maxWidth: "1280px", margin: "0 auto", padding: "16px 20px 48px" }}
    >
      {/* Top Back Nav & Actions Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <button
          type="button"
          className="btn btn-default btn-sm"
          onClick={() => onNavigate("dashboard")}
        >
          <ArrowLeft size={15} />
          <span>ダッシュボードへ戻る</span>
        </button>

        <div style={{ display: "flex", gap: "8px" }}>
          {onAddToIndex && (
            <button
              type="button"
              className="btn btn-sm btn-accent"
              onClick={() => {
                onAddToIndex(stock.ticker, stock.name, stock.theme);
                success(`「${stock.name}」を指数ビルダーに追加しました`);
              }}
            >
              <Sparkles size={14} />
              <span>指数に追加</span>
            </button>
          )}

          {onAddToWatchlist && (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => {
                onAddToWatchlist(stock.ticker);
                success(`「${stock.name}」をウォッチリストに登録しました`);
              }}
            >
              <BookmarkPlus size={14} />
              <span>監視銘柄へ</span>
            </button>
          )}

          {onAddToPortfolio && (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => {
                onAddToPortfolio(stock.ticker, stock.price);
                success(`「${stock.name}」をポートフォリオ登録へ転送`);
              }}
            >
              <Briefcase size={14} />
              <span>保有登録</span>
            </button>
          )}
        </div>
      </div>

      {/* Hero Stock Header Card */}
      <div
        className="card"
        style={{
          padding: "24px",
          marginBottom: "24px",
          background: "linear-gradient(135deg, var(--bg-card) 0%, rgba(30, 41, 59, 0.4) 100%)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "20px",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span className="badge badge-accent mono tiny">{stock.market}</span>
              <span className="badge badge-default mono tiny">{stock.sector}</span>
              <span className="tiny muted mono">THEME: {stock.theme}</span>
            </div>
            <h1 style={{ fontSize: "1.9rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
              {stock.name}
              <span className="mono muted" style={{ fontSize: "1.2rem", marginLeft: "10px", fontWeight: 500 }}>
                ({stock.ticker})
              </span>
            </h1>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "2.2rem", fontWeight: 800 }} className="mono">
              {stock.price.toLocaleString("en-US", { minimumFractionDigits: 1 })}
              <span className="tiny muted" style={{ fontSize: "1rem", marginLeft: "6px", fontWeight: 400 }}>
                {stock.market === "US" ? "USD" : "JPY"}
              </span>
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "1rem",
                fontWeight: 700,
                color: isPositive ? "var(--color-positive)" : "var(--color-negative)",
              }}
              className="mono"
            >
              {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              <span>
                {isPositive ? "+" : ""}
                {stock.change.toFixed(1)} ({isPositive ? "+" : ""}
                {stock.changePercent.toFixed(2)}%)
              </span>
              <span className="tiny muted" style={{ fontWeight: 400, marginLeft: 4 }}>
                前日終値: {stock.previousClose.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* 52-Week Range Bar */}
        <div style={{ marginTop: "24px", paddingTop: "18px", borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "6px" }}>
            <span>52週安値: <strong className="mono">{stock.yearLow.toLocaleString()}</strong></span>
            <span>現在位置: <strong className="mono" style={{ color: "var(--accent-text)" }}>{yearPositionPct.toFixed(0)}% レンジ</strong></span>
            <span>52週高値: <strong className="mono">{stock.yearHigh.toLocaleString()}</strong></span>
          </div>
          <div
            style={{
              height: "8px",
              background: "rgba(255, 255, 255, 0.08)",
              borderRadius: "4px",
              position: "relative",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${yearPositionPct}%`,
                background: "linear-gradient(90deg, #38bdf8, #818cf8)",
                borderRadius: "4px",
              }}
            />
          </div>
        </div>
      </div>

      {/* Key Financial Fundamentals Metrics Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: "12px",
          marginBottom: "28px",
        }}
      >
        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">PER (株価収益率)</span>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4 }}>
            {stock.per ? `${stock.per.toFixed(1)}倍` : "--"}
          </div>
          <span className="tiny muted">業界平均: 14.5倍</span>
        </div>

        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">PBR (株価純資産倍率)</span>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4 }}>
            {stock.pbr ? `${stock.pbr.toFixed(2)}倍` : "--"}
          </div>
          <span className="tiny muted">
            {stock.pbr && stock.pbr < 1.0 ? "割安 (1倍割れ)" : "適正水準"}
          </span>
        </div>

        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">予想配当利回り</span>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4, color: "#10b981" }}>
            {stock.dividendYield ? `${stock.dividendYield.toFixed(2)}%` : "--"}
          </div>
          <span className="tiny muted">1株配当: {stock.dps ?? "--"}円</span>
        </div>

        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">時価総額</span>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4 }}>
            {(stock.marketCap / 100).toFixed(0)}
            <span className="tiny" style={{ fontWeight: 400, marginLeft: 2 }}>
              {stock.market === "US" ? "億ドル" : "億円"}
            </span>
          </div>
          <span className="tiny muted">大型優良株</span>
        </div>

        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">ROE (自己資本利益率)</span>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4 }}>
            {stock.roe ? `${stock.roe.toFixed(1)}%` : "--"}
          </div>
          <span className="tiny muted">高資本効率 (&gt;8%)</span>
        </div>

        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">テクニカル総合判定</span>
          <div className="mono bold" style={{ fontSize: "1.1rem", marginTop: 6, color: "var(--accent-text)" }}>
            {stock.technicalSignal}
          </div>
          <span className="tiny muted">移動平均線 & RSI</span>
        </div>
      </div>

      {/* Tabs: Interactive Chart / Financials / Peers */}
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
          className={`btn btn-sm ${activeTab === "CHART" ? "btn-accent" : "btn-ghost"}`}
          onClick={() => setActiveTab("CHART")}
        >
          <BarChart2 size={14} />
          <span>テクニカルチャート</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeTab === "FINANCIALS" ? "btn-accent" : "btn-ghost"}`}
          onClick={() => setActiveTab("FINANCIALS")}
        >
          <PieChart size={14} />
          <span>業績・財務ハイライト (4期推移)</span>
        </button>
      </div>

      {/* Tab 1: Interactive Chart Placeholder with TradingView Widget Container */}
      {activeTab === "CHART" && (
        <div className="card" style={{ padding: "20px", minHeight: "450px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="badge badge-accent mono tiny">TRADINGVIEW ENGINE</span>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>
                {stock.name} 日足・移動平均線チャート
              </h3>
            </div>
            <span className="tiny muted mono">25日 / 75日 / 200日 SMA</span>
          </div>

          {/* Fallback chart visual container */}
          <div
            style={{
              height: "360px",
              background: "var(--bg-app)",
              borderRadius: "8px",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0.25,
                background: "repeating-linear-gradient(0deg, var(--border-subtle) 0px, var(--border-subtle) 1px, transparent 1px, transparent 40px)",
              }}
            />
            <div style={{ textAlign: "center", zIndex: 1, padding: "20px" }}>
              <BarChart2 size={36} className="muted" style={{ marginBottom: 12 }} />
              <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>
                TradingView リアルタイム高機能チャート
              </div>
              <p className="tiny muted" style={{ maxWidth: 420, margin: "6px auto 16px" }}>
                ヘッダーのティッカーまたは構成銘柄クリックで、ポップアップ詳細TradingViewチャートをフル画面展開してインジケーター描画・オシレーター分析が可能です。
              </p>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => {
                  window.open(`https://jp.tradingview.com/symbols/${stock.market === "US" ? stock.ticker : `TSE-${stock.ticker}`}/`, "_blank");
                }}
              >
                <span>TradingView 公式で開く</span>
                <ExternalLink size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Historical Financials Performance Table & Visuals */}
      {activeTab === "FINANCIALS" && (
        <div className="card" style={{ padding: "20px" }}>
          <div style={{ marginBottom: "16px" }}>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: 0 }}>
              財務業績・収益性推移 (通期)
            </h3>
            <p className="tiny muted" style={{ margin: "4px 0 0" }}>
              売上高・営業利益・当期純利益・1株当たり配当金の直近実績および今期予想
            </p>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="constituents-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>決算期</th>
                  <th style={{ textAlign: "right" }}>売上高 (億円)</th>
                  <th style={{ textAlign: "right" }}>営業利益 (億円)</th>
                  <th style={{ textAlign: "right" }}>営業利益率</th>
                  <th style={{ textAlign: "right" }}>純利益 (億円)</th>
                  <th style={{ textAlign: "right" }}>EPS (円)</th>
                  <th style={{ textAlign: "right" }}>1株配当 (円)</th>
                </tr>
              </thead>
              <tbody>
                {stock.historicalFinances.map((f, idx) => {
                  const opMargin = Number(((f.operatingIncome / f.revenue) * 100).toFixed(1));
                  const isLatest = idx === stock.historicalFinances.length - 1;
                  return (
                    <tr key={f.fiscalYear} style={{ background: isLatest ? "rgba(56, 189, 248, 0.05)" : "transparent" }}>
                      <td style={{ fontWeight: isLatest ? 700 : 500 }} className="mono">
                        {f.fiscalYear}
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {f.revenue.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {f.operatingIncome.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--accent-text)" }} className="mono bold">
                        {opMargin}%
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {f.netIncome.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {f.eps}
                      </td>
                      <td style={{ textAlign: "right", color: "#10b981" }} className="mono bold">
                        {f.dps}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}
