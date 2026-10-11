import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  TrendingUp,
  Sparkles,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Coins,
  ShieldCheck,
  Download,
  RotateCcw,
  X,
  CheckSquare,
  Square,
  MinusSquare,
} from "lucide-react";
import {
  runStockScreener,
  type ScreenerFilterOptions,
} from "../lib/marketDataService";
import { allocateEvenWeights } from "../lib/weights";
import { escapeCsvCell } from "../lib/csv";
import { toSafeDownloadFileName } from "../lib/downloadFileName";
import type { PageView } from "../lib/navigation";
import { useToast } from "./Toast";

interface ScreenerPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
  onBatchCreateCustomIndex?: (basket: { ticker: string; name: string; theme: string; weight: number }[]) => void;
}

type PresetKey = "TOP_GAINERS" | "HIGH_DIVIDEND" | "LOW_PBR" | "US_TECH" | null;

/**
 * Lightweight SVG sparkline for displaying stock momentum at a glance.
 */
function TableSparkline({ data, isPositive }: { data?: number[]; isPositive: boolean }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 52;
  const height = 18;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const color = isPositive ? "var(--color-positive)" : "var(--color-negative)";

  return (
    <svg
      width={width}
      height={height}
      aria-hidden="true"
      style={{ overflow: "visible", display: "inline-block", verticalAlign: "middle" }}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
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
  const [sortBy, setSortBy] = useState<NonNullable<ScreenerFilterOptions["sortBy"]>>("changePercent");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [activePreset, setActivePreset] = useState<PresetKey>(null);
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());

  const { success, info } = useToast();

  // Preset Filters
  const applyPreset = (preset: "TOP_GAINERS" | "HIGH_DIVIDEND" | "LOW_PBR" | "US_TECH") => {
    setActivePreset(preset);
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

  const handleResetFilters = () => {
    setMarket("ALL");
    setMinDividend(undefined);
    setMaxPbr(undefined);
    setMaxPer(undefined);
    setSearchQuery("");
    setSortBy("changePercent");
    setSortOrder("desc");
    setActivePreset(null);
    setSelectedTickers(new Set());
    info("検索・絞り込み条件を初期化しました");
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

  // Active filter pills
  const activeFilters = useMemo(() => {
    const list: { id: string; label: string; onRemove: () => void }[] = [];
    if (market !== "ALL") {
      list.push({
        id: "market",
        label: `市場: ${market === "PRIME" ? "東証プライム" : "米国市場 (US)"}`,
        onRemove: () => {
          setMarket("ALL");
          setActivePreset(null);
        },
      });
    }
    if (minDividend !== undefined) {
      list.push({
        id: "minDividend",
        label: `配当利回り ≥ ${minDividend}%`,
        onRemove: () => {
          setMinDividend(undefined);
          setActivePreset(null);
        },
      });
    }
    if (maxPbr !== undefined) {
      list.push({
        id: "maxPbr",
        label: `PBR ≤ ${maxPbr}倍`,
        onRemove: () => {
          setMaxPbr(undefined);
          setActivePreset(null);
        },
      });
    }
    if (maxPer !== undefined) {
      list.push({
        id: "maxPer",
        label: `PER ≤ ${maxPer}倍`,
        onRemove: () => {
          setMaxPer(undefined);
          setActivePreset(null);
        },
      });
    }
    if (searchQuery.trim()) {
      list.push({
        id: "searchQuery",
        label: `キーワード: "${searchQuery}"`,
        onRemove: () => setSearchQuery(""),
      });
    }
    return list;
  }, [market, minDividend, maxPbr, maxPer, searchQuery]);

  // Selection logic
  const isAllSelected = results.length > 0 && results.every((r) => selectedTickers.has(r.ticker));
  const isPartiallySelected = results.some((r) => selectedTickers.has(r.ticker)) && !isAllSelected;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedTickers(new Set());
    } else {
      setSelectedTickers(new Set(results.map((r) => r.ticker)));
    }
  };

  const handleToggleSelect = (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) {
        next.delete(ticker);
      } else {
        next.add(ticker);
      }
      return next;
    });
  };

  // Custom Index Batch Creation (supports chosen selections or top 10)
  const handleBatchIndexCreation = () => {
    if (results.length === 0) return;
    const chosenStocks =
      selectedTickers.size > 0
        ? results.filter((s) => selectedTickers.has(s.ticker))
        : results.slice(0, 10);

    const weights = allocateEvenWeights(chosenStocks.length);
    const basket = chosenStocks.map((s, index) => ({
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
    success(`スクリーニング${chosenStocks.length}銘柄でカスタム指数を即時作成しました！`);
  };

  // CSV Export
  const handleExportCsv = () => {
    if (results.length === 0) return;
    const headers = [
      "コード",
      "銘柄名",
      "市場",
      "テーマ",
      "現在値",
      "前日比(%)",
      "予想配当利回り(%)",
      "PER(倍)",
      "PBR(倍)",
      "ROE(%)",
      "テクニカルシグナル",
    ];
    const rows = results.map((s) => [
      escapeCsvCell(s.ticker),
      escapeCsvCell(s.name),
      escapeCsvCell(s.market),
      escapeCsvCell(s.theme),
      escapeCsvCell(s.price),
      escapeCsvCell(s.changePercent.toFixed(2)),
      escapeCsvCell(s.dividendYield ? s.dividendYield.toFixed(2) : ""),
      escapeCsvCell(s.per ? s.per.toFixed(1) : ""),
      escapeCsvCell(s.pbr ? s.pbr.toFixed(2) : ""),
      escapeCsvCell(s.roe ? s.roe.toFixed(1) : ""),
      escapeCsvCell(s.technicalSignal),
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().split("T")[0];
    a.href = url;
    a.download = toSafeDownloadFileName(`IndexForge_Screener_${dateStr}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    success(`${results.length}件のスクリーニング結果をCSVエクスポートしました`);
  };

  // Column Sort Handler
  const handleSortColumn = (column: NonNullable<ScreenerFilterOptions["sortBy"]>) => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      if (column === "pbr" || column === "per") {
        setSortOrder("asc");
      } else {
        setSortOrder("desc");
      }
    }
  };

  const renderSortableHeader = (
    label: string,
    column: NonNullable<ScreenerFilterOptions["sortBy"]>,
    align: "left" | "right" | "center" = "right"
  ) => {
    const isActive = sortBy === column;
    return (
      <th
        style={{
          textAlign: align,
          cursor: "pointer",
          userSelect: "none",
        }}
        className={`sortable-col-header ${isActive ? "active" : ""}`}
        onClick={() => handleSortColumn(column)}
        title={`${label} でソート (${isActive ? (sortOrder === "asc" ? "昇順" : "降順") : "クリックで並び替え"})`}
        role="columnheader"
        aria-sort={isActive ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
            width: "100%",
          }}
        >
          <span>{label}</span>
          <span style={{ display: "inline-flex", opacity: isActive ? 1 : 0.35 }}>
            {isActive ? (
              sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
            ) : (
              <ArrowUpDown size={11} />
            )}
          </span>
        </div>
      </th>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container screener-page"
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
          <h2 className="page-header-title">銘柄スクリーナー & ランキング</h2>
          <p className="muted tiny" style={{ margin: "4px 0 0" }}>
            配当利回り、PBR1倍割れ、騰落率、バリュエーションによる絞り込みと一括指数組成
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={handleExportCsv}
            disabled={results.length === 0}
            title="現在の抽出結果をCSVダウンロード"
          >
            <Download size={13} />
            <span>CSV出力</span>
          </button>

          <button
            type="button"
            className="btn btn-sm btn-accent"
            onClick={handleBatchIndexCreation}
            disabled={results.length === 0}
            title={
              selectedTickers.size > 0
                ? `選択中の ${selectedTickers.size} 銘柄でカスタム指数を作成`
                : "表示中の上位10銘柄を均等配分でカスタム指数に変換"
            }
          >
            <Sparkles size={14} />
            <span>
              ★ {selectedTickers.size > 0 ? `選択した${selectedTickers.size}銘柄で指数化` : "抽出結果を一括指数化"}
            </span>
          </button>
        </div>
      </div>

      {/* Preset Strategy Buttons */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
          marginBottom: "16px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <span className="tiny muted mono" style={{ marginRight: 4 }}>
            プリセット戦略:
          </span>
          <button
            type="button"
            className={`btn btn-sm ${activePreset === "TOP_GAINERS" ? "btn-accent active-preset-pill" : "btn-outline"}`}
            onClick={() => applyPreset("TOP_GAINERS")}
            style={{ borderRadius: "20px" }}
          >
            <TrendingUp size={13} style={{ color: "var(--color-positive)" }} />
            <span>値上がり率トップ</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activePreset === "HIGH_DIVIDEND" ? "btn-accent active-preset-pill" : "btn-outline"}`}
            onClick={() => applyPreset("HIGH_DIVIDEND")}
            style={{ borderRadius: "20px" }}
          >
            <Coins size={13} style={{ color: "var(--accent-text)" }} />
            <span>高配当利回り (3.5%超)</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activePreset === "LOW_PBR" ? "btn-accent active-preset-pill" : "btn-outline"}`}
            onClick={() => applyPreset("LOW_PBR")}
            style={{ borderRadius: "20px" }}
          >
            <ShieldCheck size={13} style={{ color: "#818cf8" }} />
            <span>低PBRバリュー (1倍割れ)</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activePreset === "US_TECH" ? "btn-accent active-preset-pill" : "btn-outline"}`}
            onClick={() => applyPreset("US_TECH")}
            style={{ borderRadius: "20px" }}
          >
            <Zap size={13} style={{ color: "var(--accent-text)" }} />
            <span>米国メガキャップ・テック</span>
          </button>
        </div>

        {/* Global Reset Button */}
        {(activePreset !== null || activeFilters.length > 0) && (
          <button
            type="button"
            className="btn btn-xs btn-ghost text-muted"
            onClick={handleResetFilters}
            title="全ての絞り込み条件をリセット"
          >
            <RotateCcw size={12} />
            <span>全条件リセット</span>
          </button>
        )}
      </div>

      {/* Multi-Condition Filter Control Panel */}
      <div
        className="card screener-filter-card"
        style={{
          padding: "16px 20px",
          marginBottom: "16px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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
            onChange={(e) => {
              setMarket(e.target.value as "ALL" | "PRIME" | "US");
              setActivePreset(null);
            }}
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
            onChange={(e) => {
              setMinDividend(e.target.value ? parseFloat(e.target.value) : undefined);
              setActivePreset(null);
            }}
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
            onChange={(e) => {
              setMaxPbr(e.target.value ? parseFloat(e.target.value) : undefined);
              setActivePreset(null);
            }}
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
            onChange={(e) => {
              setMaxPer(e.target.value ? parseFloat(e.target.value) : undefined);
              setActivePreset(null);
            }}
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
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
            />
            <Search size={14} className="muted" style={{ position: "absolute", left: 8, top: 9 }} />
            {searchQuery && (
              <button
                type="button"
                className="btn btn-ghost tiny"
                style={{ position: "absolute", right: 4, top: 5, padding: "2px 4px" }}
                onClick={() => setSearchQuery("")}
                title="検索クリア"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Active Filter Pills Bar */}
      {activeFilters.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "16px",
            flexWrap: "wrap",
            padding: "8px 14px",
            background: "rgba(6, 182, 212, 0.05)",
            borderRadius: "8px",
            border: "1px solid rgba(6, 182, 212, 0.15)",
          }}
        >
          <span className="tiny mono muted">適用中フィルター:</span>
          {activeFilters.map((filter) => (
            <span
              key={filter.id}
              className="badge badge-default tiny"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                background: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <span>{filter.label}</span>
              <button
                type="button"
                onClick={filter.onRemove}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  display: "inline-flex",
                  color: "inherit",
                }}
                aria-label={`${filter.label} を解除`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="btn btn-ghost tiny text-muted"
            onClick={handleResetFilters}
            style={{ padding: "2px 6px" }}
          >
            条件全クリア
          </button>
        </div>
      )}

      {/* Results Table Card */}
      <div className="card screener-table-card" style={{ padding: "20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="tiny muted mono">
              抽出結果: <strong style={{ color: "var(--text-primary)" }}>{results.length}</strong> 件
            </span>
            {selectedTickers.size > 0 && (
              <span className="badge badge-accent tiny mono">
                {selectedTickers.size} 件選択中
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="tiny muted">クイック並び替え:</span>
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
              <option value="price">現在値</option>
              <option value="roe">ROE (%)</option>
              <option value="name">銘柄名</option>
            </select>
            <button
              type="button"
              className="btn btn-ghost tiny"
              onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
              title={sortOrder === "asc" ? "昇順 (クリックで降順へ)" : "降順 (クリックで昇順へ)"}
            >
              {sortOrder === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            </button>
          </div>
        </div>

        {results.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 20px" }}>
            <p className="muted" style={{ marginBottom: 8 }}>
              条件に合致する銘柄が見つかりませんでした。
            </p>
            <button type="button" className="btn btn-sm btn-outline" onClick={handleResetFilters}>
              条件をリセットして全銘柄を表示
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="constituents-table screener-grid-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ width: "38px", textAlign: "center" }}>
                    <button
                      type="button"
                      className="btn btn-ghost tiny"
                      style={{ padding: 0, color: "var(--text-muted)" }}
                      onClick={handleToggleSelectAll}
                      title={isAllSelected ? "全選択を解除" : "全銘柄を選択"}
                      aria-label="全銘柄の選択切り替え"
                    >
                      {isAllSelected ? (
                        <CheckSquare size={15} style={{ color: "var(--accent-text)" }} />
                      ) : isPartiallySelected ? (
                        <MinusSquare size={15} style={{ color: "var(--accent-text)" }} />
                      ) : (
                        <Square size={15} />
                      )}
                    </button>
                  </th>
                  {renderSortableHeader("銘柄", "name", "left")}
                  <th style={{ textAlign: "center", width: "70px" }}>トレンド</th>
                  {renderSortableHeader("現在値", "price", "right")}
                  {renderSortableHeader("前日比 (%)", "changePercent", "right")}
                  {renderSortableHeader("配当利回り", "dividendYield", "right")}
                  {renderSortableHeader("PER", "per", "right")}
                  {renderSortableHeader("PBR", "pbr", "right")}
                  {renderSortableHeader("ROE", "roe", "right")}
                  <th style={{ textAlign: "center", width: "95px" }}>シグナル</th>
                </tr>
              </thead>
              <tbody>
                {results.map((stock) => {
                  const isPos = stock.changePercent >= 0;
                  const isSelected = selectedTickers.has(stock.ticker);
                  return (
                    <tr
                      key={stock.ticker}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      className={`screener-row ${isSelected ? "selected-row" : ""}`}
                      onClick={() => onOpenStockDetail(stock.ticker)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenStockDetail(stock.ticker);
                        }
                      }}
                      aria-label={`${stock.name} (${stock.ticker}) の詳細を見る`}
                    >
                      <td
                        style={{ textAlign: "center" }}
                        onClick={(e) => handleToggleSelect(stock.ticker, e)}
                      >
                        <button
                          type="button"
                          className="btn btn-ghost tiny"
                          style={{ padding: 0 }}
                          aria-label={`${stock.name} の選択トグル`}
                        >
                          {isSelected ? (
                            <CheckSquare size={14} style={{ color: "var(--accent-text)" }} />
                          ) : (
                            <Square size={14} className="muted" />
                          )}
                        </button>
                      </td>

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

                      <td style={{ textAlign: "center" }}>
                        <TableSparkline data={stock.sparkline} isPositive={isPos} />
                      </td>

                      <td
                        style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        className="mono bold"
                      >
                        {stock.price.toLocaleString()}
                        <span className="tiny muted" style={{ marginLeft: 3 }}>
                          {stock.market === "US" ? "USD" : "円"}
                        </span>
                      </td>

                      <td
                        style={{
                          textAlign: "right",
                          color: isPos ? "var(--color-positive)" : "var(--color-negative)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                        className="mono bold"
                      >
                        {isPos ? "+" : ""}
                        {stock.changePercent.toFixed(2)}%
                      </td>

                      <td
                        style={{
                          textAlign: "right",
                          color: "var(--accent-text)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                        className="mono bold"
                      >
                        {stock.dividendYield ? `${stock.dividendYield.toFixed(2)}%` : "--"}
                      </td>

                      <td
                        style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        className="mono"
                      >
                        {stock.per ? `${stock.per.toFixed(1)}倍` : "--"}
                      </td>

                      <td
                        style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        className="mono"
                      >
                        {stock.pbr ? `${stock.pbr.toFixed(2)}倍` : "--"}
                      </td>

                      <td
                        style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        className="mono"
                      >
                        {stock.roe ? `${stock.roe.toFixed(1)}%` : "--"}
                      </td>

                      <td style={{ textAlign: "center" }}>
                        <span
                          className={`badge ${
                            stock.technicalSignal === "STRONG_BUY"
                              ? "badge-accent"
                              : stock.technicalSignal.includes("BUY")
                                ? "badge-success"
                                : stock.technicalSignal.includes("SELL")
                                  ? "badge-danger"
                                  : "badge-default"
                          } tiny mono`}
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
