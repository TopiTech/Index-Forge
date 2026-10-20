import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Layers,
  ArrowRight,
  Newspaper,
  Compass,
  Zap,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import {
  fetchMarketOverview,
  formatDynamicRelativeTime,
  type MarketOverviewData,
  type MarketAssetQuote,
} from "../lib/marketDataService";
import { Skeleton, SkeletonStatGrid, SkeletonCard, SkeletonTable } from "./Skeleton";
import { changeTone, formatSignedPercent } from "./changeTone";
import type { PageView } from "../lib/navigation";
import { useRegisterFreshness } from "../contexts/FreshnessContext";

/**
 * `/api/market/overview` marks an asset that fell back to its previous quote or
 * to the static baseline with `stale: true` (DATA-03). The flag is additive, so
 * it is read defensively here instead of assuming every payload carries it.
 */
function isStaleAsset(asset: MarketAssetQuote): boolean {
  return (asset as MarketAssetQuote & { stale?: boolean }).stale === true;
}

interface MarketOverviewPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
}

export function getFearGreedMeta(score: number): {
  label: string;
  badgeClass: string;
  gradient: string;
  textColor: string;
} {
  if (score >= 75) {
    return {
      label: "EXTREME GREED (極度の強気)",
      badgeClass: "badge-success",
      gradient: "linear-gradient(90deg, #10b981, #00ff9d)",
      textColor: "var(--neon-green)",
    };
  }
  if (score >= 55) {
    return {
      label: "GREED (強気相場)",
      badgeClass: "badge-success",
      gradient: "linear-gradient(90deg, #38bdf8, #10b981)",
      textColor: "#10b981",
    };
  }
  if (score >= 45) {
    return {
      label: "NEUTRAL (中立・拮抗)",
      badgeClass: "badge-default",
      gradient: "linear-gradient(90deg, #94a3b8, #38bdf8)",
      textColor: "var(--text-secondary)",
    };
  }
  if (score >= 25) {
    return {
      label: "FEAR (弱気相場)",
      badgeClass: "badge-warning",
      gradient: "linear-gradient(90deg, #f59e0b, #fb7185)",
      textColor: "var(--neon-amber)",
    };
  }
  return {
    label: "EXTREME FEAR (極度の警戒・総悲観)",
    badgeClass: "badge-danger",
    gradient: "linear-gradient(90deg, #ef4444, #f43f5e)",
    textColor: "var(--neon-red)",
  };
}

