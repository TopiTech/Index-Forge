import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Search,
  Sparkles,
  Zap,
  BarChart2,
  Sliders,
  ArrowRight,
  PieChart,
  Clock,
  Layers,
  RefreshCw,
  ChevronRight,
  Globe,
  Plus,
  BookmarkPlus,
  Check,
} from "lucide-react";
import {
  fetchScreenerStocks,
  getCachedStockFundamentals,
  formatMarketCapDisplay,
  type StockQuoteFundamentals,
} from "../lib/marketDataService";
import { formatStockPrice, formatStockChange } from "../lib/currency";
import { POPULAR_STOCKS } from "../data/popularStocks";
import { searchStockUniverse, normalizeSearchQuery, getUniverseStockByTicker } from "../data/stockUniverse";
import { getRecentSearches } from "./GlobalSearchModal";
import type { PageView } from "../lib/navigation";
import { useRegisterFreshness } from "../contexts/FreshnessContext";

export interface StockAnalysisPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
  onAddToIndex?: (ticker: string, name: string, theme: string) => void;
  onAddToWatchlist?: (ticker: string) => void;
  onAddToPortfolio?: (ticker: string, currentPrice: number) => void;
}

type ThemeCategory =
  | "ALL"
  | "SEMICONDUCTOR"
  | "AI_TECH"
  | "MOBILITY_DEFENSE"
  | "FINANCE_TRADING"
  | "HIGH_DIVIDEND"
  | "US_TECH";

const THEME_TABS: { id: ThemeCategory; label: string; icon: string }[] = [
  { id: "ALL", label: "主要注目銘柄", icon: "⭐" },
  { id: "SEMICONDUCTOR", label: "半導体・電子", icon: "⚡" },
  { id: "AI_TECH", label: "AI・通信・IT", icon: "🤖" },
  { id: "MOBILITY_DEFENSE", label: "モビリティ・防衛", icon: "🚗" },
  { id: "FINANCE_TRADING", label: "メガバンク・商社", icon: "🏦" },
  { id: "HIGH_DIVIDEND", label: "高配当・バリュー", icon: "💰" },
  { id: "US_TECH", label: "米国メガキャップ", icon: "🇺🇸" },
];

const POPULAR_SEARCH_CHIPS = [
  { ticker: "7203", label: "トヨタ (7203)" },
  { ticker: "NVDA", label: "NVIDIA (NVDA)" },
  { ticker: "8035", label: "東エレク (8035)" },
  { ticker: "6758", label: "ソニーG (6758)" },
  { ticker: "9984", label: "ソフトバンクG (9984)" },
  { ticker: "8306", label: "三菱UFJ (8306)" },
  { ticker: "7011", label: "三菱重工 (7011)" },
  { ticker: "AAPL", label: "Apple (AAPL)" },
];

const MACRO_QUICK_PICKS = [
  { symbol: "^N225", name: "日経平均株価", category: "日本主要指数" },
  { symbol: "^TOPX", name: "TOPIX", category: "東証市場全体" },
  { symbol: "^GSPC", name: "S&P 500", category: "米国主要500社" },
  { symbol: "^IXIC", name: "NASDAQ", category: "米国ハイテク指数" },
  { symbol: "USDJPY=X", name: "米ドル / 円", category: "為替レート" },
];

