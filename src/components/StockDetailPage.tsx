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
  AlertCircle,
} from "lucide-react";
import {
  getCachedStockFundamentals,
  fetchStockFundamentals,
  formatMarketCapDisplay,
  isMacroAsset,
  getSectorAveragePer,
  evaluateTechnicalSignal,
  type StockQuoteFundamentals,
} from "../lib/marketDataService";
import { useTheme } from "../lib/theme";
import {
  formatStockPrice,
  formatStockChange,
  formatUsdWithJpyEstimate,
  getCurrencyMeta,
} from "../lib/currency";
import { DEFAULT_USD_JPY_RATE } from "../data/marketConstants";
import { StockTechnicalChart } from "./StockTechnicalChart";
import { getTradingViewWebUrl } from "../lib/tradingView";
import type { PageView } from "../lib/navigation";
import { useRegisterFreshness } from "../contexts/FreshnessContext";
import { formatMarketLabel, formatDynamicSector, formatDynamicIndustry } from "../lib/marketFormatter";

export function getRoeEvaluation(roe: number | null | undefined, isMacro: boolean): string {
  if (isMacro || roe === null || roe === undefined || !Number.isFinite(roe)) return "指数・マクロ指標対象外";
  if (roe >= 15) return "極めて高い資本効率 (>15%)";
  if (roe >= 8) return "資本効率良好 (目安: 8%以上)";
  if (roe > 0) return "標準水準 (8%未満)";
  return "収益性要改善 (低水準)";
}

export function getMarketCapEvaluation(cap: number | null | undefined, market: string, isMacro: boolean): string {
  if (isMacro) return "指数・マクロ資産";
  if (market === "US") {
    if (cap && cap >= 100000) return "米国メガキャップ (1,000億ドル超)";
    if (cap && cap >= 10000) return "米国大型優良株 (100億ドル超)";
    return "米国市場上場株";
  }
  if (market === "GROWTH") return "東証グロース市場";
  if (market === "STANDARD") return "東証スタンダード市場";
  if (market === "ETF") return "東証上場ETF";
  if (market === "REIT") return "東証不動産投信 (REIT)";
  if (cap && cap >= 100000) return "超大型優良株 (時価総額10兆円超)";
  if (cap && cap >= 10000) return "大型優良株 (時価総額1兆円超)";
  if (cap && cap >= 1000) return "中型株 (時価総額1,000億円超)";
  return "東証プライム市場";
}

export function getPbrEvaluation(pbr: number | null | undefined, isMacro: boolean): string {
  if (isMacro || pbr === null || pbr === undefined || !Number.isFinite(pbr) || pbr <= 0) return "指数・マクロ指標対象外";
  if (pbr < 1.0) return "割安 (解散価値1倍割れ)";
  if (pbr <= 2.5) return "適正〜標準水準 (1.0〜2.5倍)";
  if (pbr <= 5.0) return "成長期待水準 (2.5〜5.0倍)";
  return "高PBR・成長期待水準 (>5.0倍)";
}

export function getDividendEvaluation(
  dividendYield: number | null | undefined,
  dps: number | null | undefined,
  currencyCode: string,
  isMacro: boolean,
): string {
  if (isMacro) return "1株配当: --";
  const hasDps = dps !== null && dps !== undefined && Number.isFinite(dps) && dps > 0;
  const hasYield = dividendYield !== null && dividendYield !== undefined && Number.isFinite(dividendYield) && dividendYield > 0;
  if (!hasDps && !hasYield && (dividendYield === 0 || dps === 0)) {
    return "無配・内部留保/成長投資重視";
  }
  if (hasDps) {
    const formattedDps =
      currencyCode === "JPY"
        ? `${Number.isInteger(dps) ? dps : dps.toFixed(1)} 円`
        : currencyCode === "USD"
        ? `$${dps.toFixed(2)}`
        : `${dps} ${currencyCode}`;
    return `1株配当: ${formattedDps}${hasYield && dividendYield >= 3.5 ? " (高配当水準)" : ""}`;
  }
  if (hasYield) {
    return dividendYield >= 3.5 ? "高配当水準 (利回り3.5%超)" : "配当実施中";
  }
  return "1株配当: --";
}

interface StockDetailPageProps {
  ticker?: string;
  onNavigate: (view: PageView, searchParams?: string) => void;
  onAddToIndex?: (ticker: string, name: string, theme: string) => void;
  onAddToWatchlist?: (ticker: string) => void;
  onAddToPortfolio?: (ticker: string, currentPrice: number, stockName?: string) => void;
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
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"CHART" | "FINANCIALS">("CHART");

