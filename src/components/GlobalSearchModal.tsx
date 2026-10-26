import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
  Clock,
  Trash2,
} from "lucide-react";
import { POPULAR_STOCKS, type PopularStock } from "../data/popularStocks";
import { searchStockUniverse, ALL_UNIVERSE_STOCKS, normalizeSearchQuery, getUniverseStockByTicker, type StockMarket } from "../data/stockUniverse";
import { DEFAULT_MARKET_OVERVIEW, isMacroAsset } from "../lib/marketDataService";
import { formatMarketLabel } from "../lib/marketFormatter";
import { useModalFocus } from "../hooks/useModalFocus";
import { useOverlayRoot } from "./ModalBase";
import { isInteractiveKeyTarget } from "../lib/keyboardTarget";
import type { PageView } from "../lib/navigation";
import type { CustomIndex } from "../data/indices";

export type SearchCategory = "ALL" | "PRIME" | "STANDARD" | "GROWTH" | "US" | "MACRO";

export interface RecentSearchItem {
  id: string;
  title: string;
  subtitle: string;
  type: "stock" | "index";
  market: StockMarket;
  timestamp: number;
}

export const RECENT_SEARCHES_STORAGE_KEY = "indexforge:recent_searches";

/** The subset of the Storage API the recent-search list needs. */
type RecentSearchStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Resolve `localStorage` without touching it when it throws.
 *
 * `typeof localStorage` still evaluates the `window.localStorage` getter, and
 * that getter throws a SecurityError when storage is blocked (third-party
 * iframe, hardened privacy mode, "block all cookies"). The throw escaped the
 * `try` block, so merely importing/rendering the search modal crashed the whole
 * app. Reading the same property off `globalThis` (identical to
 * `window.localStorage` in a browser) inside a `try` keeps every access safe,
 * and also works in non-DOM runtimes.
 */
function safeLocalStorage(): RecentSearchStorage | null {
  try {
    return (globalThis as { localStorage?: RecentSearchStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Validate one recent-search entry read back from browser storage.
 *
 * The stored payload is untrusted: it can be hand-edited or written by an
 * older build. Every other storage reader in the codebase (`sanitizePosition`,
 * `sanitizeAuthSession`, `parseLocalSyncCache`, …) validates on read; this
 * reader used to blind-cast, so a `{ title: {} }` entry reached the result
 * list and crashed the render ("Objects are not valid as a React child").
 * Malformed entries are dropped, display-only `subtitle` is coerced.
 */
export function sanitizeRecentSearchItem(raw: unknown): RecentSearchItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!id || !title) return null;
  if (record.type !== "stock" && record.type !== "index") return null;
  const market = typeof record.market === "string" ? record.market.trim() : "";
  if (!market) return null;
  if (typeof record.timestamp !== "number" || !Number.isFinite(record.timestamp)) return null;
  return {
    id,
    title,
    subtitle: typeof record.subtitle === "string" ? record.subtitle : "",
    type: record.type,
    market: market as RecentSearchItem["market"],
    timestamp: record.timestamp,
  };
}

export function getRecentSearches(): RecentSearchItem[] {
  const storage = safeLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeRecentSearchItem)
      .filter((item): item is RecentSearchItem => item !== null)
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function saveRecentSearch(item: Omit<RecentSearchItem, "timestamp">): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    const current = getRecentSearches().filter((x) => x.id !== item.id);
    const updated: RecentSearchItem[] = [{ ...item, timestamp: Date.now() }, ...current].slice(0, 8);
    storage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage full / revoked mid-session: recent searches are best-effort and
    // must never block navigation.
  }
}

export function clearRecentSearches(): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function expandQueryTokenVariants(token: string): string[] {
  const variants = new Set<string>();
  if (!token) return [];
  variants.add(token);

  const nfkc = token.normalize("NFKC");
  if (nfkc) variants.add(nfkc);

  // Hiragana -> Katakana
  const hiraToKata = nfkc.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60),
  );
  if (hiraToKata) variants.add(hiraToKata);

  // Katakana -> Hiragana
  const kataToHira = nfkc.replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
  if (kataToHira) variants.add(kataToHira);

  return Array.from(variants).filter((v) => v.length > 0);
}

