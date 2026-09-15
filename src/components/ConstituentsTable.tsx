import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, Tag, SearchInput } from "./ui";
import {
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ListOrdered,
  Download,
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  Lock,
  KeyRound,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import type { BasketItem, StockDetail } from "../types";
import { normalizeWeights } from "../lib/indexEngine";
import { useAuth } from "../hooks/useAuth";
import { AuthModal } from "./AuthModal";
import { AddStockModal } from "./AddStockModal";
import { ConfirmModal } from "./ConfirmModal";
import { useToast } from "./Toast";
import { toYahooSymbol } from "../lib/yahooSymbol";
import { escapeCsvCell } from "../lib/csv";
import { toSafeDownloadFileName } from "../lib/downloadFileName";

interface ConstituentsTableProps {
  basket: BasketItem[];
  stockDetails?: StockDetail[];
  selectedTheme: string | null;
  indexName?: string;
  /** True only for an authenticated admin or the selected index owner. */
  canEdit?: boolean;
  onAddStock?: (stock: BasketItem) => Promise<{ ok: boolean; error?: string }>;
  onRemoveStock?: (ticker: string) => Promise<{ ok: boolean; error?: string }>;
}

type SortField =
  "weight" | "ticker" | "name" | "theme" | "currentPrice" | "changePct" | "contributionPt";
type SortOrder = "asc" | "desc";

function getYahooFinanceUrl(ticker: string): string {
  // Use the same symbol normalization as the backend (`toYahooSymbol`) so that
  // the external link resolves to the same market page the app uses for data.
  const symbol = toYahooSymbol(ticker);
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function Sparkline({ data, isPositive }: { data: number[]; isPositive: boolean }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 64;
  const height = 22;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const color = isPositive ? "var(--neon-green)" : "var(--neon-red)";

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ overflow: "visible" }}>
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

export function ConstituentsTable({
  basket,
  stockDetails = [],
  selectedTheme,
  indexName = "カスタム指数",
  canEdit = false,
  onAddStock,
  onRemoveStock,
}: ConstituentsTableProps) {
  const { session, isAuthenticated, isAdmin, isUser, maxStocks, logout } = useAuth();
  const editingEnabled = canEdit && isAuthenticated;
  const { success, error: toastError } = useToast();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("weight");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAddStockModalOpen, setIsAddStockModalOpen] = useState(false);
  const [pendingDeleteStock, setPendingDeleteStock] = useState<{
    ticker: string;
    name: string;
  } | null>(null);
  const [confirmDeleteStock, setConfirmDeleteStock] = useState<{
    ticker: string;
    name: string;
  } | null>(null);
  const [deletingStock, setDeletingStock] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);

  const isLimitReached =
    isUser && maxStocks !== null && maxStocks > 0 && basket.length >= maxStocks;

  const handleAddStockClick = () => {
    setPendingDeleteStock(null);
    if (!canEdit) {
      setTableError(
        "この指数を編集する権限がありません。作成者または管理者として認証してください。",
      );
      return;
    }
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      return;
    }
    setIsAddStockModalOpen(true);
  };

  const executeDeleteStock = async (ticker: string, stockName: string) => {
    if (basket.length <= 1) {
      setTableError("構成銘柄が1件のみのため削除できません。指数には最低1銘柄必要です。");
      return;
    }
    if (onRemoveStock) {
      setDeletingStock(true);
      try {
        const res = await onRemoveStock(ticker);
        if (!res.ok) {
          setTableError(res.error || "銘柄の削除に失敗しました");
          toastError(res.error || "銘柄の削除に失敗しました");
        } else {
          setTableError(null);
          setConfirmDeleteStock(null);
          success(`銘柄「${stockName} (${ticker})」を削除しました`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "銘柄の削除に失敗しました";
        setTableError(message);
        toastError(message);
      } finally {
        setDeletingStock(false);
      }
    }
  };

  const handleDeleteStockClick = async (ticker: string, stockName: string) => {
    if (!canEdit) {
      setTableError(
        "この指数を編集する権限がありません。作成者または管理者として認証してください。",
      );
      return;
    }
    if (basket.length <= 1) {
      setTableError("構成銘柄が1件のみのため削除できません。指数には最低1銘柄必要です。");
      return;
    }
    if (!isAuthenticated) {
      setPendingDeleteStock({ ticker, name: stockName });
      setIsAuthModalOpen(true);
      return;
    }
    setConfirmDeleteStock({ ticker, name: stockName });
  };

  const handleAddStockSubmit = async (stock: BasketItem) => {
    if (onAddStock) {
      const res = await onAddStock(stock);
      if (!res.ok) {
        return res;
      }
      setTableError(null);
      success(`銘柄「${stock.name} (${stock.ticker})」を追加しました`);
      return { ok: true };
    }
    return { ok: false, error: "追加ハンドラが設定されていません" };
  };

  // Merge basket and stockDetails
  const combinedList = useMemo(() => {
    const detailsMap = new Map(stockDetails.map((d) => [d.ticker.trim().toUpperCase(), d]));
    const normalized = normalizeWeights(basket);

    return normalized.map((item) => {
      const detail = detailsMap.get(item.ticker.trim().toUpperCase());
      return {
        ticker: item.ticker,
        name: item.name,
        theme: item.theme || "その他",
        weight: item.weight,
        currentPrice: detail?.currentPrice ?? 0,
        change: detail?.change ?? 0,
        changePct: detail?.changePct ?? 0,
        contributionPt: detail?.contributionPt ?? 0,
        contributionPct: detail?.contributionPct ?? 0,
        sparkline: detail?.sparkline ?? [],
      };
    });
  }, [basket, stockDetails]);

  const filteredAndSorted = useMemo(() => {
    let list = [...combinedList];

    // Filter by selected theme
    if (selectedTheme) {
      list = list.filter((item) => item.theme === selectedTheme);
    }

    // Filter by search text
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (item) =>
          item.ticker.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.theme?.toLowerCase().includes(q),
      );
    }

    // Sort
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "weight") {
        cmp = a.weight - b.weight;
      } else if (sortField === "ticker") {
        cmp = a.ticker.localeCompare(b.ticker);
      } else if (sortField === "name") {
        cmp = a.name.localeCompare(b.name, "ja");
      } else if (sortField === "theme") {
        cmp = (a.theme || "").localeCompare(b.theme || "", "ja");
      } else if (sortField === "currentPrice") {
        cmp = a.currentPrice - b.currentPrice;
      } else if (sortField === "changePct") {
        cmp = a.changePct - b.changePct;
      } else if (sortField === "contributionPt") {
        cmp = a.contributionPt - b.contributionPt;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return list;
  }, [combinedList, selectedTheme, search, sortField, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder(
        field === "weight" || field === "changePct" || field === "contributionPt" ? "desc" : "asc",
      );
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown size={12} style={{ opacity: 0.35, marginLeft: 4 }} />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp size={12} style={{ color: "var(--accent-text)", marginLeft: 4 }} />
    ) : (
      <ArrowDown size={12} style={{ color: "var(--accent-text)", marginLeft: 4 }} />
    );
  };

  const exportCSV = () => {
    const headers = [
      "銘柄コード",
      "銘柄名",
      "テーマ",
      "構成比率(%)",
      "最新株価(円)",
      "前日比(%)",
      "指数寄与度(pt)",
    ];
    // Every cell is passed through escapeCsvCell: numeric columns are safe
    // today, but routing them through the same helper keeps the CSV export
    // injection-proof if a column ever becomes user-controlled text.
    const rows = filteredAndSorted.map((item) => [
      escapeCsvCell(item.ticker),
      escapeCsvCell(item.name),
      escapeCsvCell(item.theme),
      escapeCsvCell(item.weight.toFixed(2)),
      escapeCsvCell(item.currentPrice),
      escapeCsvCell(item.changePct.toFixed(2)),
      escapeCsvCell(item.contributionPt.toFixed(2)),
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const safeFileName = toSafeDownloadFileName(indexName, "custom_index");
    link.setAttribute(
      "download",
      `${safeFileName}_constituents_${new Date().toISOString().slice(0, 10)}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    success("CSVファイルをダウンロードしました");
  };

  const handleHeaderKeyDown = (e: React.KeyboardEvent, field: SortField) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSort(field);
    }
  };

  const hasActiveFilters = Boolean(selectedTheme || search.trim());

  return (
    <Card className="section">
      <div className="row space-between flex-wrap" style={{ marginBottom: 16, gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <ListOrdered size={16} style={{ color: "var(--accent-text)" }} />
          <h2 style={{ fontSize: 15, margin: 0 }}>構成銘柄リスト & 寄与度分析</h2>
          <Tag variant="cyan" className="mono tiny">
            {filteredAndSorted.length} / {basket.length} 銘柄
          </Tag>
        </div>

        <div className="row flex-wrap" style={{ gap: 8 }}>
          <div style={{ width: "100%", maxWidth: 220 }}>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="銘柄名・コード・テーマ検索..."
            />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={exportCSV}
            title="CSV形式でエクスポート"
          >
            <Download size={12} /> CSV
          </button>
        </div>
      </div>

      {/* Active Filter Chips */}
      {hasActiveFilters && (
        <div className="table-filter-bar" role="status" aria-label="適用中のフィルター">
          <span className="muted tiny mono">絞り込み中:</span>
          {selectedTheme && <span className="filter-active-chip">テーマ: {selectedTheme}</span>}
          {search.trim() && (
            <span className="filter-active-chip">
              検索: &quot;{search.trim()}&quot;
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: "0 2px",
                  marginLeft: 4,
                  fontSize: 12,
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                }}
                aria-label="検索キーワードをクリア"
                title="検索キーワードをクリア"
              >
                ✕
              </button>
            </span>
          )}
          {search.trim() && (
            <button type="button" className="filter-clear-all" onClick={() => setSearch("")}>
              検索を解除
            </button>
          )}
        </div>
      )}

      {/* Mobile Sort Controls */}
      <div className="mobile-sort-controls">
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <span className="mono tiny muted">並び替え:</span>
          <select
            className="mobile-sort-select"
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
            aria-label="並び替え項目を選択"
          >
            <option value="weight">構成比率</option>
            <option value="changePct">前日比</option>
            <option value="contributionPt">寄与度</option>
            <option value="currentPrice">株価</option>
            <option value="name">銘柄名</option>
            <option value="ticker">コード</option>
            <option value="theme">テーマ</option>
          </select>
        </div>
        <button
          type="button"
          className="mobile-sort-dir-btn"
          onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
          aria-label={
            sortOrder === "asc" ? "昇順 (クリックで降順に変更)" : "降順 (クリックで昇順に変更)"
          }
        >
          {sortOrder === "asc" ? (
            <>
              <ArrowUp size={13} /> 昇順
            </>
          ) : (
            <>
              <ArrowDown size={13} /> 降順
            </>
          )}
        </button>
      </div>

      {tableError && (
        <div
          role="alert"
          aria-live="assertive"
          className="row"
          style={{
            gap: 8,
            padding: "10px 14px",
            background: "rgba(255, 51, 102, 0.15)",
            border: "1px solid var(--neon-red)",
            borderRadius: 8,
            color: "var(--neon-red)",
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span>{tableError}</span>
        </div>
      )}

      {/* Stock Edit Toolbar & Auth Indicator */}
      <div
        className="row space-between flex-wrap"
        style={{
          marginBottom: 16,
          padding: "10px 14px",
          background: "var(--surface-inset)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 8,
          gap: 10,
        }}
      >
        <div className="row flex-wrap" style={{ gap: 8, alignItems: "center" }}>
          {editingEnabled ? (
            <div className="row flex-wrap" style={{ gap: 8, alignItems: "center" }}>
              <span
                className="tag"
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  background: isAdmin ? "rgba(255, 0, 234, 0.12)" : "var(--accent-subtle)",
                  color: isAdmin ? "var(--neon-magenta)" : "var(--accent-text)",
                  border: `1px solid ${isAdmin ? "rgba(255, 0, 234, 0.3)" : "var(--accent-border)"}`,
                  borderRadius: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {isAdmin ? <ShieldCheck size={12} /> : <KeyRound size={12} />}
                <span>{session?.name}</span>
                <span className="mono" style={{ opacity: 0.85 }}>
                  ({maxStocks ? `上限 ${maxStocks}銘柄` : "無制限"})
                </span>
              </span>

              {isUser && maxStocks && (
                <span
                  className="mono tiny"
                  style={{ color: isLimitReached ? "var(--neon-red)" : "var(--text-secondary)" }}
                >
                  登録: {basket.length} / {maxStocks} 銘柄
                </span>
              )}

              <button
                type="button"
                onClick={logout}
                className="btn btn-sm btn-outline"
                style={{ padding: "2px 6px", fontSize: 10 }}
                title="ログアウトしてロック"
              >
                <Lock size={10} /> ロック
              </button>
            </div>
          ) : (
            <div className="row flex-wrap" style={{ gap: 8, alignItems: "center" }}>
              <span className="row muted tiny" style={{ gap: 5 }} role="status">
                <Lock size={12} />{" "}
                {canEdit
                  ? "編集するにはパスワード認証が必要です"
                  : "この指数は閲覧専用です（作成者または管理者のみ編集可能）"}
              </span>
              {!isAuthenticated && (
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="btn btn-sm btn-outline"
                  style={{ padding: "2px 8px", fontSize: 11 }}
                >
                  <KeyRound size={12} /> {canEdit ? "ログインして編集" : "管理者ログイン"}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 8 }}>
          {onAddStock && canEdit && (
            <button
              type="button"
              onClick={handleAddStockClick}
              disabled={isLimitReached}
              className="btn btn-sm btn-default"
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              title={isLimitReached ? `上限 (${maxStocks}銘柄) に達しています` : "銘柄を追加"}
            >
              <Plus size={13} /> 銘柄を追加
            </button>
          )}
        </div>
      </div>

      <div className="table-wrapper desktop-constituents-table">
        <table className="custom-table" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th
                role="columnheader"
                aria-sort={
                  sortField === "ticker"
                    ? sortOrder === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                tabIndex={0}
                onClick={() => toggleSort("ticker")}
                onKeyDown={(e) => handleHeaderKeyDown(e, "ticker")}
                style={{ minWidth: 85, width: "10%" }}
              >
                <span className="row" style={{ gap: 2 }}>
                  コード {renderSortIcon("ticker")}
                </span>
              </th>
              <th
                role="columnheader"
                aria-sort={
                  sortField === "name" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"
                }
                tabIndex={0}
                onClick={() => toggleSort("name")}
                onKeyDown={(e) => handleHeaderKeyDown(e, "name")}
                style={{ minWidth: 140, width: "20%" }}
              >
                <span className="row" style={{ gap: 2 }}>
                  銘柄名 {renderSortIcon("name")}
                </span>
              </th>
              <th
                role="columnheader"
                aria-sort={
                  sortField === "theme"
                    ? sortOrder === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                tabIndex={0}
                onClick={() => toggleSort("theme")}
                onKeyDown={(e) => handleHeaderKeyDown(e, "theme")}
                style={{ minWidth: 100, width: "14%" }}
              >
                <span className="row" style={{ gap: 2 }}>
                  テーマ {renderSortIcon("theme")}
                </span>
              </th>
              <th
                role="columnheader"
                aria-sort={
                  sortField === "currentPrice"
                    ? sortOrder === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                tabIndex={0}
                onClick={() => toggleSort("currentPrice")}
                onKeyDown={(e) => handleHeaderKeyDown(e, "currentPrice")}
                style={{ minWidth: 90, width: "11%", textAlign: "right" }}
              >
                <span className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                  株価 {renderSortIcon("currentPrice")}
                </span>
              </th>
              <th
                role="columnheader"
                aria-sort={
                  sortField === "changePct"
                    ? sortOrder === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                tabIndex={0}
                onClick={() => toggleSort("changePct")}
                onKeyDown={(e) => handleHeaderKeyDown(e, "changePct")}
                style={{ minWidth: 95, width: "11%", textAlign: "right" }}
              >
                <span className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                  前日比 {renderSortIcon("changePct")}
                </span>
              </th>
              <th style={{ minWidth: 80, width: "10%", textAlign: "center" }}>トレンド</th>
              <th
                role="columnheader"
                aria-sort={
                  sortField === "contributionPt"
                    ? sortOrder === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                tabIndex={0}
                onClick={() => toggleSort("contributionPt")}
                onKeyDown={(e) => handleHeaderKeyDown(e, "contributionPt")}
                style={{ minWidth: 90, width: "10%", textAlign: "right" }}
              >
                <span className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                  寄与度 {renderSortIcon("contributionPt")}
                </span>
              </th>
              <th
                role="columnheader"
                aria-sort={
                  sortField === "weight"
                    ? sortOrder === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                tabIndex={0}
                onClick={() => toggleSort("weight")}
                onKeyDown={(e) => handleHeaderKeyDown(e, "weight")}
                style={{ minWidth: 110, width: "10%", textAlign: "right" }}
              >
                <span className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                  比率 {renderSortIcon("weight")}
                </span>
              </th>
              {onRemoveStock && canEdit && (
                <th style={{ minWidth: 50, width: "4%", textAlign: "center" }}>操作</th>
              )}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="popLayout">
              {filteredAndSorted.length > 0 ? (
                filteredAndSorted.map((item) => {
                  const isUp = item.changePct > 0;
                  const isDown = item.changePct < 0;
                  return (
                    <tr key={item.ticker}>
                      <td>
                        <a
                          href={getYahooFinanceUrl(item.ticker)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tag mono row"
                          style={{
                            textDecoration: "none",
                            gap: 4,
                            display: "inline-flex",
                            transition: "all 0.2s ease",
                          }}
                          title="Yahoo!ファイナンスで開く（新規タブ）"
                        >
                          {item.ticker}
                          <ExternalLink size={10} style={{ opacity: 0.7 }} />
                        </a>
                      </td>
                      <td>
                        <span style={{ fontWeight: 500 }}>{item.name}</span>
                      </td>
                      <td>
                        <Tag variant="theme" style={{ fontSize: 11 }}>
                          {item.theme}
                        </Tag>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span className="mono bold" style={{ fontSize: 12 }}>
                          {item.currentPrice > 0 ? `¥${item.currentPrice.toLocaleString()}` : "---"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span
                          className="mono bold row"
                          style={{
                            justifyContent: "flex-end",
                            gap: 2,
                            color: isUp
                              ? "var(--neon-green)"
                              : isDown
                                ? "var(--neon-red)"
                                : "inherit",
                          }}
                        >
                          {isUp && <TrendingUp size={11} />}
                          {isDown && <TrendingDown size={11} />}
                          {item.changePct >= 0 ? "+" : ""}
                          {item.changePct.toFixed(2)}%
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <Sparkline data={item.sparkline} isPositive={item.changePct >= 0} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span
                          className="mono bold"
                          style={{
                            color:
                              item.contributionPt >= 0.005
                                ? "var(--neon-green)"
                                : item.contributionPt <= -0.005
                                  ? "var(--neon-red)"
                                  : "inherit",
                          }}
                        >
                          {item.contributionPt >= 0.005 ? "+" : ""}
                          {Math.abs(item.contributionPt) < 0.005
                            ? "0.00"
                            : item.contributionPt.toFixed(2)}
                          pt
                        </span>
                      </td>
                      <td>
                        <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
                          <div className="weight-progress-cell">
                            <div className="weight-progress-bg">
                              <motion.div
                                className="weight-progress-bar"
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(item.weight, 100)}%` }}
                                transition={{ duration: 0.5 }}
                              />
                            </div>
                            <span
                              className="mono tiny"
                              style={{ minWidth: 42, textAlign: "right", fontWeight: 600 }}
                            >
                              {item.weight.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      </td>
                      {onRemoveStock && canEdit && (
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className="icon-button danger"
                            onClick={() => handleDeleteStockClick(item.ticker, item.name)}
                            title={
                              isAuthenticated
                                ? `銘柄「${item.name}」を削除`
                                : "削除するにはパスワード認証が必要です"
                            }
                            aria-label={
                              isAuthenticated
                                ? `銘柄「${item.name}」を削除`
                                : "削除するにはパスワード認証が必要です"
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={onRemoveStock && canEdit ? 9 : 8}
                    style={{ textAlign: "center", padding: "32px 16px" }}
                  >
                    <span className="muted mono tiny">該当する銘柄が見つかりません</span>
                  </td>
                </tr>
              )}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      <div className="constituents-mobile-list" aria-label="構成銘柄一覧">
        {filteredAndSorted.length > 0 ? (
          filteredAndSorted.map((item) => {
            const isUp = item.changePct > 0;
            const isDown = item.changePct < 0;
            return (
              <article key={item.ticker} className="constituent-mobile-card">
                <div className="constituent-mobile-heading">
                  <div className="constituent-mobile-identity">
                    <a
                      href={getYahooFinanceUrl(item.ticker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tag mono"
                      title="Yahoo!ファイナンスで開く（新規タブ）"
                    >
                      {item.ticker}
                      <ExternalLink size={10} aria-hidden="true" />
                    </a>
                    <strong>{item.name}</strong>
                    <Tag variant="theme">{item.theme}</Tag>
                  </div>
                  {onRemoveStock && canEdit && (
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => handleDeleteStockClick(item.ticker, item.name)}
                      title={
                        isAuthenticated
                          ? `銘柄「${item.name}」を削除`
                          : "削除するにはパスワード認証が必要です"
                      }
                      aria-label={
                        isAuthenticated
                          ? `銘柄「${item.name}」を削除`
                          : "削除するにはパスワード認証が必要です"
                      }
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>

                <div className="constituent-mobile-metrics">
                  <div>
                    <span>前日比</span>
                    <strong className={isUp ? "positive" : isDown ? "negative" : ""}>
                      {isUp && <TrendingUp size={12} aria-hidden="true" />}
                      {isDown && <TrendingDown size={12} aria-hidden="true" />}
                      {item.changePct >= 0 ? "+" : ""}
                      {item.changePct.toFixed(2)}%
                    </strong>
                  </div>
                  <div>
                    <span>寄与度</span>
                    <strong
                      className={
                        item.contributionPt >= 0.005
                          ? "positive"
                          : item.contributionPt <= -0.005
                            ? "negative"
                            : ""
                      }
                    >
                      {item.contributionPt >= 0.005 ? "+" : ""}
                      {Math.abs(item.contributionPt) < 0.005
                        ? "0.00"
                        : item.contributionPt.toFixed(2)}
                      pt
                    </strong>
                  </div>
                  <div>
                    <span>株価</span>
                    <strong>
                      {item.currentPrice > 0 ? `¥${item.currentPrice.toLocaleString()}` : "---"}
                    </strong>
                  </div>
                </div>

                <div className="constituent-mobile-footer">
                  <div className="constituent-mobile-weight">
                    <span>構成比 {item.weight.toFixed(2)}%</span>
                    <div className="weight-progress-bg" aria-hidden="true">
                      <motion.div
                        className="weight-progress-bar"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(item.weight, 100)}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </div>
                  <Sparkline data={item.sparkline} isPositive={item.changePct >= 0} />
                </div>
              </article>
            );
          })
        ) : (
          <div className="constituents-mobile-empty muted mono tiny">
            該当する銘柄が見つかりません
          </div>
        )}
      </div>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
          setPendingDeleteStock(null);
        }}
        onSuccess={() => {
          if (pendingDeleteStock) {
            // Authentication finishes before this component's session state
            // re-renders. Preserve the original action, but still require an
            // explicit destructive-operation confirmation after login.
            const target = pendingDeleteStock;
            setPendingDeleteStock(null);
            setConfirmDeleteStock(target);
          } else {
            setIsAddStockModalOpen(true);
          }
        }}
      />

      {/* Add Stock Modal */}
      {onAddStock && canEdit && (
        <AddStockModal
          isOpen={isAddStockModalOpen}
          onClose={() => setIsAddStockModalOpen(false)}
          indexName={indexName}
          currentCount={basket.length}
          maxStocks={maxStocks}
          onAddStock={handleAddStockSubmit}
        />
      )}

      {/* Confirm Stock Deletion Modal */}
      <ConfirmModal
        isOpen={confirmDeleteStock !== null}
        onClose={() => setConfirmDeleteStock(null)}
        title="構成銘柄の削除"
        description={`銘柄「${confirmDeleteStock?.name} (${confirmDeleteStock?.ticker})」をこの指数から削除しますか？\n（削除後は残りの銘柄で構成比率が自動調整されます）`}
        confirmText="削除する"
        cancelText="キャンセル"
        variant="danger"
        loading={deletingStock}
        onConfirm={async () => {
          if (confirmDeleteStock) {
            await executeDeleteStock(confirmDeleteStock.ticker, confirmDeleteStock.name);
          }
        }}
      />
    </Card>
  );
}