export function StockAnalysisPage({
  onNavigate,
  onOpenStockDetail,
  onAddToIndex,
  onAddToWatchlist,
  onAddToPortfolio,
}: StockAnalysisPageProps) {
  const [stocks, setStocks] = useState<StockQuoteFundamentals[]>(() => {
    // Initial sync populate from cache to prevent blank screens
    return POPULAR_STOCKS.map((p) => getCachedStockFundamentals(p.ticker));
  });
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(() => Date.now());

  useRegisterFreshness("stock", {
    loading,
    updatedAt: lastUpdatedAt,
    typeLabel: "銘柄分析",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<ThemeCategory>("ALL");
  const [recentItems, setRecentItems] = useState<{ id: string; title: string; subtitle: string }[]>([]);
  const [addedWatchlistMap, setAddedWatchlistMap] = useState<Record<string, boolean>>({});
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const searchFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchFormRef.current && !searchFormRef.current.contains(e.target as Node)) {
        setIsSearchDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    try {
      const recents = getRecentSearches();
      setRecentItems(
        recents
          .filter((r) => r.type === "stock")
          .slice(0, 8)
          .map((r) => ({ id: r.id, title: r.title, subtitle: r.subtitle })),
      );
    } catch {
      // Ignore local storage error
    }
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadData = useCallback(async (forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const data = await fetchScreenerStocks({}, forceRefresh);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      if (data && data.length > 0) {
        setStocks(data);
        setLastUpdatedAt(Date.now());
      }
    } catch {
      // Keep cached data
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Filter stocks by theme category
  const themeFilteredStocks = useMemo(() => {
    if (selectedTheme === "ALL") return stocks;
    return stocks.filter((stock) => {
      const theme = stock.theme || "";
      const sector = stock.sector || "";
      const isUS = stock.market === "US";

      switch (selectedTheme) {
        case "SEMICONDUCTOR":
          return (
            theme.includes("半導体") ||
            sector.includes("半導体") ||
            theme.includes("電子") ||
            ["8035", "6857", "6920", "6723", "7735", "6146", "4063"].includes(stock.ticker)
          );
        case "AI_TECH":
          return (
            theme.includes("AI") ||
            theme.includes("通信") ||
            theme.includes("クラウド") ||
            theme.includes("IT") ||
            ["9984", "9432", "9433", "9434", "3778", "4689", "6702"].includes(stock.ticker)
          );
        case "MOBILITY_DEFENSE":
          return (
            theme.includes("自動車") ||
            theme.includes("モビリティ") ||
            theme.includes("防衛") ||
            ["7203", "7267", "7269", "7201", "6902", "7011", "7012", "7013"].includes(stock.ticker)
          );
        case "FINANCE_TRADING":
          return (
            theme.includes("メガバンク") ||
            theme.includes("総合商社") ||
            theme.includes("金融") ||
            theme.includes("保険") ||
            ["8306", "8316", "8411", "8058", "8001", "8031", "8053", "8002", "8766", "8604"].includes(stock.ticker)
          );
        case "HIGH_DIVIDEND":
          return (stock.dividendYield ?? 0) >= 3.0 || (stock.pbr !== null && stock.pbr < 1.2);
        case "US_TECH":
          return isUS || ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA"].includes(stock.ticker);
        default:
          return true;
      }
    });
  }, [stocks, selectedTheme]);

  // Search filtered results (supplemented with full TSE universe)
  const searchResults = useMemo(() => {
    const rawQ = searchQuery.trim();
    if (!rawQ) return [];
    const normQ = normalizeSearchQuery(rawQ);
    const q = rawQ.toLowerCase();
    const tokens = normQ ? normQ.split(/\s+/).filter(Boolean) : [];
    const localMatches = stocks.filter((s) => {
      const sNormName = normalizeSearchQuery(s.name);
      const sNormTicker = normalizeSearchQuery(s.ticker);
      const sNameLower = s.name.toLowerCase();
      const sTickerLower = s.ticker.toLowerCase();
      const sThemeLower = s.theme ? s.theme.toLowerCase() : "";
      const sThemeNorm = s.theme ? normalizeSearchQuery(s.theme) : "";
      const sSectorLower = s.sector ? s.sector.toLowerCase() : "";
      const sSectorNorm = s.sector ? normalizeSearchQuery(s.sector) : "";
      const uStock = getUniverseStockByTicker(s.ticker);
      const sAliasesNorm = uStock?.normAliases || "";
      const sAliasesRaw = uStock?.rawAliasesLower || (uStock?.aliases ? uStock.aliases.toLowerCase() : "");

      const matchesToken = (tok: string): boolean => {
        const tokLower = tok.toLowerCase();
        return (
          sTickerLower.includes(tokLower) ||
          sNameLower.includes(tokLower) ||
          sNormTicker.includes(tok) ||
          sNormName.includes(tok) ||
          sThemeLower.includes(tokLower) ||
          sThemeNorm.includes(tok) ||
          sSectorLower.includes(tokLower) ||
          sSectorNorm.includes(tok) ||
          sAliasesNorm.includes(tok) ||
          sAliasesRaw.includes(tokLower)
        );
      };

      if (tokens.length > 1) {
        return tokens.every(matchesToken);
      }
      return (
        matchesToken(normQ) ||
        sTickerLower.includes(q) ||
        sNameLower.includes(q) ||
        sAliasesRaw.includes(q)
      );
    });

    const seenTickers = new Set(localMatches.map((s) => s.ticker.toUpperCase()));
    const universeMatches = searchStockUniverse(searchQuery, { limit: 8 });
    const additional = universeMatches
      .filter((u) => !seenTickers.has(u.ticker.toUpperCase()))
      .map((u) => getCachedStockFundamentals(u.ticker));

    return [...localMatches, ...additional].slice(0, 10);
  }, [stocks, searchQuery]);

  // Market movers
  const topGainers = useMemo(() => {
    return [...stocks]
      .filter((s) => Number.isFinite(s.changePercent))
      .sort((a, b) => {
        if (b.changePercent !== a.changePercent) {
          return b.changePercent - a.changePercent;
        }
        return a.ticker.localeCompare(b.ticker);
      })
      .slice(0, 4);
  }, [stocks]);

  const topLosers = useMemo(() => {
    return [...stocks]
      .filter((s) => Number.isFinite(s.changePercent))
      .sort((a, b) => {
        if (a.changePercent !== b.changePercent) {
          return a.changePercent - b.changePercent;
        }
        return a.ticker.localeCompare(b.ticker);
      })
      .slice(0, 4);
  }, [stocks]);

  const highYieldPicks = useMemo(() => {
    return [...stocks]
      .filter(
        (s) =>
          typeof s.dividendYield === "number" &&
          Number.isFinite(s.dividendYield) &&
          s.dividendYield > 0,
      )
      .sort((a, b) => {
        const yieldA = a.dividendYield!;
        const yieldB = b.dividendYield!;
        if (yieldB !== yieldA) {
          return yieldB - yieldA;
        }
        return a.ticker.localeCompare(b.ticker);
      })
      .slice(0, 4);
  }, [stocks]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearchDropdownOpen(false);
    if (searchResults.length > 0) {
      onOpenStockDetail(searchResults[0].ticker);
    } else if (searchQuery.trim()) {
      onOpenStockDetail(searchQuery.trim().toUpperCase());
    }
  };

  const handleToggleWatchlist = (e: React.MouseEvent, ticker: string) => {
    e.stopPropagation();
    onAddToWatchlist?.(ticker);
    setAddedWatchlistMap((prev) => ({ ...prev, [ticker]: true }));
  };

  const renderSparkline = (data?: number[], isPositive = true) => {
    if (!data || data.length < 2) return null;
    const validData = data.filter((v) => typeof v === "number" && Number.isFinite(v));
    if (validData.length < 2) return null;
    const min = Math.min(...validData);
    const max = Math.max(...validData);
    const range = max - min || 1;
    const width = 80;
    const height = 28;

    const points = validData
      .map((val, idx) => {
        const x = (idx / (validData.length - 1)) * width;
        const y = height - ((val - min) / range) * (height - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    const strokeColor = isPositive ? "var(--neon-green, #10b981)" : "var(--neon-pink, #f43f5e)";

    return (
      <svg width={width} height={height} className="stock-analysis-sparkline" aria-hidden="true">
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    );
  };

  return (
    <div className="page-container stock-analysis-hub-page">
      {/* Hero Header Section */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="stock-analysis-hero-card"
      >
        <div className="stock-analysis-hero-header">
          <div className="stock-analysis-hero-badge">
            <Sparkles size={13} className="text-cyan animate-pulse" />
            <span>INDIVIDUAL STOCK ANALYSIS PORTAL</span>
          </div>
          <div className="stock-analysis-hero-actions">
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => onNavigate("screener")}
              title="詳細スクリーナーで4,500銘柄から条件検索"
            >
              <Zap size={14} />
              <span>スクリーナーを開く</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => void loadData(true)}
              disabled={loading}
              title="市場データを再取得"
              aria-label="市場データを再取得"
            >
              <RefreshCw size={14} className={loading ? "spin animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div className="stock-analysis-hero-content">
          <h1 className="stock-analysis-title">銘柄分析ハブ</h1>
          <p className="stock-analysis-subtitle">
            日本株・米国株の財務指標、テクニカルチャート、業績推移を深掘り分析。気になる銘柄を検索・選択して詳細レポートを展開します。
          </p>

          {/* Interactive Search Bar */}
          <form
            ref={searchFormRef}
            onSubmit={handleSearchSubmit}
            className="stock-analysis-search-form"
            role="search"
            aria-label="銘柄検索"
          >
            <div className="stock-analysis-search-input-wrapper">
              <Search size={18} className="stock-analysis-search-icon" aria-hidden="true" />
              <input
                type="text"
                className="stock-analysis-search-input"
                placeholder="銘柄コード（例: 7203）、企業名（例: トヨタ）、米国株（例: NVDA）で即座に分析..."
                value={searchQuery}
                onFocus={() => {
                  if (searchQuery.trim()) setIsSearchDropdownOpen(true);
                }}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchDropdownOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsSearchDropdownOpen(false);
                  }
                }}
                aria-label="銘柄コード・企業名を入力"
                autoComplete="off"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="stock-analysis-search-clear"
                  onClick={() => {
                    setSearchQuery("");
                    setIsSearchDropdownOpen(false);
                  }}
                  aria-label="検索キーワードをクリア"
                >
                  ✕
                </button>
              )}
              <button
                type="submit"
                className="btn btn-primary stock-analysis-search-submit-btn"
                disabled={!searchQuery.trim()}
              >
                <span>分析する</span>
                <ArrowRight size={15} />
              </button>
            </div>

            {/* Instant Search Suggestions Dropdown */}
            {isSearchDropdownOpen && searchQuery.trim() && (
              <div className="stock-analysis-search-dropdown" role="listbox">
                {searchResults.length > 0 ? (
                  searchResults.map((item) => (
                    <div
                      key={item.ticker}
                      role="option"
                      tabIndex={0}
                      aria-selected={false}
                      className="stock-analysis-search-dropdown-item"
                      onClick={() => {
                        setIsSearchDropdownOpen(false);
                        onOpenStockDetail(item.ticker);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setIsSearchDropdownOpen(false);
                          onOpenStockDetail(item.ticker);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setIsSearchDropdownOpen(false);
                        }
                      }}
                    >
                      <div className="stock-analysis-search-item-info">
                        <span className="stock-analysis-search-ticker">{item.ticker}</span>
                        <span className="stock-analysis-search-name">{item.name}</span>
                        <span className="stock-analysis-search-theme">{item.theme || item.sector}</span>
                      </div>
                      <div className="stock-analysis-search-item-price">
                        <span className="price-val">
                          {formatStockPrice(item.price, item.ticker, { market: item.market })}
                        </span>
                        {(() => {
                          const isZero = Math.abs(item.changePercent) < 0.005 || item.changePercent === 0;
                          const isPos = item.changePercent > 0;
                          return (
                            <span
                              className={`change-val ${isZero ? "neutral" : isPos ? "positive" : "negative"}`}
                              style={isZero ? { color: "var(--text-muted)" } : undefined}
                            >
                              {formatStockChange(item.change, item.ticker, { market: item.market })} ({!isZero && isPos ? "+" : ""}{item.changePercent.toFixed(2)}%)
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="stock-analysis-search-empty">
                    <span>一致する銘柄が見つかりませんでした。「{searchQuery}」のコードで直接分析を開くことができます。</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline mt-2"
                      onClick={() => onOpenStockDetail(searchQuery.trim().toUpperCase())}
                    >
                      コード「{searchQuery.trim().toUpperCase()}」で詳細を開く
                    </button>
                  </div>
                )}
              </div>
            )}
          </form>

          {/* Quick Search Chips */}
          <div className="stock-analysis-chips-row">
            <span className="stock-analysis-chips-label">人気の銘柄:</span>
            <div className="stock-analysis-chips-list">
              {POPULAR_SEARCH_CHIPS.map((chip) => (
                <button
                  key={chip.ticker}
                  type="button"
                  className="stock-analysis-chip-btn"
                  onClick={() => onOpenStockDetail(chip.ticker)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Recent Viewed Stocks (if any) */}
      {recentItems.length > 0 && (
        <section className="stock-analysis-section" aria-label="最近閲覧した銘柄">
          <div className="stock-analysis-section-header">
            <div className="stock-analysis-section-title-wrap">
              <Clock size={16} className="text-secondary" />
              <h2 className="stock-analysis-section-title">最近閲覧した銘柄</h2>
            </div>
          </div>
          <div className="stock-analysis-recent-grid">
            {recentItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="stock-analysis-recent-card"
                onClick={() => onOpenStockDetail(item.id)}
              >
                <div className="stock-analysis-recent-id">{item.id}</div>
                <div className="stock-analysis-recent-name">{item.title}</div>
                <ChevronRight size={14} className="stock-analysis-recent-arrow" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Market Movers: Gainers, Losers, and High Dividend Spotlight */}
      <section className="stock-analysis-section" aria-label="マーケット動向と注目銘柄">
        <div className="stock-analysis-section-header">
          <div className="stock-analysis-section-title-wrap">
            <BarChart2 size={18} className="text-cyan" />
            <h2 className="stock-analysis-section-title">本日の市場注目銘柄</h2>
          </div>
          <span className="stock-analysis-section-caption">急騰・急落および割安高配当のピックアップ</span>
        </div>

        <div className="stock-analysis-movers-grid">
          {/* Top Gainers Column */}
          <div className="stock-analysis-mover-col">
            <div className="stock-analysis-mover-header gainers">
              <TrendingUp size={16} />
              <span>本日の値上がり上位</span>
            </div>
            <div className="stock-analysis-mover-list">
              {topGainers.map((item) => (
                <div
                  key={item.ticker}
                  role="button"
                  tabIndex={0}
                  className="stock-analysis-mover-row"
                  onClick={() => onOpenStockDetail(item.ticker)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenStockDetail(item.ticker);
                    }
                  }}
                >
                  <div className="stock-analysis-mover-left">
                    <span className="stock-mover-ticker">{item.ticker}</span>
                    <span className="stock-mover-name" title={item.name}>
                      {item.name}
                    </span>
                  </div>
                  <div className="stock-analysis-mover-right">
                    <span className="stock-mover-price">
                      {formatStockPrice(item.price, item.ticker, { market: item.market })}
                    </span>
                    {/* 符号は値から導出する。固定 "+" だと全面安の上位銘柄で "+-1.20%" と表示される */}
                    <span
                      className={`stock-mover-change ${item.changePercent >= 0 ? "positive" : "negative"}`}
                    >
                      {item.changePercent > 0 ? "+" : ""}
                      {item.changePercent.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Losers Column */}
          <div className="stock-analysis-mover-col">
            <div className="stock-analysis-mover-header losers">
              <TrendingDown size={16} />
              <span>本日の値下がり上位</span>
            </div>
            <div className="stock-analysis-mover-list">
              {topLosers.map((item) => (
                <div
                  key={item.ticker}
                  role="button"
                  tabIndex={0}
                  className="stock-analysis-mover-row"
                  onClick={() => onOpenStockDetail(item.ticker)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenStockDetail(item.ticker);
                    }
                  }}
                >
                  <div className="stock-analysis-mover-left">
                    <span className="stock-mover-ticker">{item.ticker}</span>
                    <span className="stock-mover-name" title={item.name}>
                      {item.name}
                    </span>
                  </div>
                  <div className="stock-analysis-mover-right">
                    <span className="stock-mover-price">
                      {formatStockPrice(item.price, item.ticker, { market: item.market })}
                    </span>
                    {/* 符号・色は値から導出する。固定 negative だと全面高の下位銘柄が赤く "+なし" で表示される */}
                    <span
                      className={`stock-mover-change ${item.changePercent >= 0 ? "positive" : "negative"}`}
                    >
                      {item.changePercent > 0 ? "+" : ""}
                      {item.changePercent.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* High Dividend Spotlight Column */}
          <div className="stock-analysis-mover-col">
            <div className="stock-analysis-mover-header dividend">
              <Sparkles size={16} />
              <span>高配当・バリュー注目株</span>
            </div>
            <div className="stock-analysis-mover-list">
              {highYieldPicks.map((item) => (
                <div
                  key={item.ticker}
                  role="button"
                  tabIndex={0}
                  className="stock-analysis-mover-row"
                  onClick={() => onOpenStockDetail(item.ticker)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenStockDetail(item.ticker);
                    }
                  }}
                >
                  <div className="stock-analysis-mover-left">
                    <span className="stock-mover-ticker">{item.ticker}</span>
                    <span className="stock-mover-name" title={item.name}>
                      {item.name}
                    </span>
                  </div>
                  <div className="stock-analysis-mover-right">
                    <span className="stock-mover-price">
                      利回り {(item.dividendYield ?? 0).toFixed(2)}%
                    </span>
                    <span className="stock-mover-change neutral">
                      PBR {item.pbr !== null ? `${item.pbr.toFixed(2)}x` : "-"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Featured Stock Explorer by Theme */}
      <section className="stock-analysis-section" aria-label="テーマ別個別銘柄一覧">
        <div className="stock-analysis-section-header flex-col-sm">
          <div>
            <div className="stock-analysis-section-title-wrap">
              <Layers size={18} className="text-cyan" />
              <h2 className="stock-analysis-section-title">注目セクター・テーマ別銘柄</h2>
            </div>
            <span className="stock-analysis-section-caption">
              主要代表銘柄の株価・ファンダメンタルズ・テクニカル評価
            </span>
          </div>

          {/* Theme Selector Tabs */}
          <div className="stock-analysis-theme-tabs" role="tablist" aria-label="テーマ切り替え">
            {THEME_TABS.map((tab) => {
              const isActive = selectedTheme === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`stock-analysis-theme-tab ${isActive ? "active" : ""}`}
                  onClick={() => setSelectedTheme(tab.id)}
                >
                  <span className="tab-icon" aria-hidden="true">
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Stock Cards Grid */}
        <div className="stock-analysis-cards-grid">
          {themeFilteredStocks.map((stock) => {
            const isPositive = stock.changePercent >= 0;
            const isAdded = Boolean(addedWatchlistMap[stock.ticker]);

            return (
              <motion.div
                key={stock.ticker}
                whileHover={{ y: -3 }}
                transition={{ duration: 0.18 }}
                className="stock-analysis-card"
                onClick={() => onOpenStockDetail(stock.ticker)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenStockDetail(stock.ticker);
                  }
                }}
              >
                {/* Card Top: Ticker, Market, Theme & Actions */}
                <div className="stock-card-top">
                  <div className="stock-card-badges">
                    <span className="stock-card-ticker">{stock.ticker}</span>
                    <span className="stock-card-market">
                      {stock.market === "US"
                        ? "米国株"
                        : stock.market === "GROWTH"
                        ? "東証グロース"
                        : stock.market === "STANDARD"
                        ? "東証スタンダード"
                        : "東証プライム"}
                    </span>
                    {stock.theme && <span className="stock-card-theme">{stock.theme}</span>}
                    {stock.marketCap > 0 && (
                      <span className="stock-card-cap" title="時価総額">
                        {formatMarketCapDisplay(stock.marketCap, stock.market)}
                      </span>
                    )}
                  </div>
                  <div className="stock-card-actions">
                    {onAddToIndex && (
                      <button
                        type="button"
                        className="stock-card-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToIndex(stock.ticker, stock.name, stock.theme || "その他");
                        }}
                        title="指数に追加"
                        aria-label={`${stock.name}を指数に追加`}
                      >
                        <Plus size={13} />
                      </button>
                    )}
                    {onAddToPortfolio && (
                      <button
                        type="button"
                        className="stock-card-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToPortfolio(stock.ticker, stock.price);
                        }}
                        title="ポートフォリオに追加"
                        aria-label={`${stock.name}をポートフォリオに追加`}
                      >
                        <PieChart size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className={`stock-card-action-btn ${isAdded ? "added" : ""}`}
                      onClick={(e) => handleToggleWatchlist(e, stock.ticker)}
                      title={isAdded ? "監視リスト追加済み" : "監視リストに追加"}
                      aria-label={`${stock.name}を監視リストに追加`}
                    >
                      {isAdded ? <Check size={13} /> : <BookmarkPlus size={13} />}
                    </button>
                  </div>
                </div>

                {/* Card Body: Name, Price, Change */}
                <div className="stock-card-body">
                  <h3 className="stock-card-name" title={stock.name}>
                    {stock.name}
                  </h3>
                  <div className="stock-card-price-row">
                    <div>
                      <div className="stock-card-price">
                        {formatStockPrice(stock.price, stock.ticker, { market: stock.market })}
                      </div>
                      {(() => {
                        const isZero =
                          Math.abs(stock.changePercent) < 0.005 || stock.changePercent === 0;
                        return (
                          <div
                            className={`stock-card-change ${
                              isZero ? "neutral" : isPositive ? "positive" : "negative"
                            }`}
                            style={isZero ? { color: "var(--text-muted)" } : undefined}
                          >
                            {formatStockChange(stock.change, stock.ticker, { market: stock.market })}{" "}
                            ({!isZero && isPositive ? "+" : ""}
                            {stock.changePercent.toFixed(2)}%)
                          </div>
                        );
                      })()}
                    </div>
                    <div className="stock-card-sparkline-wrap">
                      {renderSparkline(stock.sparkline, isPositive)}
                    </div>
                  </div>
                </div>

                {/* Card Metrics Grid: PER, PBR, Dividend, Signal */}
                <div className="stock-card-metrics">
                  <div className="stock-card-metric-item">
                    <span className="metric-label">PER</span>
                    <span
                      className="metric-value"
                      title={stock.isEstimatedPer ? (stock.perNote || "会社予想非開示のため直近実績(TTM)より推計") : undefined}
                    >
                      {typeof stock.per === "number" && Number.isFinite(stock.per) && stock.per > 0
                        ? `${stock.isEstimatedPer ? "約" : ""}${stock.per.toFixed(1)}x`
                        : "-"}
                    </span>
                  </div>
                  <div className="stock-card-metric-item">
                    <span className="metric-label">PBR</span>
                    <span className="metric-value">
                      {stock.pbr !== null ? `${stock.pbr.toFixed(2)}x` : "-"}
                    </span>
                  </div>
                  <div className="stock-card-metric-item">
                    <span className="metric-label">配当利回り</span>
                    <span className="metric-value">
                      {stock.dividendYield !== null ? `${stock.dividendYield.toFixed(2)}%` : "-"}
                    </span>
                  </div>
                  <div className="stock-card-metric-item">
                    <span className="metric-label">評価シグナル</span>
                    <span
                      className={`metric-signal-badge ${
                        stock.technicalSignal === "STRONG_BUY" || stock.technicalSignal === "BUY"
                          ? "bullish"
                          : stock.technicalSignal === "SELL" || stock.technicalSignal === "STRONG_SELL"
                          ? "bearish"
                          : "neutral"
                      }`}
                    >
                      {stock.technicalSignal === "STRONG_BUY"
                        ? "強気買い"
                        : stock.technicalSignal === "BUY"
                        ? "買い"
                        : stock.technicalSignal === "SELL"
                        ? "売り"
                        : stock.technicalSignal === "STRONG_SELL"
                        ? "強気売り"
                        : "中立"}
                    </span>
                  </div>
                </div>

                {/* Card Footer: Detail Link Indicator */}
                <div className="stock-card-footer">
                  <span className="stock-card-explore-text">詳細チャート・財務を見る</span>
                  <ChevronRight size={14} className="stock-card-arrow" />
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Macro & Index Quick Access Section */}
      <section className="stock-analysis-section" aria-label="主要市場指数と為替">
        <div className="stock-analysis-section-header">
          <div className="stock-analysis-section-title-wrap">
            <Globe size={18} className="text-cyan" />
            <h2 className="stock-analysis-section-title">主要指数・マクロ市場の分析</h2>
          </div>
          <span className="stock-analysis-section-caption">
            日経平均・S&P500・為替などマクロ資産のチャート分析
          </span>
        </div>

        <div className="stock-analysis-macro-grid">
          {MACRO_QUICK_PICKS.map((macro) => {
            const macroFund = getCachedStockFundamentals(macro.symbol);
            const isPos = macroFund.changePercent >= 0;
            const isUsdJpy = macro.symbol.includes("USDJPY");
            const formattedPrice = isUsdJpy
              ? `¥${macroFund.price.toFixed(2)}`
              : macro.symbol.startsWith("^")
              ? macroFund.price.toLocaleString("ja-JP", { maximumFractionDigits: 1 })
              : macroFund.price.toLocaleString("ja-JP", { maximumFractionDigits: 2 });

            return (
              <div
                key={macro.symbol}
                role="button"
                tabIndex={0}
                className="stock-analysis-macro-card"
                onClick={() => onOpenStockDetail(macro.symbol)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenStockDetail(macro.symbol);
                  }
                }}
              >
                <div className="macro-card-left">
                  <span className="macro-symbol">{macro.symbol}</span>
                  <span className="macro-name">{macro.name}</span>
                  <span className="macro-cat">{macro.category}</span>
                </div>
                <div className="macro-card-right">
                  <div className="macro-card-price-block">
                    <div className="macro-card-price mono">{formattedPrice}</div>
                    <div className={`macro-card-change mono tiny ${isPos ? "text-positive" : "text-negative"}`}>
                      {isPos ? "+" : ""}{macroFund.changePercent.toFixed(2)}%
                    </div>
                  </div>
                  <ChevronRight size={16} className="macro-card-arrow" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Platform Synergy Footer Banner */}
      <div className="stock-analysis-synergy-banner">
        <div className="synergy-banner-content">
          <div className="synergy-banner-icon-wrap">
            <Sliders size={24} className="text-cyan" />
          </div>
          <div>
            <h3 className="synergy-banner-title">気になる銘柄を組み合わせてオリジナル指数を作成</h3>
            <p className="synergy-banner-desc">
              お気に入りの銘柄や分析した銘柄を束ねて、世界にひとつだけのカスタム株価指数やポートフォリオをシミュレーションできます。
            </p>
          </div>
        </div>
        <div className="synergy-banner-buttons">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onNavigate("builder")}
          >
            <Sliders size={15} />
            <span>指数ビルダーへ移動</span>
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => onNavigate("portfolio")}
          >
            <PieChart size={15} />
            <span>ポートフォリオ管理へ</span>
          </button>
        </div>
      </div>
    </div>
  );
}
