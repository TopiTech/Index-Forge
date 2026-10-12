import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  BookmarkPlus,
  Briefcase,
  ExternalLink,
  ArrowLeft,
  BarChart2,
  PieChart,
  RefreshCw,
} from "lucide-react";
import {
  getCachedStockFundamentals,
  fetchStockFundamentals,
  formatMarketCapDisplay,
  type StockQuoteFundamentals,
} from "../lib/marketDataService";
import { useTheme } from "../lib/theme";
import {
  formatStockPrice,
  formatStockChange,
  formatUsdWithJpyEstimate,
  getCurrencyMeta,
} from "../lib/currency";
import { StockTechnicalChart } from "./StockTechnicalChart";
import type { PageView } from "../lib/navigation";

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
  const { theme } = useTheme();
  const [stock, setStock] = useState<StockQuoteFundamentals>(() =>
    getCachedStockFundamentals(ticker),
  );
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"CHART" | "FINANCIALS">("CHART");

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadStockData = useCallback(async (targetTicker: string, forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const data = await fetchStockFundamentals(targetTicker, forceRefresh);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setStock(data);
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    setStock(getCachedStockFundamentals(ticker));
    void loadStockData(ticker);
  }, [ticker, loadStockData]);

  const isPositive = stock.changePercent >= 0;
  const currencyMeta = getCurrencyMeta(stock.ticker, stock.market);

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

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div className="sr-only" role="status" aria-live="polite">
            {loading ? "銘柄データを読み込み中..." : `${stock.name} の最新データを表示中`}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => void loadStockData(stock.ticker, true)}
            title="最新データを再取得"
          >
            <RefreshCw size={13} className={loading ? "spin animate-spin" : ""} />
            <span>更新</span>
          </button>

          <a
            href={`https://jp.tradingview.com/symbols/${stock.market === "US" ? stock.ticker : `TSE-${stock.ticker}`}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm btn-outline"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px", textDecoration: "none" }}
            title="TradingView公式ページを開く（新規タブ）"
          >
            <span>TradingView公式</span>
            <ExternalLink size={13} />
          </a>

          {onAddToIndex && (
            <button
              type="button"
              className="btn btn-sm btn-accent"
              onClick={() => {
                // The owner reports the real outcome: without an editable
                // index the action only opens the builder, which must not
                // be announced as a successful add.
                onAddToIndex(stock.ticker, stock.name, stock.theme);
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
              {stock.isDemoData ? (
                <span
                  className="badge badge-default mono tiny"
                  title="この銘柄の数値は実データではなくティッカー名から擬似生成した参考値 (デモ) です"
                >
                  参考値 (デモ)
                </span>
              ) : (
                <span className="badge badge-accent mono tiny">LIVE</span>
              )}
              <span className="badge badge-default mono tiny">{stock.market}</span>
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

          <div className="stock-hero-price" style={{ textAlign: "right" }}>
            <div style={{ fontSize: "2.2rem", fontWeight: 800 }} className="mono">
              {currencyMeta.symbol}
              {stock.price.toLocaleString("en-US", {
                minimumFractionDigits: stock.market === "US" ? 2 : 1,
                maximumFractionDigits: stock.market === "US" ? 2 : 1,
              })}
              <span className="tiny muted" style={{ fontSize: "1rem", marginLeft: "6px", fontWeight: 400 }}>
                {currencyMeta.code}
              </span>
            </div>

            {currencyMeta.isUSD && (
              <div className="tiny muted mono" style={{ fontSize: "0.82rem", marginTop: 2, marginBottom: 4 }}>
                {formatUsdWithJpyEstimate(stock.price)}
              </div>
            )}

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
                {formatStockChange(stock.change, stock.ticker, { market: stock.market })} ({isPositive ? "+" : ""}
                {stock.changePercent.toFixed(2)}%)
              </span>
              <span className="tiny muted" style={{ fontWeight: 400, marginLeft: 4 }}>
                前日終値: {formatStockPrice(stock.previousClose, stock.ticker, { market: stock.market })}
              </span>
            </div>
            {stock.dayHigh > 0 && stock.dayLow > 0 && (
              <div className="tiny muted mono" style={{ marginTop: 4 }}>
                当日レンジ: {formatStockPrice(stock.dayLow, stock.ticker, { market: stock.market })} - {formatStockPrice(stock.dayHigh, stock.ticker, { market: stock.market })}
                {stock.volume > 0 && ` | 出来高: ${currencyMeta.isUSD ? (stock.volume / 1000000).toFixed(1) + "M" : (stock.volume / 10000).toFixed(0) + "万株"}`}
              </div>
            )}
          </div>
        </div>

        {/* 52-Week Range Bar */}
        <div style={{ marginTop: "24px", paddingTop: "18px", borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "6px", flexWrap: "wrap", gap: "4px" }}>
            <span>52週安値: <strong className="mono">{formatStockPrice(stock.yearLow, stock.ticker, { market: stock.market })}</strong></span>
            <span>現在位置: <strong className="mono" style={{ color: "var(--accent-text)" }}>{yearPositionPct.toFixed(0)}% レンジ</strong></span>
            <span>52週高値: <strong className="mono">{formatStockPrice(stock.yearHigh, stock.ticker, { market: stock.market })}</strong></span>
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
          <span className="tiny muted">
            1株配当: {stock.dps !== null && stock.dps !== undefined ? `${stock.dps} ${currencyMeta.code}` : "--"}
          </span>
        </div>

        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">時価総額</span>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4 }}>
            {formatMarketCapDisplay(stock.marketCap, stock.market)}
          </div>
          <span className="tiny muted">
            {stock.market === "US" ? "グローバル大型株" : "東証大型優良株"}
          </span>
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

      {/* Tabs: Interactive Chart / Financials */}
      <div
        role="tablist"
        aria-label="銘柄詳細タブ"
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
          role="tab"
          id="stock-tab-chart"
          aria-selected={activeTab === "CHART"}
          aria-controls="stock-tabpanel-chart"
          tabIndex={activeTab === "CHART" ? 0 : -1}
          className={`btn btn-sm ${activeTab === "CHART" ? "btn-accent" : "btn-ghost"}`}
          onClick={() => setActiveTab("CHART")}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              setActiveTab("FINANCIALS");
              document.getElementById("stock-tab-financials")?.focus();
            }
          }}
        >
          <BarChart2 size={14} />
          <span>テクニカルチャート</span>
        </button>
        <button
          type="button"
          role="tab"
          id="stock-tab-financials"
          aria-selected={activeTab === "FINANCIALS"}
          aria-controls="stock-tabpanel-financials"
          tabIndex={activeTab === "FINANCIALS" ? 0 : -1}
          className={`btn btn-sm ${activeTab === "FINANCIALS" ? "btn-accent" : "btn-ghost"}`}
          onClick={() => setActiveTab("FINANCIALS")}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              setActiveTab("CHART");
              document.getElementById("stock-tab-chart")?.focus();
            }
          }}
        >
          <PieChart size={14} />
          <span>業績・財務ハイライト (4期推移)</span>
        </button>
      </div>

      {/* Tab 1: Interactive Hybrid Technical Chart Engine */}
      {activeTab === "CHART" && (
        <div
          role="tabpanel"
          id="stock-tabpanel-chart"
          aria-labelledby="stock-tab-chart"
        >
          <StockTechnicalChart stock={stock} theme={theme} />
        </div>
      )}

      {/* Tab 2: Historical Financials Performance Table & Visuals */}
      {activeTab === "FINANCIALS" && (
        <div
          role="tabpanel"
          id="stock-tabpanel-financials"
          aria-labelledby="stock-tab-financials"
          className="card"
          style={{ padding: "20px" }}
        >
          <div style={{ marginBottom: "16px" }}>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: 0 }}>
              財務業績・収益性推移 (通期)
            </h3>
            <p className="tiny muted" style={{ margin: "4px 0 0" }}>
              売上高・営業利益・当期純利益・1株当たり配当金の直近実績および今期予想
            </p>
          </div>

          <div
            tabIndex={0}
            role="region"
            aria-label="業績・財務ハイライト推移テーブル"
            className="financials-table-container"
            style={{ overflowX: "auto" }}
          >
            <table className="constituents-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>決算期</th>
                  <th style={{ textAlign: "right" }}>売上高 ({stock.market === "US" ? "百万ドル" : "億円"})</th>
                  <th style={{ textAlign: "right" }}>営業利益 ({stock.market === "US" ? "百万ドル" : "億円"})</th>
                  <th style={{ textAlign: "right" }}>営業利益率</th>
                  <th style={{ textAlign: "right" }}>純利益 ({stock.market === "US" ? "百万ドル" : "億円"})</th>
                  <th style={{ textAlign: "right" }}>EPS ({stock.market === "US" ? "USD" : "円"})</th>
                  <th style={{ textAlign: "right" }}>1株配当 ({stock.market === "US" ? "USD" : "円"})</th>
                </tr>
              </thead>
              <tbody>
                {stock.historicalFinances.map((f, idx) => {
                  const opMargin =
                    f.revenue > 0
                      ? Number(((f.operatingIncome / f.revenue) * 100).toFixed(1))
                      : 0;
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
