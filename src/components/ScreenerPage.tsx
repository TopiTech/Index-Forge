import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  TrendingUp,
  Sparkles,
  Search,
  ArrowUpDown,
  Coins,
  ShieldCheck,
} from "lucide-react";
import {
  runStockScreener,
  type ScreenerFilterOptions,
} from "../lib/marketDataService";
import { allocateEvenWeights } from "../lib/weights";
import type { PageView } from "../lib/navigation";
import { useToast } from "./Toast";

interface ScreenerPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
  onBatchCreateCustomIndex?: (basket: { ticker: string; name: string; theme: string; weight: number }[]) => void;
}

export function ScreenerPage({
  onNavigate,
  onOpenStockDetail,
  onBatchCreateCustomIndex,
}: ScreenerPageProps) {
  const [market, setMarket] = useState<"ALL" | "PRIME" | "US">("ALL");
  const [minDividend, setMinDividend] = useState<number | undefined>(undefined);
  const [maxPbr, setMaxPbr] = useState<number | undefined>(undefined);
  const [maxPer, setMaxPer] = useState<number | undefined>(undefined);
  const [sortBy, setSortBy] = useState<ScreenerFilterOptions["sortBy"]>("changePercent");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const { success } = useToast();

  // Preset Filters
  const applyPreset = (preset: "TOP_GAINERS" | "HIGH_DIVIDEND" | "LOW_PBR" | "US_TECH") => {
    switch (preset) {
      case "TOP_GAINERS":
        setMarket("ALL");
        setMinDividend(undefined);
        setMaxPbr(undefined);
        setMaxPer(undefined);
        setSortBy("changePercent");
        setSortOrder("desc");
        break;
      case "HIGH_DIVIDEND":
        setMarket("ALL");
        setMinDividend(3.5);
        setMaxPbr(undefined);
        setMaxPer(undefined);
        setSortBy("dividendYield");
        setSortOrder("desc");
        break;
      case "LOW_PBR":
        setMarket("PRIME");
        setMinDividend(undefined);
        setMaxPbr(1.0);
        setMaxPer(15);
        setSortBy("pbr");
        setSortOrder("asc");
        break;
      case "US_TECH":
        setMarket("US");
        setMinDividend(undefined);
        setMaxPbr(undefined);
        setMaxPer(undefined);
        setSortBy("marketCap");
        setSortOrder("desc");
        break;
    }
  };

  const results = useMemo(() => {
    return runStockScreener({
      market,
      minDividendYield: minDividend,
      maxPbr,
      maxPer,
      searchQuery,
      sortBy,
      sortOrder,
    });
  }, [market, minDividend, maxPbr, maxPer, searchQuery, sortBy, sortOrder]);

  const handleBatchIndexCreation = () => {
    if (results.length === 0) return;
    const topStocks = results.slice(0, 10);
    // Equal split whose sum is exactly 100 for any result size
    // (Math.round(100 / n) drifts: 7 stocks would sum to 99).
    const weights = allocateEvenWeights(topStocks.length);

    const basket = topStocks.map((s, index) => ({
      ticker: s.ticker,
      name: s.name,
      theme: s.theme,
      weight: weights[index],
    }));

    if (onBatchCreateCustomIndex) {
      onBatchCreateCustomIndex(basket);
    } else {
      onNavigate("builder");
    }
    success(`スクリーニング上位${basket.length}銘柄でカスタム指数を即時作成しました！`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container screener-page"
      style={{ maxWidth: "1280px", margin: "0 auto", padding: "16px 20px 48px" }}
    >
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span className="badge badge-accent mono tiny">MULTI-FACTOR SCREENER</span>
            <span className="tiny muted mono">DISCOVERY & RANKING</span>
          </div>
          <h2 style={{ fontSize: "1.65rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            銘柄スクリーナー & ランキング
          </h2>
          <p className="muted tiny" style={{ margin: "4px 0 0" }}>
            配当利回り、PBR1倍割れ、騰落率、バリュエーションによる絞り込みと一括指数組成
          </p>
        </div>

        <button
          type="button"
          className="btn btn-sm btn-accent"
          onClick={handleBatchIndexCreation}
          disabled={results.length === 0}
          title="表示中の上位10銘柄を均等配分でカスタム指数に変換"
        >
          <Sparkles size={14} />
          <span>★ 抽出結果を一括指数化</span>
        </button>
      </div>

      {/* Preset Strategy Buttons */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => applyPreset("TOP_GAINERS")}
          style={{ borderRadius: "20px" }}
        >
          <TrendingUp size={13} style={{ color: "var(--color-positive)" }} />
          <span>値上がり率トップ</span>
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => applyPreset("HIGH_DIVIDEND")}
          style={{ borderRadius: "20px" }}
        >
          <Coins size={13} style={{ color: "#10b981" }} />
          <span>高配当利回り (3.5%超)</span>
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => applyPreset("LOW_PBR")}
          style={{ borderRadius: "20px" }}
        >
          <ShieldCheck size={13} style={{ color: "#818cf8" }} />
          <span>低PBRバリュー (1倍割れ)</span>
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => applyPreset("US_TECH")}
          style={{ borderRadius: "20px" }}
        >
          <Zap size={13} style={{ color: "var(--accent-text)" }} />
          <span>米国メガキャップ・テック</span>
        </button>
      </div>

      {/* Multi-Condition Filter Control Panel */}
      <div
        className="card"
        style={{
          padding: "16px 20px",
          marginBottom: "20px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: "14px",
          background: "var(--bg-card)",
          alignItems: "flex-end",
        }}
      >
        <div>
          <label className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
            対象市場
          </label>
          <select
            className="select-styled"
            style={{ width: "100%", padding: "6px 10px", fontSize: "0.85rem" }}
            value={market}
            onChange={(e) => setMarket(e.target.value as "ALL" | "PRIME" | "US")}
          >
            <option value="ALL">全市場 (日本 & 米国)</option>
            <option value="PRIME">東証プライム</option>
            <option value="US">米国市場 (US)</option>
          </select>
        </div>

        <div>
          <label className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
            予想配当利回り
          </label>
          <select
            className="select-styled"
            style={{ width: "100%", padding: "6px 10px", fontSize: "0.85rem" }}
            value={minDividend ?? ""}
            onChange={(e) => setMinDividend(e.target.value ? parseFloat(e.target.value) : undefined)}
          >
            <option value="">指定なし</option>
            <option value="2.5">2.5% 以上</option>
            <option value="3.0">3.0% 以上</option>
            <option value="3.5">3.5% 以上</option>
            <option value="4.0">4.0% 以上</option>
          </select>
        </div>

        <div>
          <label className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
            PBR (株価純資産倍率)
          </label>
          <select
            className="select-styled"
            style={{ width: "100%", padding: "6px 10px", fontSize: "0.85rem" }}
            value={maxPbr ?? ""}
            onChange={(e) => setMaxPbr(e.target.value ? parseFloat(e.target.value) : undefined)}
          >
            <option value="">指定なし</option>
            <option value="1.0">1.0倍 以下 (割安)</option>
            <option value="1.5">1.5倍 以下</option>
            <option value="2.0">2.0倍 以下</option>
          </select>
        </div>

        <div>
          <label className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
            PER (株価収益率)
          </label>
          <select
            className="select-styled"
            style={{ width: "100%", padding: "6px 10px", fontSize: "0.85rem" }}
            value={maxPer ?? ""}
            onChange={(e) => setMaxPer(e.target.value ? parseFloat(e.target.value) : undefined)}
          >
            <option value="">指定なし</option>
            <option value="15">15倍 以下</option>
            <option value="20">20倍 以下</option>
            <option value="25">25倍 以下</option>
          </select>
        </div>

        <div>
          <label className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
            銘柄名 / コード絞り込み
          </label>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              className="input-styled"
              placeholder="例: トヨタ, 半導体, 7203"
              style={{ width: "100%", padding: "6px 10px 6px 28px", fontSize: "0.85rem" }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search size={14} className="muted" style={{ position: "absolute", left: 8, top: 9 }} />
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="card" style={{ padding: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <span className="tiny muted mono">
            抽出結果: <strong>{results.length}</strong> 件
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="tiny muted">並び替え:</span>
            <select
              className="select-styled tiny"
              style={{ padding: "4px 8px" }}
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as NonNullable<ScreenerFilterOptions["sortBy"]>)
              }
            >
              <option value="changePercent">騰落率 (%)</option>
              <option value="dividendYield">配当利回り (%)</option>
              <option value="per">PER (倍)</option>
              <option value="pbr">PBR (倍)</option>
              <option value="marketCap">時価総額</option>
            </select>
            <button
              type="button"
              className="btn btn-ghost tiny"
              onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
              title={sortOrder === "asc" ? "昇順" : "降順"}
            >
              <ArrowUpDown size={13} />
            </button>
          </div>
        </div>

        {results.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <p className="muted">条件に合致する銘柄が見つかりませんでした。</p>
            <span className="tiny muted">条件を緩和してお試しください。</span>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="constituents-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>銘柄</th>
                  <th style={{ textAlign: "right" }}>現在値</th>
                  <th style={{ textAlign: "right" }}>前日比 (%)</th>
                  <th style={{ textAlign: "right" }}>配当利回り</th>
                  <th style={{ textAlign: "right" }}>PER</th>
                  <th style={{ textAlign: "right" }}>PBR</th>
                  <th style={{ textAlign: "right" }}>ROE</th>
                  <th style={{ textAlign: "center" }}>シグナル</th>
                </tr>
              </thead>
              <tbody>
                {results.map((stock) => {
                  const isPos = stock.changePercent >= 0;
                  return (
                    <tr
                      key={stock.ticker}
                      style={{ cursor: "pointer" }}
                      onClick={() => onOpenStockDetail(stock.ticker)}
                    >
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div>
                            <span style={{ fontWeight: 600, color: "var(--accent-text)" }}>
                              {stock.name}
                            </span>
                            <div className="tiny muted mono">
                              {stock.ticker} · {stock.theme}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }} className="mono bold">
                        {stock.price.toLocaleString()}
                        <span className="tiny muted" style={{ marginLeft: 3 }}>
                          {stock.market === "US" ? "USD" : "円"}
                        </span>
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: isPos ? "var(--color-positive)" : "var(--color-negative)",
                        }}
                        className="mono bold"
                      >
                        {isPos ? "+" : ""}{stock.changePercent.toFixed(2)}%
                      </td>
                      <td style={{ textAlign: "right", color: "#10b981" }} className="mono bold">
                        {stock.dividendYield ? `${stock.dividendYield.toFixed(2)}%` : "--"}
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {stock.per ? `${stock.per.toFixed(1)}倍` : "--"}
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {stock.pbr ? `${stock.pbr.toFixed(2)}倍` : "--"}
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {stock.roe ? `${stock.roe.toFixed(1)}%` : "--"}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span
                          className={`badge ${stock.technicalSignal.includes("BUY") ? "badge-success" : "badge-default"} tiny mono`}
                        >
                          {stock.technicalSignal}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
