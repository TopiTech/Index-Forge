import React, { useState, useEffect, useRef, useMemo } from "react";
import { Search, X, TrendingUp, BarChart2, BookmarkPlus, CornerDownLeft, Sparkles } from "lucide-react";
import { POPULAR_STOCKS, type PopularStock } from "../data/popularStocks";
import { useModalFocus } from "../hooks/useModalFocus";
import type { PageView } from "../lib/navigation";
import type { CustomIndex } from "../data/indices";

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: PageView, searchParams?: string) => void;
  onAddToIndex?: (ticker: string, name: string, theme: string) => void;
  onAddToWatchlist?: (ticker: string) => void;
  availableIndices?: CustomIndex[];
}

export function GlobalSearchModal({
  isOpen,
  onClose,
  onNavigate,
  onAddToIndex,
  onAddToWatchlist,
  availableIndices = [],
}: GlobalSearchModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap, Escape handling and focus restoration are delegated to the
  // shared modal hook (same contract as every other dialog in the app); the
  // hook also needs the dialog marker to detect the topmost layer.
  useModalFocus(isOpen, dialogRef, onClose, inputRef);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Filter stocks and custom indices
  const filteredResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Default: show top popular stocks
      return POPULAR_STOCKS.slice(0, 8).map((stock) => ({
        type: "stock" as const,
        id: stock.ticker,
        title: stock.name,
        subtitle: `${stock.ticker} · ${stock.theme}`,
        raw: stock,
      }));
    }

    const matchedStocks = POPULAR_STOCKS.filter(
      (s) =>
        s.ticker.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.theme.toLowerCase().includes(q),
    ).slice(0, 8).map((stock) => ({
      type: "stock" as const,
      id: stock.ticker,
      title: stock.name,
      subtitle: `${stock.ticker} · ${stock.theme}`,
      raw: stock,
    }));

    const matchedIndices = availableIndices
      .filter(
        (idx) =>
          idx.id.toLowerCase().includes(q) ||
          idx.name.toLowerCase().includes(q) ||
          (idx.description && idx.description.toLowerCase().includes(q)),
      )
      .slice(0, 4)
      .map((idx) => ({
        type: "index" as const,
        id: idx.id,
        title: idx.name,
        subtitle: `カスタム指数 · ${idx.basket.length}銘柄`,
        raw: idx,
      }));

    return [...matchedStocks, ...matchedIndices];
  }, [query, availableIndices]);

  // Handle keyboard navigation (Escape is owned by useModalFocus above)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredResults.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredResults.length - 1));
      } else if (e.key === "Enter" && filteredResults[selectedIndex]) {
        e.preventDefault();
        const item = filteredResults[selectedIndex];
        if (item.type === "stock") {
          onNavigate("stock", `?ticker=${item.id}`);
        } else {
          onNavigate("dashboard", `?index=${item.id}`);
        }
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredResults, selectedIndex, onClose, onNavigate]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        data-modal-dialog
        className="modal-card global-search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="銘柄・指数の統合検索"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "640px",
          width: "92vw",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          overflow: "hidden",
        }}
      >
        {/* Search Input Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-color)",
            gap: "12px",
          }}
        >
          <Search size={20} className="muted" />
          <input
            ref={inputRef}
            type="text"
            className="global-search-input"
            placeholder="銘柄名、コード (例: 7203, NVDA)、テーマ、指数を検索..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: "1.05rem",
              color: "var(--text-color)",
            }}
          />
          {query && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "4px" }}
              onClick={() => setQuery("")}
            >
              <X size={16} />
            </button>
          )}
          <span className="badge badge-default mono tiny" style={{ padding: "2px 6px" }}>
            ESC
          </span>
        </div>

        {/* Search Results List */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "10px",
            maxHeight: "400px",
          }}
        >
          {filteredResults.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-muted)" }}>
              <p>一致する銘柄または指数が見つかりませんでした。</p>
              <span className="tiny muted">コードまたは企業名を変えてお試しください。</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {filteredResults.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    className={`search-result-item ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      if (item.type === "stock") {
                        onNavigate("stock", `?ticker=${item.id}`);
                      } else {
                        onNavigate("dashboard", `?index=${item.id}`);
                      }
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      cursor: "pointer",
                      background: isSelected ? "var(--bg-card-hover)" : "transparent",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "6px",
                          background: item.type === "stock" ? "rgba(56, 189, 248, 0.1)" : "rgba(168, 85, 247, 0.1)",
                          color: item.type === "stock" ? "var(--accent-color)" : "#a855f7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {item.type === "stock" ? <TrendingUp size={16} /> : <BarChart2 size={16} />}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                          {item.title}
                        </div>
                        <div className="tiny muted mono">{item.subtitle}</div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {item.type === "stock" && onAddToWatchlist && (
                        <button
                          type="button"
                          className="btn btn-ghost tiny"
                          title="ウォッチリストに追加"
                          aria-label={`${item.title}をウォッチリストに追加`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddToWatchlist(item.id);
                          }}
                        >
                          <BookmarkPlus size={14} />
                          <span style={{ marginLeft: "4px" }}>監視</span>
                        </button>
                      )}
                      {item.type === "stock" && onAddToIndex && (
                        <button
                          type="button"
                          className="btn btn-ghost tiny"
                          title="指数ビルダーに追加"
                          aria-label={`${item.title}を指数に追加`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const s = item.raw as PopularStock;
                            onAddToIndex(s.ticker, s.name, s.theme);
                            onClose();
                          }}
                        >
                          <Sparkles size={14} />
                          <span style={{ marginLeft: "4px" }}>指数に追加</span>
                        </button>
                      )}
                      {isSelected && (
                        <div className="mono tiny muted" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <span>選択</span>
                          <CornerDownLeft size={12} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.78rem",
            color: "var(--text-muted)",
            background: "var(--bg-app)",
          }}
        >
          <div style={{ display: "flex", gap: "14px" }}>
            <span>↑↓ で選択</span>
            <span>↵ で決定</span>
            <span>ESC で閉じる</span>
          </div>
          <div>
            <span>IndexForge 統合検索</span>
          </div>
        </div>
      </div>
    </div>
  );
}