  useRegisterFreshness("stock", {
    loading,
    updatedAt: lastUpdatedAt,
    stale: Boolean(stock.isDemoData),
    typeLabel: `${stock.ticker} 銘柄情報`,
  });

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const hasAutoRetriedRef = useRef<string | null>(null);
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
      setLastUpdatedAt(Date.now());

      // 初回ロードでデモフォールバックだった場合、Worker側Crumbウォームアップ完了直後の実データを1回自動再取得
      if (data.isDemoData && !forceRefresh && hasAutoRetriedRef.current !== targetTicker) {
        hasAutoRetriedRef.current = targetTicker;
        setTimeout(() => {
          if (mountedRef.current && requestId === requestIdRef.current) {
            void loadStockData(targetTicker, true);
          }
        }, 1200);
      }
    } catch {
      // Gracefully retain existing cached data on unexpected network error
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    hasAutoRetriedRef.current = null;
    setStock(getCachedStockFundamentals(ticker));
    void loadStockData(ticker);
  }, [ticker, loadStockData]);

  const isPositive = stock.changePercent >= 0;
  const isMacro = isMacroAsset(stock.ticker);
  const currencyMeta = getCurrencyMeta(stock.ticker, stock.market);

  // Switching to another ticker must not keep the previously selected tab: a
  // macro asset (index / FX / commodity) has no financial statements, so the
  // FINANCIALS tab disappears and the panel rendered an orphan empty table
  // under a macro header (UI-27).
  useEffect(() => {
    setActiveTab("CHART");
  }, [stock.ticker]);

  // Calculate 52-week price position percentage
  const rawRange =
    typeof stock.yearHigh === "number" && typeof stock.yearLow === "number"
      ? stock.yearHigh - stock.yearLow
      : 0;
  const yearRange = Number.isFinite(rawRange) && rawRange > 0 ? rawRange : 1;
  const rawPosition =
    typeof stock.price === "number" && typeof stock.yearLow === "number"
      ? ((stock.price - stock.yearLow) / yearRange) * 100
      : 50;
  const yearPositionPct = Number.isFinite(rawPosition)
    ? Math.max(0, Math.min(100, Math.round(rawPosition)))
    : 50;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container stock-detail-page"
    >
      {/* Fallback / Demo Notice Banner (a static disclosure, not a live alert:
          role="alert" made screen readers interrupt on every open) */}
      {stock.isDemoData && (
        <div
          role="note"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            padding: "10px 16px",
            marginBottom: "16px",
            borderRadius: "8px",
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            fontSize: "0.85rem",
            color: "var(--neon-amber, #f59e0b)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>
              リアルタイム実データの取得が一時的に利用できないか未対応のため、<strong>参考値（デモデータ）</strong>を表示しています。
            </span>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={() => void loadStockData(stock.ticker, true)}
            disabled={loading}
            style={{ borderColor: "rgba(245, 158, 11, 0.4)", color: "var(--text-primary)" }}
          >
            <RefreshCw size={11} className={loading ? "spin animate-spin" : ""} style={{ marginRight: 4 }} />
            <span>再取得</span>
          </button>
        </div>
      )}

      {/* Breadcrumb Navigation Bar */}
      <nav aria-label="パンくずリスト" className="stock-detail-breadcrumb-nav">
        <ol className="stock-breadcrumb-list">
          <li className="stock-breadcrumb-item">
            <button
              type="button"
              className="stock-breadcrumb-link"
              onClick={() => onNavigate("dashboard")}
            >
              ホーム
            </button>
          </li>
          <li className="stock-breadcrumb-separator" aria-hidden="true">/</li>
          <li className="stock-breadcrumb-item">
            <button
              type="button"
              className="stock-breadcrumb-link"
              onClick={() => onNavigate("stock")}
            >
              銘柄分析
            </button>
          </li>
          <li className="stock-breadcrumb-separator" aria-hidden="true">/</li>
          <li className="stock-breadcrumb-item">
            <button
              type="button"
              className="stock-breadcrumb-link"
              onClick={() => onNavigate("market")}
            >
              マーケット
            </button>
          </li>
          <li className="stock-breadcrumb-separator" aria-hidden="true">/</li>
          <li className="stock-breadcrumb-item">
            <button
              type="button"
              className="stock-breadcrumb-link"
              onClick={() => onNavigate("screener")}
            >
              スクリーナー
            </button>
          </li>
          <li className="stock-breadcrumb-separator" aria-hidden="true">/</li>
          <li className="stock-breadcrumb-item current" aria-current="page">
            <span className="stock-breadcrumb-current-text">{stock.name} ({stock.ticker})</span>
          </li>
        </ol>
      </nav>

      {/* Top Back Nav & Actions Bar */}
      <div
        className="stock-detail-actions-bar"
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
          onClick={() => onNavigate("stock")}
          aria-label="銘柄分析トップへ戻る"
        >
          <ArrowLeft size={15} />
          <span>銘柄分析へ戻る</span>
        </button>

        <div className="stock-detail-actions-group" style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
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
            href={getTradingViewWebUrl(stock.ticker, stock.market)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm btn-outline"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px", textDecoration: "none" }}
            title="TradingView公式ページを開く（新規タブ）"
          >
            <span>TradingView公式</span>
            <ExternalLink size={13} />
          </a>

          {onAddToIndex && !isMacro && (
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
              disabled={isMacro}
              title={isMacro ? "マクロ資産・指数・為替はポートフォリオ登録対象外です" : undefined}
              onClick={() => {
                if (isMacro) return;
                onAddToPortfolio(stock.ticker, stock.price, stock.name);
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
          className="stock-hero-inner"
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
              <span className="badge badge-default mono tiny">{formatMarketLabel(stock.market)}</span>
              <span className="badge badge-default mono tiny">{formatDynamicSector(stock.sector)}</span>
              {stock.industry && (
                <span className="badge badge-outline mono tiny">{formatDynamicIndustry(stock.industry)}</span>
              )}
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
              {stock.price.toLocaleString(currencyMeta.isJPY ? "ja-JP" : "en-US", {
                minimumFractionDigits: stock.market === "US" ? 2 : Number.isInteger(stock.price) ? 0 : 2,
                maximumFractionDigits: 2,
              })}
              <span className="tiny muted" style={{ fontSize: "1rem", marginLeft: "6px", fontWeight: 400 }}>
                {currencyMeta.code}
              </span>
            </div>

            {currencyMeta.isUSD && (
              <div className="tiny muted mono" style={{ fontSize: "0.82rem", marginTop: 2, marginBottom: 4 }}>
                {formatUsdWithJpyEstimate(
                  stock.price,
                  getCachedStockFundamentals("USDJPY=X")?.price || DEFAULT_USD_JPY_RATE,
                )}
              </div>
            )}

            {(() => {
              const isZero =
                Math.abs(stock.changePercent) < 0.005 ||
                Object.is(stock.changePercent, -0) ||
                stock.changePercent === 0;
              const changeColor = isZero
                ? "var(--text-muted)"
                : isPositive
                ? "var(--color-positive)"
                : "var(--color-negative)";

              return (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "1rem",
                    fontWeight: 700,
                    color: changeColor,
                  }}
                  className="mono"
                >
                  {!isZero && (isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />)}
                  <span>
                    {formatStockChange(stock.change, stock.ticker, { market: stock.market })} (
                    {!isZero && isPositive ? "+" : ""}
                    {stock.changePercent.toFixed(2)}%)
                  </span>
                  <span className="tiny muted" style={{ fontWeight: 400, marginLeft: 4 }}>
                    前日終値: {formatStockPrice(stock.previousClose, stock.ticker, { market: stock.market })}
                  </span>
                </div>
              );
            })()}
            {stock.dayHigh > 0 && stock.dayLow > 0 && (
              <div className="tiny muted mono" style={{ marginTop: 4 }}>
                当日レンジ: {formatStockPrice(stock.dayLow, stock.ticker, { market: stock.market })} - {formatStockPrice(stock.dayHigh, stock.ticker, { market: stock.market })}
                {stock.volume > 0 && !isMacro && ` | 出来高: ${currencyMeta.isUSD ? (stock.volume / 1000000).toFixed(1) + "M" : (stock.volume / 10000).toFixed(0) + "万株"}`}
              </div>
            )}
          </div>
        </div>

        {/* 52-Week Range Bar */}
        {!isMacro && stock.yearHigh > 0 && stock.yearLow > 0 && stock.yearHigh >= stock.yearLow && (
          <div style={{ marginTop: "24px", paddingTop: "18px", borderTop: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "6px", flexWrap: "wrap", gap: "4px" }}>
              <span>52週安値: <strong className="mono">{formatStockPrice(stock.yearLow, stock.ticker, { market: stock.market })}</strong></span>
              <span>現在位置: <strong className="mono" style={{ color: "var(--accent-text)" }}>{yearPositionPct.toFixed(0)}% レンジ</strong></span>
              <span>52週高値: <strong className="mono">{formatStockPrice(stock.yearHigh, stock.ticker, { market: stock.market })}</strong></span>
            </div>
            <div
              style={{
                height: "8px",
                background: "var(--surface-control)",
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
        )}
      </div>

      {/* Key Financial Fundamentals Metrics Grid */}
      <div
        className="stock-metrics-grid stock-fundamentals-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: "12px",
          marginBottom: "28px",
        }}
      >
        <div className="card" style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="tiny muted mono uppercase">PER (株価収益率)</span>
            {!isMacro && stock.isEstimatedPer && typeof stock.per === "number" && stock.per > 0 && (
              <span
                className="mono bold"
                style={{
                  fontSize: "0.68rem",
                  padding: "1px 6px",
                  borderRadius: "4px",
                  background: "rgba(0, 212, 255, 0.12)",
                  color: "var(--neon-cyan, #00d4ff)",
                  border: "1px solid rgba(0, 212, 255, 0.25)",
                }}
                title={stock.perNote || "会社予想非開示のため直近実績(TTM)より推計"}
              >
                推測 (実績TTM)
              </span>
            )}
          </div>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4 }}>
            {!isMacro && typeof stock.per === "number" && Number.isFinite(stock.per) && stock.per > 0
              ? `${stock.per.toFixed(1)}倍`
              : "--"}
          </div>
          <span className="tiny muted">
            {isMacro
              ? "指数・マクロ指標対象外"
              : typeof stock.per === "number" && Number.isFinite(stock.per) && stock.per > 0
              ? stock.isEstimatedPer
                ? `${stock.perNote || "直近実績(TTM)より推計"} (業界平均: ${getSectorAveragePer(stock.sector).toFixed(1)}倍)`
                : `業界平均: ${getSectorAveragePer(stock.sector).toFixed(1)}倍`
              : `非公開・算出対象外 (業界平均: ${getSectorAveragePer(stock.sector).toFixed(1)}倍)`}
          </span>
        </div>

        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">PBR (株価純資産倍率)</span>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4 }}>
            {!isMacro && typeof stock.pbr === "number" && Number.isFinite(stock.pbr) && stock.pbr > 0
              ? `${stock.pbr.toFixed(2)}倍`
              : "--"}
          </div>
          <span className="tiny muted">
            {getPbrEvaluation(stock.pbr, isMacro)}
          </span>
        </div>

        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">予想配当利回り</span>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4, color: "var(--neon-green)" }}>
            {!isMacro && stock.dividendYield !== null && stock.dividendYield !== undefined && Number.isFinite(stock.dividendYield)
              ? `${stock.dividendYield.toFixed(2)}%`
              : "--"}
          </div>
          <span className="tiny muted">
            {getDividendEvaluation(stock.dividendYield, stock.dps, currencyMeta.code, isMacro)}
          </span>
        </div>

        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">時価総額</span>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4 }}>
            {isMacro ? "--" : formatMarketCapDisplay(stock.marketCap, stock.market)}
          </div>
          <span className="tiny muted">
            {getMarketCapEvaluation(stock.marketCap, stock.market, isMacro)}
          </span>
        </div>

        <div className="card" style={{ padding: "14px 16px" }}>
          <span className="tiny muted mono uppercase">ROE (自己資本利益率)</span>
          <div className="mono bold" style={{ fontSize: "1.3rem", marginTop: 4 }}>
            {!isMacro && typeof stock.roe === "number" && Number.isFinite(stock.roe) ? `${stock.roe.toFixed(1)}%` : "--"}
          </div>
          <span className="tiny muted">{getRoeEvaluation(stock.roe, isMacro)}</span>
        </div>

        {(() => {
          const techEval = evaluateTechnicalSignal(stock.changePercent, stock.sparkline, stock.price);
          const techSignalLabel =
            stock.technicalSignal === "STRONG_BUY"
              ? "強気買い"
              : stock.technicalSignal === "BUY"
              ? "買い"
              : stock.technicalSignal === "SELL"
              ? "売り"
              : stock.technicalSignal === "STRONG_SELL"
              ? "強気売り"
              : "中立";

          const techSignalColor =
            stock.technicalSignal === "STRONG_BUY" || stock.technicalSignal === "BUY"
              ? "var(--color-positive, #10b981)"
              : stock.technicalSignal === "SELL" || stock.technicalSignal === "STRONG_SELL"
              ? "var(--color-negative, #f43f5e)"
              : "var(--accent-text, #38bdf8)";

          return (
            <div className="card" style={{ padding: "14px 16px" }}>
              <span className="tiny muted mono uppercase">テクニカル総合判定</span>
              <div className="mono bold" style={{ fontSize: "1.1rem", marginTop: 6, color: techSignalColor }}>
                {techSignalLabel}
              </div>
              <span className="tiny muted" title={techEval.reason}>
                {techEval.reason}
              </span>
            </div>
          );
        })()}
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
          aria-selected={isMacro || activeTab === "CHART"}
          aria-controls="stock-tabpanel-chart"
          tabIndex={activeTab === "CHART" ? 0 : -1}
          className={`btn btn-sm ${isMacro || activeTab === "CHART" ? "btn-accent" : "btn-ghost"}`}
          onClick={() => setActiveTab("CHART")}
          onKeyDown={(e) => {
            if (!isMacro && (e.key === "ArrowRight" || e.key === "ArrowDown")) {
              e.preventDefault();
              setActiveTab("FINANCIALS");
              document.getElementById("stock-tab-financials")?.focus();
            }
          }}
        >
          <BarChart2 size={14} />
          <span>テクニカルチャート</span>
        </button>
        {!isMacro && (
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
        )}
      </div>

      {/* Tab 1: Interactive Hybrid Technical Chart Engine */}
      {(activeTab === "CHART" || isMacro) && (
        <div
          role="tabpanel"
          id="stock-tabpanel-chart"
          aria-labelledby="stock-tab-chart"
        >
          <StockTechnicalChart stock={stock} theme={theme} />
        </div>
      )}

      {/* Tab 2: Historical Financials Performance Table & Visuals.
          Guarded by !isMacro: macro assets have no financial statements, so the
          panel must never render an empty table (UI-27). */}
      {activeTab === "FINANCIALS" && !isMacro && (
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
                {(stock.historicalFinances ?? []).map((f, idx) => {
                  const opMargin =
                    f.revenue > 0
                      ? Number(((f.operatingIncome / f.revenue) * 100).toFixed(1))
                      : 0;
                  const isLatest = idx === (stock.historicalFinances?.length ?? 1) - 1;
                  
                  // 1株配当の決定:
                  // 過去実績期 (!isLatest) はその期の確定実績 f.dps を最優先採用
                  // 今期予想期 (isLatest) は stock.dps / stock.dividendYield を反映
                  let rawDps: number | null | undefined;
                  if (!isLatest) {
                    rawDps = typeof f.dps === "number" && Number.isFinite(f.dps) ? f.dps : undefined;
                  } else {
                    if (stock.dps !== null && stock.dps !== undefined && Number.isFinite(stock.dps)) {
                      rawDps = stock.dps;
                    } else if (stock.dividendYield === 0) {
                      rawDps = 0;
                    } else if (typeof f.dps === "number" && Number.isFinite(f.dps)) {
                      rawDps = f.dps;
                    } else {
                      rawDps = undefined;
                    }
                  }

                  const hasDps = typeof rawDps === "number" && Number.isFinite(rawDps);
                  const formattedDps = !hasDps
                    ? "--"
                    : stock.market === "US"
                    ? (rawDps === 0 ? "0.00" : Number(rawDps).toFixed(2))
                    : (rawDps === 0 ? "0" : Number.isInteger(rawDps) ? String(rawDps) : Number(rawDps).toFixed(1));
                  const isOpLoss = typeof f.operatingIncome === "number" && f.operatingIncome < 0;
                  const isNetLoss = typeof f.netIncome === "number" && f.netIncome < 0;

                  return (
                    <tr key={f.fiscalYear} style={{ background: isLatest ? "rgba(56, 189, 248, 0.05)" : "transparent" }}>
                      <td style={{ fontWeight: isLatest ? 700 : 500 }} className="mono">
                        {f.fiscalYear}
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {f.revenue.toLocaleString()}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: isOpLoss ? "var(--color-negative, #f43f5e)" : "inherit",
                        }}
                        className="mono"
                      >
                        {f.operatingIncome.toLocaleString()}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: isOpLoss ? "var(--color-negative, #f43f5e)" : "var(--accent-text)",
                        }}
                        className="mono bold"
                      >
                        {opMargin}%
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: isNetLoss ? "var(--color-negative, #f43f5e)" : "inherit",
                        }}
                        className="mono"
                      >
                        {f.netIncome.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {f.eps !== null && f.eps !== undefined && Number.isFinite(f.eps)
                          ? stock.market === "US" && !Number.isInteger(f.eps)
                            ? Number(f.eps).toFixed(2)
                            : f.eps
                          : "--"}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: typeof rawDps === "number" && rawDps > 0 ? "var(--neon-green)" : "var(--text-muted)",
                        }}
                        className="mono bold"
                      >
                        {formattedDps}
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