export function MarketOverviewPage({
  onNavigate,
  onOpenStockDetail,
}: MarketOverviewPageProps) {
  const [data, setData] = useState<MarketOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  // dataAsOf 欠損時のフォールバック。毎レンダーの Date.now() は useRegisterFreshness
  // の effect を毎回起動し再レンダーループになるため、取得完了時点の値を保持する。
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [selectedAssetTab, setSelectedAssetTab] = useState<"ALL" | "INDEX" | "FX" | "COMMODITY" | "CRYPTO">("ALL");

  // Assets the Worker could not refresh (previous quote / static baseline).
  // Computed before the freshness registration so the header badge never
  // claims LIVE for a payload that is only partially live.
  const staleAssetCount = useMemo(() => {
    if (!data) return 0;
    return [...data.indices, ...data.forex, ...data.commodities, ...data.crypto].filter(
      isStaleAsset,
    ).length;
  }, [data]);

  useRegisterFreshness("market", {
    loading,
    updatedAt: data?.dataAsOf || (data ? fetchedAt : null),
    stale: Boolean(data) && (data?.dataSource !== "live" || staleAssetCount > 0),
    typeLabel: "市況サマリー",
  });

  // The refresh button can fire again while a request is in flight, and the
  // page can unmount mid-request; tag each request so a stale response can
  // neither overwrite a newer one nor setState after unmount.
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Invalidate any in-flight response on unmount.
      requestIdRef.current += 1;
    };
  }, []);

  const loadData = useCallback(async (forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const result = await fetchMarketOverview(forceRefresh);
    if (!mountedRef.current || requestId !== requestIdRef.current) return;
    setData(result);
    setFetchedAt(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!data) {
    return (
      <div
        className="page-container market-overview-page"
        role="status"
        aria-live="polite"
        aria-label="市場データを読み込み中..."
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: "480px" }}>
            <Skeleton height="14px" width="140px" />
            <Skeleton height="32px" width="280px" />
            <Skeleton height="14px" width="380px" />
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Skeleton height="34px" width="80px" borderRadius="6px" />
            <Skeleton height="34px" width="160px" borderRadius="6px" />
          </div>
        </div>

        <SkeletonStatGrid count={4} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "16px",
            margin: "20px 0",
          }}
        >
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>

        <div style={{ marginTop: "24px" }}>
          <SkeletonTable rows={6} columns={5} />
        </div>
      </div>
    );
  }

  const allAssets: MarketAssetQuote[] = [
    ...data.indices,
    ...data.forex,
    ...data.commodities,
    ...data.crypto,
  ];

  const dataSource: string | undefined = data.dataSource;
  const isFallbackData = dataSource === "fallback";
  // "mixed" (or a live payload that still carries stale assets) must never be
  // presented as fully live: some of the cards are reference values.
  const isMixedData = !isFallbackData && (dataSource === "mixed" || staleAssetCount > 0);
  const isFullyLive = !isFallbackData && !isMixedData;

  const displayedAssets =
    selectedAssetTab === "ALL"
      ? allAssets
      : allAssets.filter((a) => a.category === selectedAssetTab);

  const sentiment = getFearGreedMeta(data.marketBreadth.sentimentScore);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container market-overview-page"
    >
      {/* Explicit Fallback Notice Banner */}
      {isFallbackData && (
        <div
          role="note"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            padding: "10px 16px",
            marginBottom: "20px",
            borderRadius: "8px",
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            fontSize: "0.85rem",
            color: "var(--neon-amber, #f59e0b)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>
              市場実データの取得が一時的に利用できないため、<strong>参考ベースラインデータ（フォールバック）</strong>を表示しています。
            </span>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={() => void loadData(true)}
            disabled={loading}
            aria-busy={loading}
            style={{ borderColor: "rgba(245, 158, 11, 0.4)", color: "var(--text-primary)" }}
          >
            <RefreshCw size={11} className={loading ? "spin" : ""} style={{ marginRight: 4 }} />
            <span>再取得</span>
          </button>
        </div>
      )}

      {/* Partial (mixed) provenance notice: some cards are reference values */}
      {isMixedData && (
        <div
          role="note"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            marginBottom: "20px",
            borderRadius: "8px",
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            fontSize: "0.85rem",
            color: "var(--neon-amber, #f59e0b)",
          }}
        >
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>
            一部の資産（{staleAssetCount}件）は実データを取得できなかったため、
            <strong>前回値または基準値（参考値）</strong>を表示しています。
          </span>
        </div>
      )}

      {/* Top Banner / Headline */}
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
            <span className="badge badge-accent mono tiny">MARKET INTELLIGENCE</span>
            {isFallbackData ? (
              <span
                className="badge mono tiny"
                title="実データの取得に失敗したため、静的ベースラインデータを表示しています"
                style={{
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  color: "var(--neon-amber)",
                }}
              >
                参考値 (フォールバック)
              </span>
            ) : isMixedData ? (
              <span
                className="badge mono tiny"
                title={`${staleAssetCount}件の資産が前回値または基準値です`}
                style={{
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  color: "var(--neon-amber)",
                }}
              >
                一部参考値 ({staleAssetCount})
              </span>
            ) : (
              <span
                className="badge badge-success mono tiny"
                title="全資産が実データで取得されています"
              >
                LIVE
              </span>
            )}
            {isFullyLive && (
              <span className="tiny muted mono">GLOBAL & TSE REAL-TIME MONITOR</span>
            )}
            {data.dataAsOf && (
              <span className="tiny muted mono" title="データ生成時刻">
                DATA AS OF: {(() => {
                  try {
                    const parsed = new Date(data.dataAsOf);
                    return isNaN(parsed.getTime()) ? data.dataAsOf : parsed.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
                  } catch {
                    return data.dataAsOf;
                  }
                })()}
              </span>
            )}
          </div>
          <h1 className="page-header-title">グローバル市場概況</h1>
          <p className="muted tiny" style={{ margin: "4px 0 0" }}>
            日米主要株価指数、為替、商品、暗号資産、東証業種別騰落率のリアルタイム統合サマリー
          </p>
        </div>

        <div className="market-overview-header-actions" style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => void loadData(true)}
            title="最新データを再取得"
            disabled={loading}
            aria-busy={loading}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
            <span>更新</span>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-accent"
            onClick={() => onNavigate("screener")}
          >
            <Zap size={13} />
            <span>銘柄スクリーナーへ</span>
          </button>
        </div>
      </div>

      {/* Market Breadth & Sentiment Bar */}
      <div
        className="card"
        style={{
          padding: "16px 20px",
          marginBottom: "24px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          alignItems: "center",
          background: "linear-gradient(180deg, var(--bg-card) 0%, rgba(20, 27, 45, 0.4) 100%)",
        }}
      >
        <div>
          <span className="tiny muted mono uppercase block">市場センチメント (Fear & Greed)</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginTop: "4px" }}>
            <span style={{ fontSize: "1.7rem", fontWeight: 700, color: sentiment.textColor }}>
              {data.marketBreadth.sentimentScore}
            </span>
            <span
              className={`badge ${sentiment.badgeClass} tiny mono`}
              style={{
                color: sentiment.textColor,
                background: `${sentiment.textColor}1a`,
                borderColor: `${sentiment.textColor}40`,
              }}
            >
              {sentiment.label}
            </span>
          </div>
          {/* Sentiment Progress Bar */}
          <div
            style={{
              height: "6px",
              width: "100%",
              background: "var(--surface-control)",
              borderRadius: "3px",
              marginTop: "8px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${data.marketBreadth.sentimentScore}%`,
                background: sentiment.gradient,
                borderRadius: "3px",
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>

        <div>
          <span className="tiny muted mono uppercase block">東証プライム 騰落銘柄数</span>
          <div className="market-breadth-counts" style={{ display: "flex", gap: "16px", marginTop: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <TrendingUp size={15} style={{ color: "var(--color-positive)" }} />
              <span className="mono bold" style={{ color: "var(--color-positive)" }}>
                値上がり {data.marketBreadth.gainers}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <TrendingDown size={15} style={{ color: "var(--color-negative)" }} />
              <span className="mono bold" style={{ color: "var(--color-negative)" }}>
                値下がり {data.marketBreadth.losers}
              </span>
            </div>
            <span className="mono tiny muted">変わらず {data.marketBreadth.unchanged}</span>
          </div>
        </div>

        <div className="market-breadth-action-group" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onNavigate("calendar")}
            style={{ border: "1px solid var(--border-subtle)" }}
          >
            <Compass size={14} />
            <span>経済指標カレンダー</span>
          </button>
        </div>
      </div>

      {/* Asset Filter Tabs */}
      <div
        role="group"
        aria-label="資産カテゴリフィルター"
        style={{
          display: "flex",
          gap: "6px",
          marginBottom: "16px",
          borderBottom: "1px solid var(--border-subtle)",
          paddingBottom: "10px",
          overflowX: "auto",
        }}
      >
        {(
          [
            { id: "ALL", label: "全アセット" },
            { id: "INDEX", label: "主要株価指数" },
            { id: "FX", label: "為替 (FX)" },
            { id: "COMMODITY", label: "コモディティ・債券" },
            { id: "CRYPTO", label: "暗号資産" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={selectedAssetTab === tab.id}
            className={`btn btn-sm ${selectedAssetTab === tab.id ? "btn-accent" : "btn-ghost"}`}
            onClick={() => setSelectedAssetTab(tab.id)}
            style={{ borderRadius: "20px", padding: "5px 14px" }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Global Assets Grid Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))",
          gap: "14px",
          marginBottom: "32px",
        }}
      >
        {displayedAssets.map((asset) => {
          // Zero (or a value that rounds to zero) is neutral: it must not
          // inherit the "gain" colour/arrow (UI-28).
          const assetIsStale = isStaleAsset(asset);
          const changeDigits = asset.category === "FX" && Math.abs(asset.price) < 20 ? 4 : 2;
          const tone = changeTone(asset.changePercent);
          const isPositive = tone === "positive";
          const isNegative = tone === "negative";
          const toneColor =
            tone === "positive"
              ? "var(--color-positive)"
              : tone === "negative"
                ? "var(--color-negative)"
                : "var(--text-muted)";
          const changeText =
            changeTone(asset.change, changeDigits) === "neutral"
              ? (0).toFixed(changeDigits)
              : asset.change.toFixed(changeDigits);
          return (
            <div
              key={asset.symbol}
              className="card interactive-card"
              role="button"
              tabIndex={0}
              aria-label={`${asset.name} (${asset.symbol}) の詳細・チャートを開く`}
              onClick={() => onOpenStockDetail(asset.symbol)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenStockDetail(asset.symbol);
                }
              }}
              style={{
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "12px",
                border: "1px solid var(--border-subtle)",
                borderRadius: "10px",
                background: "var(--bg-card)",
                cursor: "pointer",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span className="mono tiny muted">{asset.symbol}</span>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    {asset.symbol === "^TOPX" && (
                      <span
                        className="badge badge-accent mono tiny"
                        style={{ fontSize: "0.62rem", padding: "1px 5px" }}
                        title="東証指数ライセンス回避のため 1308.T ETF連動値を参照"
                      >
                        1308連動
                      </span>
                    )}
                    {asset.symbol === "^TOPIXG" && (
                      <span
                        className="badge badge-accent mono tiny"
                        style={{ fontSize: "0.62rem", padding: "1px 5px" }}
                        title="東証指数ライセンス回避のため 2516.T ETF連動値を参照"
                      >
                        2516連動
                      </span>
                    )}
                    <span className="badge badge-default mono tiny" style={{ fontSize: "0.68rem" }}>
                      {asset.category}
                    </span>
                    {assetIsStale && (
                      <span
                        className="badge badge-default mono tiny"
                        style={{ fontSize: "0.62rem", padding: "1px 5px" }}
                        title="実データを取得できなかったため、前回値または基準値（参考値）を表示しています"
                      >
                        参考値
                      </span>
                    )}
                  </div>
                </div>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 600, margin: 0 }}>
                  {asset.name}
                </h3>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: "1.35rem", fontWeight: 700 }} className="mono">
                    {asset.price.toLocaleString("en-US", {
                      minimumFractionDigits: asset.category === "FX" ? 2 : 2,
                      maximumFractionDigits: asset.category === "FX" ? 4 : 2,
                    })}
                    <span className="tiny muted" style={{ marginLeft: "4px", fontWeight: 400 }}>
                      {asset.currency}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      color: toneColor,
                      marginTop: "2px",
                    }}
                    className="mono"
                  >
                    {isPositive && <TrendingUp size={14} />}
                    {isNegative && <TrendingDown size={14} />}
                    <span>
                      {isPositive ? "+" : ""}
                      {changeText} ({formatSignedPercent(asset.changePercent)})
                    </span>
                  </div>
                </div>

                {/* Sparkline Visual Simulation */}
                {asset.sparkline && asset.sparkline.length > 0 && (() => {
                  const validData = asset.sparkline.filter((v) => typeof v === "number" && Number.isFinite(v));
                  if (validData.length === 0) return null;
                  const min = Math.min(...validData);
                  const max = Math.max(...validData);
                  const range = max - min || 1;
                  return (
                    <div style={{ width: "70px", height: "28px", display: "flex", alignItems: "flex-end", gap: "3px" }}>
                      {validData.map((val, idx) => {
                        const heightPercent = Math.max(15, Math.min(100, ((val - min) / range) * 100));
                        return (
                          <div
                            key={idx}
                            style={{
                              flex: 1,
                              height: `${heightPercent}%`,
                              background: toneColor,
                              opacity: 0.35 + (idx / validData.length) * 0.65,
                              borderRadius: "2px",
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Two Column Layout: Sectors Heatmap & Market News */}
      <div
        style={{
          display: "grid",
          // min(360px, 100%) keeps the single-column fallback on phones;
          // a bare 360px minimum track overflowed narrow viewports.
          gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
          gap: "24px",
        }}
      >
        {/* Sector Performance Bar */}
        <div className="card market-sectors-card" style={{ padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Layers size={18} className="muted" />
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: 0 }}>
              東証33業種・セクター騰落率
            </h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {data.sectors.map((sector) => {
              // A flat sector (0.00%) is neutral: no colour, no sign, no bar.
              const sectorTone = changeTone(sector.changePercent);
              const isPos = sectorTone === "positive";
              const isNeg = sectorTone === "negative";
              const barWidth = Math.min(100, Math.abs(sector.changePercent) * 25);
              return (
                <div key={sector.name} className="market-sector-row" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ width: "110px", fontSize: "0.85rem", fontWeight: 500 }} className="market-sector-name ellipsis">
                    {sector.name}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: "8px",
                      background: "var(--surface-control)",
                      borderRadius: "4px",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: isPos ? "50%" : isNeg ? `calc(50% - ${barWidth / 2}%)` : "50%",
                        width: `${barWidth / 2}%`,
                        height: "100%",
                        background: isPos
                          ? "var(--color-positive)"
                          : isNeg
                            ? "var(--color-negative)"
                            : "var(--text-muted)",
                        borderRadius: "2px",
                      }}
                    />
                  </div>
                  <span
                    className="mono bold tiny market-sector-pct"
                    style={{
                      width: "55px",
                      textAlign: "right",
                      color: isPos
                        ? "var(--color-positive)"
                        : isNeg
                          ? "var(--color-negative)"
                          : "var(--text-muted)",
                    }}
                  >
                    {formatSignedPercent(sector.changePercent)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Market News Feed */}
        <div className="card market-news-card" style={{ padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Newspaper size={18} className="muted" />
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: 0 }}>
              注目マーケットニュース & 材料
            </h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {data.news.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  background: "var(--bg-card-hover)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span className="badge badge-default mono tiny" style={{ fontSize: "0.68rem" }}>
                      {item.source}
                    </span>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tiny muted"
                        style={{ display: "inline-flex", alignItems: "center", gap: "2px", textDecoration: "none" }}
                        aria-label={`${item.source} の記事原文を新しいタブで開く`}
                      >
                        <ExternalLink size={11} />
                        <span style={{ fontSize: "0.68rem" }}>記事を開く</span>
                      </a>
                    )}
                  </div>
                  <span className="tiny muted mono">
                    {item.publishedTimestamp
                      ? formatDynamicRelativeTime(item.publishedTimestamp)
                      : item.publishedAt}
                  </span>
                </div>
                {item.relatedTicker ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (item.relatedTicker) onOpenStockDetail(item.relatedTicker);
                    }}
                    aria-label={`${item.title} (${item.relatedTicker}の銘柄分析を開く)`}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      margin: 0,
                      fontFamily: "inherit",
                      color: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                      fontSize: "0.92rem",
                      fontWeight: 600,
                      lineHeight: 1.4,
                    }}
                  >
                    {item.title}
                  </button>
                ) : (
                  <div style={{ fontSize: "0.92rem", fontWeight: 600, lineHeight: 1.4 }}>
                    {item.title}
                  </div>
                )}
                {item.relatedTicker && (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
                    <span className="mono tiny bold" style={{ color: "var(--accent-text)" }}>
                      関連: {item.relatedTicker}
                    </span>
                    <ArrowRight size={12} style={{ color: "var(--accent-text)" }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