export function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query || !query.trim() || !text) return <>{text}</>;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return <>{text}</>;

  const allVariants = Array.from(
    new Set(tokens.flatMap((t) => expandQueryTokenVariants(t))),
  )
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (allVariants.length === 0) return <>{text}</>;

  const escaped = allVariants.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const splitRegex = new RegExp(`(${escaped})`, "i");
  const testRegex = new RegExp(`^(?:${escaped})$`, "i");
  const parts = text.split(splitRegex);

  return (
    <>
      {parts.map((part, i) =>
        testRegex.test(part) ? (
          <span
            key={i}
            style={{
              backgroundColor: "rgba(56, 189, 248, 0.25)",
              color: "var(--accent-color, #38bdf8)",
              borderRadius: "2px",
              padding: "0 1px",
              fontWeight: 700,
            }}
          >
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

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
  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isBackdropMouseDownRef = useRef(false);
  const overlayRoot = useOverlayRoot();

  // Focus trap, Escape handling and focus restoration are delegated to the
  // shared modal hook (same contract as every other dialog in the app); the
  // hook also needs the dialog marker to detect the topmost layer.
  useModalFocus(isOpen, dialogRef, onClose, inputRef);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveCategory("ALL");
      setSelectedIndex(0);
      setRecentSearches(getRecentSearches());
    }
  }, [isOpen]);

  const handleClearRecent = () => {
    clearRecentSearches();
    setRecentSearches([]);
  };

  // Filter stocks, macro assets, and custom indices from complete 4,500+ universe
  const filteredResults = useMemo(() => {
    const q = query.trim().toLowerCase();

    // Default / Empty query state: provide rich curated & trending assets across categories
    if (!q) {
      if (activeCategory === "ALL") {
        // Prepend recent searches if any exist
        const recentPicks = recentSearches.map((r) => ({
          type: r.type,
          id: r.id,
          title: r.title,
          subtitle: `${r.subtitle} · 最近閲覧`,
          market: r.market,
          isRecent: true,
          raw: { ticker: r.id, name: r.title, theme: r.subtitle },
        }));

        const recentIds = new Set(recentSearches.map((r) => r.id));

        // Rich default showcase: 4 benchmarks + 16 leading market stocks
        const benchmarks = [
          ...DEFAULT_MARKET_OVERVIEW.indices.slice(0, 3),
          ...DEFAULT_MARKET_OVERVIEW.forex.slice(0, 1),
        ]
          .filter((m) => !recentIds.has(m.symbol))
          .map((m) => ({
            type: "stock" as const,
            id: m.symbol,
            title: m.name,
            subtitle: `${m.symbol} · ${m.category === "INDEX" ? "主要市場指数" : "外国為替"} · ${m.price.toLocaleString()} ${m.currency}`,
            market: m.category as StockMarket,
            isRecent: false,
            raw: { ticker: m.symbol, name: m.name, theme: m.category },
          }));

        const popularPicks = POPULAR_STOCKS
          .filter((s) => !recentIds.has(s.ticker))
          .slice(0, 14)
          .map((stock) => {
            const isUS = !/^\d/.test(stock.ticker);
            const uStock = getUniverseStockByTicker(stock.ticker);
            const resolvedMarket = (isUS ? "US" : (uStock?.market ?? "PRIME")) as StockMarket;
            return {
              type: "stock" as const,
              id: stock.ticker,
              title: stock.name,
              subtitle: `${stock.ticker} · ${formatMarketLabel(resolvedMarket)} · ${stock.theme}`,
              market: resolvedMarket,
              isRecent: false,
              raw: stock,
            };
          });

        return [...recentPicks, ...benchmarks, ...popularPicks];
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

    const upperQuery =
      normalizeSearchQuery(query).toUpperCase() || q.toUpperCase();
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
              market: (getUniverseStockByTicker(upperQuery)?.market ?? (/^\d/.test(upperQuery) ? "PRIME" : "US")) as StockMarket,
              raw: {
                ticker: upperQuery,
                name: `銘柄 ${upperQuery}`,
                theme: /^\d/.test(upperQuery) ? "日本株" : "米国株",
              },
            },
          ]
        : [];

    return [...matchedMacro, ...customStockResult, ...matchedStocks, ...matchedIndices];
  }, [query, activeCategory, availableIndices, recentSearches]);

  const MAX_SEARCH_RESULTS = 80;
  const displayedResults = useMemo(
    () => filteredResults.slice(0, MAX_SEARCH_RESULTS),
    [filteredResults],
  );
  const remainingCount = Math.max(0, filteredResults.length - MAX_SEARCH_RESULTS);

  const handleSelect = useCallback(
    (item: (typeof filteredResults)[number]) => {
      // Recording history is best-effort: a blocked or full storage must never
      // swallow the navigation the user asked for.
      try {
        saveRecentSearch({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          type: item.type,
          market: item.market,
        });
      } catch {
        // ignore: storage is unavailable
      }
      if (item.type === "stock") {
        onNavigate("stock", `?ticker=${item.id}`);
      } else {
        onNavigate("dashboard", `?index=${item.id}`);
      }
      onClose();
    },
    [onNavigate, onClose],
  );

  // Handle keyboard navigation (Escape is owned by useModalFocus above)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || e.isComposing || e.keyCode === 229) return;
      if (filteredResults.length === 0) return;
      if (displayedResults.length === 0) return;

      // Keep Enter/arrow behavior only for the search input. Without this
      // guard, Enter while focus sat on a row action button (監視 / 指数に追加)
      // or the clear button was preventDefault-ed and the handler navigated to
      // the highlighted result instead, making those buttons unreachable from
      // the keyboard.
      if (isInteractiveKeyTarget(e.target, inputRef.current)) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < displayedResults.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : displayedResults.length - 1));
      } else if (e.key === "Enter" && displayedResults[selectedIndex]) {
        e.preventDefault();
        handleSelect(displayedResults[selectedIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, displayedResults, filteredResults.length, selectedIndex, handleSelect]);

  // Ensure active keyboard selection stays visible in scrollable container
  useEffect(() => {
    if (!isOpen || displayedResults.length === 0) return;
    const targetEl = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${selectedIndex}"]`,
    );
    targetEl?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, isOpen, displayedResults.length]);

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
            aria-expanded={isOpen && displayedResults.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={
              displayedResults.length > 0 ? `global-search-item-${selectedIndex}` : undefined
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
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
            {!query.trim() && recentSearches.length > 0 && activeCategory === "ALL" && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={handleClearRecent}
                style={{ fontSize: "10px", padding: "2px 6px", color: "var(--text-muted)" }}
                title="閲覧履歴を消去"
              >
                <Trash2 size={11} style={{ marginRight: 3 }} />
                履歴消去
              </button>
            )}
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              {query.trim()
                ? remainingCount > 0
                  ? `${displayedResults.length}件表示 (他${remainingCount}件)`
                  : `${filteredResults.length}件表示`
                : "ローカル即時検索 (0負荷)"}
            </span>
          </div>
        </div>

        {/* Search Results List */}
        <div
          ref={listRef}
          id="global-search-results"
          role="listbox"
          aria-label="検索結果"
          aria-live="polite"
          className="global-search-list"
        >
          {displayedResults.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-muted)" }}>
              <p>一致する銘柄または指数が見つかりませんでした。</p>
              <span className="tiny muted">コードまたは企業名を変えてお試しください。</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {displayedResults.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                const isRecent = Boolean((item as { isRecent?: boolean }).isRecent);
                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    id={`global-search-item-${idx}`}
                    role="option"
                    aria-selected={isSelected}
                    data-result-index={idx}
                    className={`search-result-item ${isSelected ? "selected" : ""}`}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "6px",
                          background: isRecent
                            ? "rgba(245, 158, 11, 0.12)"
                            : item.type === "stock"
                              ? "rgba(56, 189, 248, 0.1)"
                              : "rgba(168, 85, 247, 0.1)",
                          color: isRecent
                            ? "var(--neon-amber, #f59e0b)"
                            : item.type === "stock"
                              ? "var(--accent-color)"
                              : "#a855f7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {isRecent ? (
                          <Clock size={16} />
                        ) : item.type === "stock" ? (
                          <TrendingUp size={16} />
                        ) : (
                          <BarChart2 size={16} />
                        )}
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
                          <span>
                            <HighlightMatch text={item.title} query={query} />
                          </span>
                          {isRecent && (
                            <span
                              className="global-search-market-tag"
                              style={{
                                borderColor: "rgba(245, 158, 11, 0.4)",
                                color: "var(--neon-amber, #f59e0b)",
                              }}
                            >
                              最近閲覧
                            </span>
                          )}
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
                        <div className="tiny muted mono">
                          <HighlightMatch text={item.subtitle} query={query} />
                        </div>
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
                            const s = item.raw as Partial<PopularStock> | undefined;
                            const ticker = s?.ticker || item.id;
                            const name = s?.name || item.title;
                            const theme = s?.theme || "その他";
                            onAddToIndex(ticker, name, theme);
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
              {remainingCount > 0 && (
                <div
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    background: "var(--surface-inset, rgba(0, 0, 0, 0.05))",
                    borderRadius: "6px",
                    marginTop: "4px",
                  }}
                >
                  他 {remainingCount} 件... 検索条件を絞り込んでください
                </div>
              )}
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

  // Portal into the overlay root (the fullscreen element when one is active);
  // `null` during SSR, where the overlay renders inline.
  return overlayRoot ? createPortal(modalContent, overlayRoot) : modalContent;
}
