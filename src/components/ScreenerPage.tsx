import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
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
  RefreshCw,
  SearchX,
} from "lucide-react";
import { SkeletonTable } from "./Skeleton";
import {
  runStockScreener,
  fetchScreenerStocks,
  type ScreenerFilterOptions,
  type StockQuoteFundamentals,
} from "../lib/marketDataService";
import { allocateEvenWeights } from "../lib/weights";
import { changeTone, formatSignedPercent } from "./changeTone";
import { escapeCsvCell } from "../lib/csv";
import { toSafeDownloadFileName } from "../lib/downloadFileName";
import { todayJstDateString } from "../lib/portfolioStorage";
import type { PageView } from "../lib/navigation";
import { useToast } from "./Toast";
import { useRegisterFreshness } from "../contexts/FreshnessContext";
import { formatMarketLabel } from "../lib/marketFormatter";

interface ScreenerPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
  onBatchCreateCustomIndex?: (
    basket: { ticker: string; name: string; theme: string; weight: number }[],
  ) => void;
}

type PresetKey = "TOP_GAINERS" | "HIGH_DIVIDEND" | "LOW_PBR" | "US_TECH" | null;

/**
 * Row shape the screener CSV export needs.
 *
 * The numeric columns are optional because the upstream payload can omit
 * them; every cell is rendered through `escapeCsvCell`, so a missing or
 * corrupted value must never break the export.
 */
export type ScreenerCsvRow = {
  ticker: string;
  name: string;
  market: string;
  theme: string;
  price?: number | null;
  changePercent?: number | null;
  dividendYield?: number | null;
  per?: number | null;
  pbr?: number | null;
  roe?: number | null;
  technicalSignal: string;
};

