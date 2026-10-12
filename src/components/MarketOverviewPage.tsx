import React, { useState, useEffect, useRef, useCallback } from "react";
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
} from "lucide-react";
import {
  fetchMarketOverview,
  type MarketOverviewData,
  type MarketAssetQuote,
} from "../lib/marketDataService";
import type { PageView } from "../lib/navigation";

interface MarketOverviewPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
}

export function MarketOverviewPage({
  onNavigate,
  onOpenStockDetail,
}: MarketOverviewPageProps) {
  const [data, setData] = useState<MarketOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAssetTab, setSelectedAssetTab] = useState<"ALL" | "INDEX" | "FX" | "COMMODITY" | "CRYPTO">("ALL");

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
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!data) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center" }}>
        <RefreshCw className="spin muted" size={24} />
        <p className="muted" style={{ marginTop: 12 }}>市場データを取得中...</p>
      </div>
    );
  }

  const allAssets: MarketAssetQuote[] = [
    ...data.indices,
    ...data.forex,
    ...data.commodities,
    ...data.crypto,
  ];

  const displayedAssets =
    selectedAssetTab === "ALL"
      ? allAssets
      : allAssets.filter((a) => a.category === selectedAssetTab);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container market-overview-page"
    >
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
            {data.dataSource === "fallback" ? (
              <span
                className="badge mono tiny"
                title="実データの取得に失敗したため、静的ベースラインデータを表示しています"
                style={{
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  color: "#f59e0b",
                }}
              >
                参考値 (フォールバック)
              </span>
            ) : (
              <span className="tiny muted mono">GLOBAL & TSE REAL-TIME MONITOR</span>
            )}
            {data.dataAsOf && (
              <span className="tiny muted mono" title="データ生成時刻">
                DATA AS OF: {new Date(data.dataAsOf).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
              </span>
            )}
          </div>
          <h2 className="page-header-title">グローバル市場概況</h2>
          <p className="muted tiny" style={{ margin: "4px 0 0" }}>
            日米主要株価指数、為替、商品、暗号資産、東証業種別騰落率のリアルタイム統合サマリー
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => void loadData(true)}
            title="最新データを再取得"
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
            <span style={{ fontSize: "1.7rem", fontWeight: 700, color: "var(--accent-text)" }}>
              {data.marketBreadth.sentimentScore}
            </span>
            <span className="badge badge-success tiny mono">
              {data.marketBreadth.sentimentScore >= 60 ? "GREED (強気相場)" : "NEUTRAL"}
            </span>
          </div>
          {/* Sentiment Progress Bar */}
          <div
            style={{
              height: "6px",
              width: "100%",
              background: "rgba(255, 255, 255, 0.08)",
              borderRadius: "3px",
              marginTop: "8px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${data.marketBreadth.sentimentScore}%`,
                background: "linear-gradient(90deg, #38bdf8, #10b981)",
                borderRadius: "3px",
              }}
            />
          </div>
        </div>

        <div>
          <span className="tiny muted mono uppercase block">東証プライム 騰落銘柄数</span>
          <div style={{ display: "flex", gap: "16px", marginTop: "6px" }}>
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

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
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
          const isPositive = asset.changePercent >= 0;
          return (
            <div
              key={asset.symbol}
              className="card interactive-card"
              style={{
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "12px",
                border: "1px solid var(--border-subtle)",
                borderRadius: "10px",
                background: "var(--bg-card)",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span className="mono tiny muted">{asset.symbol}</span>
                  <span className="badge badge-default mono tiny" style={{ fontSize: "0.68rem" }}>
                    {asset.category}
                  </span>
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
                      color: isPositive ? "var(--color-positive)" : "var(--color-negative)",
                      marginTop: "2px",
                    }}
                    className="mono"
                  >
                    {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    <span>
                      {isPositive ? "+" : ""}
                      {asset.change.toFixed(2)} ({isPositive ? "+" : ""}
                      {asset.changePercent.toFixed(2)}%)
                    </span>
                  </div>
                </div>

                {/* Sparkline Visual Simulation */}
                {asset.sparkline && asset.sparkline.length > 0 && (() => {
                  const min = Math.min(...asset.sparkline);
                  const max = Math.max(...asset.sparkline);
                  const range = max - min || 1;
                  return (
                    <div style={{ width: "70px", height: "28px", display: "flex", alignItems: "flex-end", gap: "3px" }}>
                      {asset.sparkline.map((val, idx) => {
                        const heightPercent = Math.max(15, Math.min(100, ((val - min) / range) * 100));
                        return (
                          <div
                            key={idx}
                            style={{
                              flex: 1,
                              height: `${heightPercent}%`,
                              background: isPositive ? "var(--color-positive)" : "var(--color-negative)",
                              opacity: 0.35 + (idx / asset.sparkline!.length) * 0.65,
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
        <div className="card" style={{ padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Layers size={18} className="muted" />
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: 0 }}>
              東証33業種・セクター騰落率
            </h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {data.sectors.map((sector) => {
              const isPos = sector.changePercent >= 0;
              const barWidth = Math.min(100, Math.abs(sector.changePercent) * 25);
              return (
                <div key={sector.name} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ width: "110px", fontSize: "0.85rem", fontWeight: 500 }} className="ellipsis">
                    {sector.name}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: "8px",
                      background: "rgba(255, 255, 255, 0.06)",
                      borderRadius: "4px",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: isPos ? "50%" : `calc(50% - ${barWidth / 2}%)`,
                        width: `${barWidth / 2}%`,
                        height: "100%",
                        background: isPos ? "var(--color-positive)" : "var(--color-negative)",
                        borderRadius: "2px",
                      }}
                    />
                  </div>
                  <span
                    className="mono bold tiny"
                    style={{
                      width: "55px",
                      textAlign: "right",
                      color: isPos ? "var(--color-positive)" : "var(--color-negative)",
                    }}
                  >
                    {isPos ? "+" : ""}
                    {sector.changePercent.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Market News Feed */}
        <div className="card" style={{ padding: "20px" }}>
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
                role={item.relatedTicker ? "button" : undefined}
                tabIndex={item.relatedTicker ? 0 : undefined}
                aria-label={
                  item.relatedTicker
                    ? `${item.title} (${item.relatedTicker}の銘柄分析を開く)`
                    : undefined
                }
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  background: "var(--bg-card-hover)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  cursor: item.relatedTicker ? "pointer" : "default",
                  transition: "transform 0.1s ease",
                }}
                onClick={() => {
                  if (item.relatedTicker) {
                    onOpenStockDetail(item.relatedTicker);
                  }
                }}
                onKeyDown={(e) => {
                  if (item.relatedTicker && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onOpenStockDetail(item.relatedTicker);
                  }
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
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`${item.source} の記事原文を新しいタブで開く`}
                      >
                        <ExternalLink size={11} />
                        <span style={{ fontSize: "0.68rem" }}>記事を開く</span>
                      </a>
                    )}
                  </div>
                  <span className="tiny muted mono">{item.publishedAt}</span>
                </div>
                <div style={{ fontSize: "0.92rem", fontWeight: 600, lineHeight: 1.4 }}>
                  {item.title}
                </div>
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
