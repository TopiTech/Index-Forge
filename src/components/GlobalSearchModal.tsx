import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  Search,
  X,
  TrendingUp,
  BarChart2,
  BookmarkPlus,
  CornerDownLeft,
  Sparkles,
} from "lucide-react";
import { POPULAR_STOCKS, type PopularStock } from "../data/popularStocks";
import { searchStockUniverse, ALL_UNIVERSE_STOCKS, type StockMarket } from "../data/stockUniverse";
import { DEFAULT_MARKET_OVERVIEW, isMacroAsset } from "../lib/marketDataService";
import { useModalFocus } from "../hooks/useModalFocus";
import { isInteractiveKeyTarget } from "../lib/keyboardTarget";
import type { PageView } from "../lib/navigation";
import type { CustomIndex } from "../data/indices";

export type SearchCategory = "ALL" | "PRIME" | "STANDARD" | "GROWTH" | "US" | "MACRO";

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
  const [activeCategory, setActiveCategory] = useState<SearchCategory>("ALL");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isBackdropMouseDownRef = useRef(false);

  // Focus trap, Escape handling and focus restoration are delegated to the
  // shared modal hook (same contract as every other dialog in the app); the
  // hook also needs the dialog marker to detect the topmost layer.
  useModalFocus(isOpen, dialogRef, onClose, inputRef);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveCategory("ALL");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Filter stocks, macro assets, and custom indices from complete 4,500+ universe
  const filteredResults = useMemo(() => {
    const q = query.trim().toLowerCase();

    // Default / Empty query state: provide rich curated & trending assets across categories
    if (!q) {
      if (activeCategory === "ALL") {
        // Rich default showcase: 4 benchmarks + 16 leading market stocks
        const benchmarks = [
          ...DEFAULT_MARKET_OVERVIEW.indices.slice(0, 3),
          ...DEFAULT_MARKET_OVERVIEW.forex.slice(0, 1),
        ].map((m) => ({
          type: "stock" as const,
          id: m.symbol,
          title: m.name,
          subtitle: `${m.symbol} · ${m.category === "INDEX" ? "主要市場指数" : "外国為替"} · ${m.price.toLocaleString()} ${m.currency}`,
          market: m.category as StockMarket,
          raw: { ticker: m.symbol, name: m.name, theme: m.category },
        }));

        const popularPicks = POPULAR_STOCKS.slice(0, 14).map((stock) => {
          const isUS = !/^\d/.test(stock.ticker);
          return {
            type: "stock" as const,
            id: stock.ticker,
            title: stock.name,
            subtitle: `${stock.ticker} · ${isUS ? "米国株" : "東証プライム"} · ${stock.theme}`,
            market: (isUS ? "US" : "PRIME") as StockMarket,
            raw: stock,
          };
        });

        return [...benchmarks, ...popularPicks];
      }

      if (activeCategory === "MACRO") {
        return [
          ...DEFAULT_MARKET_OVERVIEW.indices,
          ...DEFAULT_MARKET_OVERVIEW.forex,
          ...DEFAULT_MARKET_OVERVIEW.commodities,
          ...DEFAULT_MARKET_OVERVIEW.crypto,
        ].map((m) => ({
          type: "stock" as const,
          id: m.symbol,
          title: m.name,
          subtitle: `${m.symbol} · ${m.category} · ${m.price.toLocaleString()} ${m.currency}`,
          market: m.category as StockMarket,
          raw: { ticker: m.symbol, name: m.name, theme: m.category },
        }));
      }

      // Filter universe by category
      return ALL_UNIVERSE_STOCKS.filter((s) => s.market === activeCategory)
        .slice(0, 18)
        .map((s) => ({
          type: "stock" as const,
          id: s.ticker,
          title: s.name,
          subtitle: `${s.ticker} · ${s.market} · ${s.sector}`,
          market: s.market,
          raw: { ticker: s.ticker, name: s.name, theme: s.sector },
        }));
    }

    // Macro assets (indices, forex, commodities, crypto)
    const allMacro = [
      ...DEFAULT_MARKET_OVERVIEW.indices,
      ...DEFAULT_MARKET_OVERVIEW.forex,
      ...DEFAULT_MARKET_OVERVIEW.commodities,
      ...DEFAULT_MARKET_OVERVIEW.crypto,
    ];

    const isStockCategory =
      activeCategory === "PRIME" ||
      activeCategory === "STANDARD" ||
      activeCategory === "GROWTH" ||
      activeCategory === "US";

    const matchedMacro = isStockCategory
      ? []
      : allMacro
          .filter(
            (m) =>
              m.symbol.toLowerCase().includes(q) ||
              m.name.toLowerCase().includes(q) ||
              (m.category === "INDEX" && ("指数".includes(q) || "index".includes(q))) ||
              (m.category === "FX" && ("為替".includes(q) || "fx".includes(q) || "ドル円".includes(q))),
          )
          .slice(0, 4)
          .map((item) => ({
            type: "stock" as const,
            id: item.symbol,
            title: item.name,
            subtitle: `${item.symbol} · ${
              item.category === "INDEX"
                ? "主要市場指数"
                : item.category === "FX"
                  ? "外国為替"
                  : item.category === "COMMODITY"
                    ? "商品先物"
                    : "暗号資産"
            } · ${item.price.toLocaleString()} ${item.currency}`,
            market: item.category as StockMarket,
            raw: {
              ticker: item.symbol,
              name: item.name,
              theme: item.category,
            },
          }));

    // Comprehensive 4,500+ Stock Universe in-memory search
    const targetMarket = isStockCategory ? activeCategory : undefined;
    const universeResults = searchStockUniverse(query, {
      limit: 25,
      market: targetMarket,
    });

    const matchedStocks = universeResults.map((stock) => {
      const popularPreset = POPULAR_STOCKS.find(
        (p) => p.ticker.toUpperCase() === stock.ticker.toUpperCase(),
      );
      const themeOrSector = popularPreset ? popularPreset.theme : stock.sector;

      return {
        type: "stock" as const,
        id: stock.ticker,
        title: stock.name,
        subtitle: `${stock.ticker} · ${stock.market} · ${themeOrSector}`,
        market: stock.market,
        raw: {
          ticker: stock.ticker,
          name: stock.name,
          theme: themeOrSector,
        },
      };
    });

    const matchedIndices = isStockCategory
      ? []
      : availableIndices
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
            market: "INDEX" as StockMarket,
            raw: idx,
          }));

    const upperQuery = q.toUpperCase();
    const isTickerPattern = /^[A-Z0-9.]{2,8}$/.test(upperQuery);
    const hasExactTicker = matchedStocks.some((s) => s.id.toUpperCase() === upperQuery);
    const hasExactMacro = matchedMacro.some((m) => m.id.toUpperCase() === upperQuery);

    const customStockResult =
      isTickerPattern && !hasExactTicker && !hasExactMacro
        ? [
            {
              type: "stock" as const,
              id: upperQuery,
              title: `銘柄 ${upperQuery}`,
              subtitle: `${upperQuery} · 個別銘柄の分析・詳細を表示`,
              market: (/^\d/.test(upperQuery) ? "PRIME" : "US") as StockMarket,
              raw: {
                ticker: upperQuery,
                name: `銘柄 ${upperQuery}`,
                theme: /^\d/.test(upperQuery) ? "日本株" : "米国株",
              },
            },
          ]
        : [];

    return [...matchedMacro, ...customStockResult, ...matchedStocks, ...matchedIndices];
  }, [query, activeCategory, availableIndices]);

  // Handle keyboard navigation (Escape is owned by useModalFocus above)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || e.isComposing || e.keyCode === 229) return;
      if (filteredResults.length === 0) return;

      // Keep Enter/arrow behavior only for the search input. Without this
      // guard, Enter while focus sat on a row action button (監視 / 指数に追加)
      // or the clear button was preventDefault-ed and the handler navigated to
      // the highlighted result instead, making those buttons unreachable from
      // the keyboard.
      if (isInteractiveKeyTarget(e.target, inputRef.current)) return;

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

  // Ensure active keyboard selection stays visible in scrollable container
  useEffect(() => {
    if (!isOpen || filteredResults.length === 0) return;
    const targetEl = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${selectedIndex}"]`,
    );
    targetEl?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, isOpen, filteredResults.length]);

  if (!isOpen) return null;

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isBackdropMouseDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isBackdropMouseDownRef.current && e.target === e.currentTarget) {
      onClose();
    }
    isBackdropMouseDownRef.current = false;
  };

  const modalContent = (
    <div
      className="modal-overlay"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <motion.div
        ref={dialogRef}
        data-modal-dialog
        className="modal-dialog global-search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="銘柄・指数の統合検索"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: -12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -12 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        {/* Search Input Bar */}
        <div className="global-search-header">
          <Search size={20} className="muted" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen && filteredResults.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={
              filteredResults.length > 0 ? `global-search-item-${selectedIndex}` : undefined
            }
            className="global-search-input"
            placeholder="銘柄名、コード (例: 7203, NVDA)、テーマ、指数を検索..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          {query && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "4px" }}
              onClick={() => setQuery("")}
              aria-label="検索キーワードをクリア"
            >
              <X size={16} />
            </button>
          )}
          <span className="badge badge-default mono tiny" style={{ padding: "2px 6px" }}>
            ESC
          </span>
        </div>

        {/* Category Filter Bar */}
        <div className="global-search-filter-bar">
          {(
            [
              { id: "ALL", label: "すべて (4,500+)" },
              { id: "PRIME", label: "東証プライム" },
              { id: "STANDARD", label: "東証STD" },
              { id: "GROWTH", label: "東証グロース" },
              { id: "US", label: "米国株" },
              { id: "MACRO", label: "主要指数・為替" },
            ] as const
          ).map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`global-search-filter-btn ${activeCategory === cat.id ? "active" : ""}`}
              onClick={() => {
                setActiveCategory(cat.id);
                setSelectedIndex(0);
              }}
            >
              {cat.label}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text-muted)" }}>
            {query.trim()
              ? `${filteredResults.length}件表示`
              : "ローカル即時検索 (0負荷)"}
          </span>
        </div>

        {/* Search Results List */}
        <div
          ref={listRef}
          id="global-search-results"
          role="listbox"
          aria-label="検索結果"
          className="global-search-list"
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
                    id={`global-search-item-${idx}`}
                    role="option"
                    aria-selected={isSelected}
                    data-result-index={idx}
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
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "6px",
                          background:
                            item.type === "stock"
                              ? "rgba(56, 189, 248, 0.1)"
                              : "rgba(168, 85, 247, 0.1)",
                          color: item.type === "stock" ? "var(--accent-color)" : "#a855f7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {item.type === "stock" ? <TrendingUp size={16} /> : <BarChart2 size={16} />}
                      </div>
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "0.95rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>{item.title}</span>
                          {item.market === "PRIME" && (
                            <span className="global-search-market-tag prime">プライム</span>
                          )}
                          {item.market === "STANDARD" && (
                            <span className="global-search-market-tag standard">STD</span>
                          )}
                          {item.market === "GROWTH" && (
                            <span className="global-search-market-tag growth">グロース</span>
                          )}
                          {item.market === "US" && (
                            <span className="global-search-market-tag us">米国株</span>
                          )}
                          {item.market === "ETF" && (
                            <span className="global-search-market-tag">ETF</span>
                          )}
                          {item.market === "REIT" && (
                            <span className="global-search-market-tag">REIT</span>
                          )}
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
                      {item.type === "stock" && !isMacroAsset(item.id) && onAddToIndex && (
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
                        <div
                          className="mono tiny muted"
                          style={{ display: "flex", alignItems: "center", gap: "4px" }}
                        >
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
        <div className="global-search-footer">
          <div style={{ display: "flex", gap: "14px" }}>
            <span>↑↓ で選択</span>
            <span>↵ で決定</span>
            <span>ESC で閉じる</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="tiny muted">✨ 4,500+ 東証全銘柄・米国株 即時検索</span>
          </div>
        </div>
      </motion.div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
}