/** Header row of the screener CSV export. */
export const SCREENER_CSV_HEADERS = [
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

/**
 * Build one CSV row per screener result.
 *
 * A non-numeric (or non-finite) price/change column is exported as an empty
 * cell instead of `NaN`, so a corrupted quote cannot break the export.
 */
export function buildScreenerCsvRows(results: ScreenerCsvRow[]): string[][] {
  return results.map((s) => [
    escapeCsvCell(s.ticker),
    escapeCsvCell(s.name),
    escapeCsvCell(s.market),
    escapeCsvCell(s.theme),
    escapeCsvCell(typeof s.price === "number" && Number.isFinite(s.price) ? s.price : ""),
    escapeCsvCell(typeof s.changePercent === "number" && Number.isFinite(s.changePercent) ? s.changePercent.toFixed(2) : ""),
    escapeCsvCell(typeof s.dividendYield === "number" && Number.isFinite(s.dividendYield) ? s.dividendYield.toFixed(2) : ""),
    escapeCsvCell(typeof s.per === "number" && Number.isFinite(s.per) ? s.per.toFixed(1) : ""),
    escapeCsvCell(typeof s.pbr === "number" && Number.isFinite(s.pbr) ? s.pbr.toFixed(2) : ""),
    escapeCsvCell(typeof s.roe === "number" && Number.isFinite(s.roe) ? s.roe.toFixed(1) : ""),
    escapeCsvCell(s.technicalSignal),
  ]);
}

/**
 * Lightweight SVG sparkline for displaying stock momentum at a glance.
 */
function TableSparkline({ data, isPositive }: { data?: number[]; isPositive: boolean }) {
  if (!data || data.length < 2) return null;
  const validData = data.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (validData.length < 2) return null;
  const min = Math.min(...validData);
  const max = Math.max(...validData);
  const range = max - min || 1;
  const width = 52;
  const height = 18;

  const points = validData
    .map((val, idx) => {
      const x = (idx / (validData.length - 1)) * width;
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
  const [market, setMarket] = useState<"ALL" | "PRIME" | "STANDARD" | "GROWTH" | "US">("ALL");
  const [minDividend, setMinDividend] = useState<number | undefined>(undefined);
  const [maxPbr, setMaxPbr] = useState<number | undefined>(undefined);
  const [maxPer, setMaxPer] = useState<number | undefined>(undefined);
  const [sortBy, setSortBy] =
    useState<NonNullable<ScreenerFilterOptions["sortBy"]>>("changePercent");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [activePreset, setActivePreset] = useState<PresetKey>(null);
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());
  const [universe, setUniverse] = useState<StockQuoteFundamentals[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  useRegisterFreshness("screener", {
    loading,
    updatedAt: lastUpdatedAt,
    stale: universe !== null && !isLive,
    typeLabel: "スクリーナー",
  });

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadScreenerData = useCallback(async (forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const rows = await fetchScreenerStocks({}, forceRefresh);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      if (!rows || rows.length === 0) {
        // Nothing usable came back: the previous badge state must not survive.
        setIsLive(false);
        return;
      }
      setUniverse(rows);
      // Fallback rows returned by `fetchScreenerStocks` are the static
      // baseline and are flagged `isDemoData`; only rows with real provenance
      // may advertise LIVE or stamp a "last updated" time (DATA-26).
      const hasLiveRows = rows.some((row) => !row.isDemoData);
      setIsLive(hasLiveRows);
      setLastUpdatedAt(hasLiveRows ? Date.now() : null);
    } catch {
      // Keep the previous universe on failure, but never keep claiming LIVE.
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsLive(false);
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadScreenerData();
  }, [loadScreenerData]);

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
    return runStockScreener(
      {
        market,
        minDividendYield: minDividend,
        maxPbr,
        maxPer,
        searchQuery,
        sortBy,
        sortOrder,
      },
      universe ?? undefined,
    );
  }, [market, minDividend, maxPbr, maxPer, searchQuery, sortBy, sortOrder, universe]);

  // Active filter pills
  const activeFilters = useMemo(() => {
    const list: { id: string; label: string; onRemove: () => void }[] = [];
    if (market !== "ALL") {
      list.push({
        id: "market",
        label: `市場: ${formatMarketLabel(market)}`,
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
  const selectedInResults = useMemo(
    () => results.filter((r) => selectedTickers.has(r.ticker)),
    [results, selectedTickers],
  );
  const isAllSelected = results.length > 0 && selectedInResults.length === results.length;
  const isPartiallySelected = selectedInResults.length > 0 && !isAllSelected;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      // Unselect only the currently visible results
      setSelectedTickers((prev) => {
        const next = new Set(prev);
        results.forEach((r) => next.delete(r.ticker));
        return next;
      });
    } else {
      setSelectedTickers((prev) => {
        const next = new Set(prev);
        results.forEach((r) => next.add(r.ticker));
        return next;
      });
    }
  };

  const handleToggleSelect = (ticker: string, e?: React.SyntheticEvent) => {
    e?.stopPropagation();
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
      selectedInResults.length > 0
        ? selectedInResults
        : results.slice(0, 10);

    if (chosenStocks.length === 0) {
      info("指数化の対象となる銘柄がありません。");
      return;
    }

    const weights = allocateEvenWeights(chosenStocks.length);
    const basket = chosenStocks.map((s, index) => ({
      ticker: s.ticker,
      name: (s.name || "").trim() || s.ticker,
      theme: typeof s.theme === "string" && s.theme.trim().length > 0 ? s.theme.trim() : "スクリーニング",
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
    const headers = SCREENER_CSV_HEADERS;
    const rows = buildScreenerCsvRows(results);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = todayJstDateString();
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
    align: "left" | "right" | "center" = "right",
    extraClass = "",
  ) => {
    const isActive = sortBy === column;
    return (
      <th
        style={{
          textAlign: align,
          cursor: "pointer",
          userSelect: "none",
        }}
        className={`sortable-col-header ${isActive ? "active" : ""} ${extraClass}`}
        onClick={() => handleSortColumn(column)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleSortColumn(column);
          }
        }}
        tabIndex={0}
        title={`${label} でソート (${isActive ? (sortOrder === "asc" ? "昇順" : "降順") : "クリックで並び替え"})`}
        role="columnheader"
        aria-sort={isActive ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            justifyContent:
              align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
            width: "100%",
          }}
        >
          <span>{label}</span>
          <span style={{ display: "inline-flex", opacity: isActive ? 1 : 0.35 }}>
            {isActive ? (
              sortOrder === "asc" ? (
                <ArrowUp size={12} />
              ) : (
                <ArrowDown size={12} />
              )
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
            <span
              className={`badge ${isLive ? "badge-success" : "badge-default"} mono tiny`}
              title={
                isLive
                  ? "市場実データ（実データ来歴あり）を表示中"
                  : "実データを取得できていないため、参考値（ベースライン）を表示中"
              }
              style={{
                fontSize: "0.68rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                color: isLive ? "var(--color-positive)" : "inherit",
              }}
            >
              {loading ? (
                <>
                  <RefreshCw size={10} className="spin" />
                  <span>実データ取得中...</span>
                </>
              ) : isLive ? (
                <span>● LIVE 市場実データ</span>
              ) : (
                <span>参考値</span>
              )}
            </span>
          </div>
          <h2 className="page-header-title">銘柄スクリーナー & ランキング</h2>
          <p className="muted tiny" style={{ margin: "4px 0 0" }}>
            リアルタイム株価、配当利回り、PBR1倍割れ、騰落率、バリュエーションによる絞り込みと一括指数組成
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => void loadScreenerData(true)}
            disabled={loading}
            title="最新の市場実データを再取得"
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
            <span>更新</span>
          </button>

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
            aria-disabled={results.length === 0}
            title={
              selectedInResults.length > 0
                ? `現在の抽出結果から選択中の ${selectedInResults.length} 銘柄でカスタム指数を作成`
                : "表示中の上位10銘柄を均等配分でカスタム指数に変換"
            }
          >
            <Sparkles size={14} />
            <span>
              {selectedInResults.length > 0
                ? `選択した${selectedInResults.length}銘柄で指数化`
                : "抽出結果を一括指数化"}
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
        <div
          role="group"
          aria-label="プリセット戦略フィルター"
          className="screener-presets-group"
          style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}
        >
          <span className="tiny muted mono" style={{ marginRight: 4 }}>
            プリセット戦略:
          </span>
          <button
            type="button"
            aria-pressed={activePreset === "TOP_GAINERS"}
            className={`btn btn-sm ${activePreset === "TOP_GAINERS" ? "btn-accent active-preset-pill" : "btn-outline"}`}
            onClick={() => applyPreset("TOP_GAINERS")}
            style={{ borderRadius: "20px" }}
          >
            <TrendingUp size={13} style={{ color: "var(--color-positive)" }} />
            <span>値上がり率トップ</span>
          </button>
          <button
            type="button"
            aria-pressed={activePreset === "HIGH_DIVIDEND"}
            className={`btn btn-sm ${activePreset === "HIGH_DIVIDEND" ? "btn-accent active-preset-pill" : "btn-outline"}`}
            onClick={() => applyPreset("HIGH_DIVIDEND")}
            style={{ borderRadius: "20px" }}
          >
            <Coins size={13} style={{ color: "var(--accent-text)" }} />
            <span>高配当利回り (3.5%超)</span>
          </button>
          <button
            type="button"
            aria-pressed={activePreset === "LOW_PBR"}
            className={`btn btn-sm ${activePreset === "LOW_PBR" ? "btn-accent active-preset-pill" : "btn-outline"}`}
            onClick={() => applyPreset("LOW_PBR")}
            style={{ borderRadius: "20px" }}
          >
            <ShieldCheck size={13} style={{ color: "var(--neon-cyan)" }} />
            <span>低PBRバリュー (1倍割れ)</span>
          </button>
          <button
            type="button"
            aria-pressed={activePreset === "US_TECH"}
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
          <label
            htmlFor="screener-market"
            className="tiny muted mono uppercase block"
            style={{ marginBottom: 4 }}
          >
            対象市場
          </label>
          <select
            id="screener-market"
            className="select-styled"
            style={{ width: "100%", padding: "6px 10px", fontSize: "0.85rem" }}
            value={market}
            onChange={(e) => {
              setMarket(e.target.value as "ALL" | "PRIME" | "STANDARD" | "GROWTH" | "US");
              setActivePreset(null);
            }}
          >
            <option value="ALL">全市場 (日本 & 米国)</option>
            <option value="PRIME">東証プライム</option>
            <option value="STANDARD">東証スタンダード</option>
            <option value="GROWTH">東証グロース</option>
            <option value="US">米国市場 (US)</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="screener-min-dividend"
            className="tiny muted mono uppercase block"
            style={{ marginBottom: 4 }}
          >
            予想配当利回り
          </label>
          <select
            id="screener-min-dividend"
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
          <label
            htmlFor="screener-max-pbr"
            className="tiny muted mono uppercase block"
            style={{ marginBottom: 4 }}
          >
            PBR (株価純資産倍率)
          </label>
          <select
            id="screener-max-pbr"
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
          <label
            htmlFor="screener-max-per"
            className="tiny muted mono uppercase block"
            style={{ marginBottom: 4 }}
          >
            PER (株価収益率)
          </label>
          <select
            id="screener-max-per"
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
          <label
            htmlFor="screener-search"
            className="tiny muted mono uppercase block"
            style={{ marginBottom: 4 }}
          >
            銘柄名 / コード絞り込み
          </label>
          <div style={{ position: "relative" }}>
            <input
              id="screener-search"
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
                aria-label="絞り込みキーワードをクリア"
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
              抽出結果: <strong style={{ color: "var(--text-primary)" }}>{results.length}</strong>{" "}
              件
            </span>
            {selectedTickers.size > 0 && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span className="badge badge-accent tiny mono">
                  {selectedInResults.length === selectedTickers.size
                    ? `${selectedTickers.size} 件選択中`
                    : `表示中 ${selectedInResults.length} / 全体 ${selectedTickers.size} 件選択中`}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost tiny text-muted"
                  onClick={() => setSelectedTickers(new Set())}
                  style={{ padding: "0 4px", fontSize: "0.72rem" }}
                  title="選択をすべて解除"
                >
                  解除
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="tiny muted">クイック並び替え:</span>
            <select
              aria-label="クイック並び替え"
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
              className="btn btn-ghost tiny screener-sort-dir-btn"
              onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
              title={sortOrder === "asc" ? "昇順 (クリックで降順へ)" : "降順 (クリックで昇順へ)"}
              aria-label={
                sortOrder === "asc" ? "昇順 (クリックで降順へ)" : "降順 (クリックで昇順へ)"
              }
            >
              {sortOrder === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            </button>
          </div>
        </div>

        {loading && results.length === 0 ? (
          <SkeletonTable rows={8} columns={9} />
        ) : results.length === 0 ? (
          <div
            className="card"
            style={{
              textAlign: "center",
              padding: "48px 20px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "rgba(255, 255, 255, 0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
              }}
            >
              <SearchX size={24} />
            </div>
            <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>
              条件に一致する銘柄が見つかりませんでした
            </div>
            <p className="muted tiny" style={{ maxWidth: "420px", margin: 0 }}>
              条件を緩和するか、検索キーワードを見直して再度お試しください。
            </p>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handleResetFilters}
              style={{ marginTop: "4px" }}
            >
              <RotateCcw size={12} style={{ marginRight: 4 }} />
              <span>条件をリセットして全銘柄を表示</span>
            </button>
          </div>
        ) : (
          <>
            <div className="screener-desktop-table-container">
              <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="銘柄スクリーナー結果テーブル">
                <table className="constituents-table screener-grid-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ width: "38px", textAlign: "center" }}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isAllSelected ? "true" : isPartiallySelected ? "mixed" : "false"}
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
                  {renderSortableHeader("銘柄", "name", "left", "table-sticky-col")}
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
                  const changeValueTone = changeTone(stock.changePercent);
                  const isPos = changeValueTone === "positive";
                  const isSelected = selectedTickers.has(stock.ticker);
                  return (
                    <tr
                      key={stock.ticker}
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      aria-label={`${stock.name} (${stock.ticker}) の詳細を見る`}
                      onClick={() => onOpenStockDetail(stock.ticker)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenStockDetail(stock.ticker);
                        }
                      }}
                      className={`screener-row ${isSelected ? "selected-row" : ""}`}
                    >
                      <td
                        style={{ textAlign: "center" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSelect(stock.ticker, e);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                          }
                        }}
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isSelected ? "true" : "false"}
                          className="btn btn-ghost tiny"
                          style={{ padding: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelect(stock.ticker, e);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              // preventDefault が無いとブラウザ既定のボタン活性化
                              // (Enter=keydown / Space=keyup での click)が続けて発火し、
                              // 純粋に反転するトグルが2回実行されて元の状態に戻ってしまう。
                              e.preventDefault();
                              e.stopPropagation();
                              handleToggleSelect(stock.ticker, e);
                            }
                          }}
                          aria-label={`${stock.name} の選択切り替え`}
                        >
                          {isSelected ? (
                            <CheckSquare size={14} style={{ color: "var(--accent-text)" }} />
                          ) : (
                            <Square size={14} className="muted" />
                          )}
                        </button>
                      </td>

                      <td className="table-sticky-col">
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            flexWrap: "wrap",
                          }}
                        >
                          <span style={{ fontWeight: 600, color: "var(--accent-text)" }}>
                            {stock.name}
                          </span>
                          {stock.isDemoData && (
                            <span
                              className="badge badge-default mono tiny"
                              style={{ fontSize: "0.62rem", padding: "1px 5px" }}
                              title="実データ未取得のため推計デモ値を表示しています"
                            >
                              参考値
                            </span>
                          )}
                        </div>
                        <div className="tiny muted mono">
                          {stock.ticker} · {stock.theme}
                        </div>
                      </td>

                      <td style={{ textAlign: "center" }}>
                        <TableSparkline data={stock.sparkline} isPositive={isPos} />
                      </td>

                      <td
                        style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        className="mono bold"
                      >
                        {stock.market === "US"
                          ? stock.price.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : stock.price.toLocaleString("ja-JP")}
                        <span className="tiny muted" style={{ marginLeft: 3 }}>
                          {stock.market === "US" ? "USD" : "円"}
                        </span>
                      </td>

                      <td
                        style={{
                          textAlign: "right",
                          color:
                            changeValueTone === "positive"
                              ? "var(--color-positive)"
                              : changeValueTone === "negative"
                                ? "var(--color-negative)"
                                : "var(--text-muted)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                        className="mono bold"
                      >
                        {formatSignedPercent(stock.changePercent)}
                      </td>

                      <td
                        style={{
                          textAlign: "right",
                          color: "var(--accent-text)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                        className="mono bold"
                      >
                        {typeof stock.dividendYield === "number"
                          ? `${stock.dividendYield.toFixed(2)}%`
                          : "--"}
                      </td>

                      <td
                        style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        className="mono"
                      >
                        {typeof stock.per === "number" ? `${stock.per.toFixed(1)}倍` : "--"}
                      </td>

                      <td
                        style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        className="mono"
                      >
                        {typeof stock.pbr === "number" ? `${stock.pbr.toFixed(2)}倍` : "--"}
                      </td>

                      <td
                        style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        className="mono"
                      >
                        {typeof stock.roe === "number" ? `${stock.roe.toFixed(1)}%` : "--"}
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
        </div>

          {/* Mobile Card List View (<= 768px). `role="group"` (not "list")
              because each card is itself an activatable `role="button"`
              container — `aria-label` would be prohibited on the generic
              default role, while a list would require listitem children. */}
          <div
            className="screener-mobile-list"
            role="group"
            aria-label="スクリーナー結果カードリスト"
          >
            {results.map((stock) => {
              const mobileTone = changeTone(stock.changePercent);
              const isPos = mobileTone === "positive";
              const isSelected = selectedTickers.has(stock.ticker);
              return (
                <article
                  key={stock.ticker}
                  className={`screener-mobile-card ${isSelected ? "selected-card" : ""}`}
                  onClick={() => onOpenStockDetail(stock.ticker)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${stock.name} (${stock.ticker}) の詳細を見る`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenStockDetail(stock.ticker);
                    }
                  }}
                >
                  <div className="screener-mobile-card-header">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected ? "true" : "false"}
                        className="btn btn-ghost tiny screener-mobile-checkbox"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSelect(stock.ticker, e);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            // デスクトップ表と同じく既定の click 発火を抑止し、
                            // キーボードでの選択が1回だけトグルされるようにする。
                            e.preventDefault();
                            e.stopPropagation();
                            handleToggleSelect(stock.ticker, e);
                          }
                        }}
                        aria-label={`${stock.name} の選択切り替え`}
                      >
                        {isSelected ? (
                          <CheckSquare size={16} style={{ color: "var(--accent-text)" }} />
                        ) : (
                          <Square size={16} className="muted" />
                        )}
                      </button>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span className="mono bold screener-mobile-ticker">{stock.ticker}</span>
                          <strong className="screener-mobile-name">{stock.name}</strong>
                          {stock.isDemoData && (
                            <span
                              className="badge badge-default mono tiny"
                              style={{ fontSize: "0.62rem", padding: "1px 5px" }}
                              title="実データ未取得のため推計デモ値を表示しています"
                            >
                              参考値
                            </span>
                          )}
                        </div>
                        <span className="tiny muted mono">{stock.theme} · {formatMarketLabel(stock.market)}</span>
                      </div>
                    </div>
                    <div className="screener-mobile-sparkline">
                      <TableSparkline data={stock.sparkline} isPositive={isPos} />
                    </div>
                  </div>

                  <div className="screener-mobile-card-grid">
                    <div className="screener-mobile-stat">
                      <span className="screener-mobile-stat-label">現在値</span>
                      <span className="screener-mobile-stat-val mono bold tabular-nums">
                        {stock.market === "US"
                          ? stock.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : stock.price.toLocaleString("ja-JP")}
                        <span className="tiny muted" style={{ marginLeft: 3 }}>
                          {stock.market === "US" ? "USD" : "円"}
                        </span>
                      </span>
                    </div>
                    <div className="screener-mobile-stat">
                      <span className="screener-mobile-stat-label">前日比</span>
                      <span
                        className="screener-mobile-stat-val mono bold tabular-nums"
                        style={{
                          color:
                            mobileTone === "positive"
                              ? "var(--color-positive)"
                              : mobileTone === "negative"
                                ? "var(--color-negative)"
                                : "var(--text-muted)",
                        }}
                      >
                        {formatSignedPercent(stock.changePercent)}
                      </span>
                    </div>
                    <div className="screener-mobile-stat">
                      <span className="screener-mobile-stat-label">予想配当利回り</span>
                      <span className="screener-mobile-stat-val mono bold tabular-nums" style={{ color: "var(--accent-text)" }}>
                        {typeof stock.dividendYield === "number" ? `${stock.dividendYield.toFixed(2)}%` : "--"}
                      </span>
                    </div>
                    <div className="screener-mobile-stat">
                      <span className="screener-mobile-stat-label">PER / PBR</span>
                      <span className="screener-mobile-stat-val mono tabular-nums">
                        {typeof stock.per === "number" ? `${stock.per.toFixed(1)}倍` : "--"} / {typeof stock.pbr === "number" ? `${stock.pbr.toFixed(2)}倍` : "--"}
                      </span>
                    </div>
                  </div>

                  <div className="screener-mobile-card-footer">
                    <span className="tiny muted mono">
                      ROE: {typeof stock.roe === "number" ? `${stock.roe.toFixed(1)}%` : "--"}
                    </span>
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
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      </div>
    </motion.div>
  );
}
