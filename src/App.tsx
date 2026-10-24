import { useState, useCallback, useMemo, useEffect, useRef, Suspense, lazy } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Menu, RefreshCw, X } from "lucide-react";
import { useIndices } from "./hooks/useIndices";
import { isBenchmarkDataForSymbol, useBenchmark, AVAILABLE_BENCHMARKS } from "./hooks/useBenchmark";
import { useCalculation } from "./hooks/useCalculation";
import { useAuth } from "./hooks/useAuth";
import { useToast } from "./components/Toast";
import { addWatchlistTicker, addPortfolioPosition, todayJstDateString } from "./lib/portfolioStorage";
import { reportAddStockResult } from "./lib/addStockFeedback";
import { POPULAR_STOCKS } from "./data/popularStocksData";
import { Header, type HeaderProps } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { TradingViewTickerTape } from "./components/TradingViewTickerTape";
import { StatsGrid } from "./components/StatsGrid";
import { BenchmarkSelector } from "./components/BenchmarkSelector";
import { IndexSelector } from "./components/IndexSelector";
import { ThemeBreakdown } from "./components/ThemeBreakdown";
import { RiskMetricsCard } from "./components/RiskMetricsCard";
import { ConstituentsTable } from "./components/ConstituentsTable";
import { IndexBuilderModal } from "./components/IndexBuilderModal";
import { useOverlayRoot } from "./components/ModalBase";
// recharts (419KB / 113KB gzip) is only needed by these two dashboard widgets.
// Importing them statically put the whole charting library in the first paint,
// so they load as their own chunks behind a region-level Suspense boundary.
const PerformanceChart = lazy(() =>
  import("./components/PerformanceChart").then((m) => ({ default: m.PerformanceChart })),
);
const ThemeHeatmap = lazy(() =>
  import("./components/ThemeHeatmap").then((m) => ({ default: m.ThemeHeatmap })),
);
// Route-level pages are lazy-loaded so the initial bundle (dashboard) does
// not pay for three.js (tutorial 3D scene), recharts-heavy admin tooling,
// or rarely-visited static pages.
const IndexBuilderPage = lazy(() =>
  import("./components/IndexBuilderPage").then((m) => ({ default: m.IndexBuilderPage })),
);
const AdminDashboard = lazy(() =>
  import("./components/AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
);
const MarketOverviewPage = lazy(() =>
  import("./components/MarketOverviewPage").then((m) => ({ default: m.MarketOverviewPage })),
);
const StockDetailPage = lazy(() =>
  import("./components/StockDetailPage").then((m) => ({ default: m.StockDetailPage })),
);
const StockAnalysisPage = lazy(() =>
  import("./components/StockAnalysisPage").then((m) => ({ default: m.StockAnalysisPage })),
);
const PortfolioManagerPage = lazy(() =>
  import("./components/PortfolioManagerPage").then((m) => ({ default: m.PortfolioManagerPage })),
);
const ScreenerPage = lazy(() =>
  import("./components/ScreenerPage").then((m) => ({ default: m.ScreenerPage })),
);
const CalendarPage = lazy(() =>
  import("./components/CalendarPage").then((m) => ({ default: m.CalendarPage })),
);
const GlobalSearchModal = lazy(() =>
  import("./components/GlobalSearchModal").then((m) => ({ default: m.GlobalSearchModal })),
);
/**
 * Shared (module-level) promise so repeated hovers/⌘K presses reuse one
 * network request instead of kicking off a new dynamic import each time.
 */
let globalSearchChunkPromise: Promise<unknown> | null = null;
export const preloadGlobalSearchModal = () => {
  globalSearchChunkPromise ??= import("./components/GlobalSearchModal");
  return globalSearchChunkPromise;
};

import { LoadingScreen } from "./components/LoadingScreen";
import { buildChartData } from "./lib/chartData";
import { filterByTimeframe } from "./lib/timeframe";
import { Footer } from "./components/Footer";
import { MobileBottomNav } from "./components/MobileBottomNav";
const DisclaimerPage = lazy(() =>
  import("./components/DisclaimerPage").then((m) => ({ default: m.DisclaimerPage })),
);
const TutorialPage = lazy(() =>
  import("./components/TutorialPage").then((m) => ({ default: m.TutorialPage })),
);
const PortfolioPage = lazy(() =>
  import("./components/PortfolioPage").then((m) => ({ default: m.PortfolioPage })),
);
import { shouldShowTutorialOnLaunch } from "./lib/tutorialStorage";
import {
  parseViewFromLocation,
  getViewPath,
  parseDashboardParams,
  resolveStockTicker,
  buildDashboardQuery,
  type PageView,
} from "./lib/navigation";
import type { Timeframe, BenchmarkSymbol } from "./types";
import type { CustomIndex } from "./data/indices";
import type { ReactNode } from "react";
import { FreshnessProvider, useActiveFreshness } from "./contexts/FreshnessContext";

const VALID_TIMEFRAMES: readonly Timeframe[] = ["1W", "1M", "3M", "6M", "YTD", "1Y"] as const;
function isValidTimeframe(tf: string | undefined): tf is Timeframe {
  return typeof tf === "string" && (VALID_TIMEFRAMES as readonly string[]).includes(tf);
}

function isBenchmarkSymbol(s: string | undefined): s is BenchmarkSymbol {
  return AVAILABLE_BENCHMARKS.some((b) => b.symbol === s);
}

const MOBILE_LAYOUT_QUERY = "(max-width: 1080px)";

/**
 * Collapsed state of the dashboard's index-selector column. Separate from
 * `indexforge:sidebar:collapsed` (the navigation rail): they are two different
 * panels toggled by two different buttons, so they need two keys.
 */
const INDEX_SIDEBAR_COLLAPSED_KEY = "indexforge:index-sidebar:collapsed";

/** Shared page layout for all non-admin views (Sidebar + Header + TickerTape + Footer). */
function PageLayout({
  headerProps,
  currentView,
  navigateTo,
  searchModal,
  overlays,
  children,
}: {
  headerProps: React.ComponentProps<typeof Header>;
  currentView: PageView;
  navigateTo: (view: PageView, searchParams?: string) => void;
  searchModal?: ReactNode;
  overlays?: ReactNode;
  children: ReactNode;
}) {
  const [isNavOpen, setIsNavOpen] = useState(false);
  const navToggleRef = useRef<HTMLButtonElement>(null);

  const activeFreshness = useActiveFreshness(currentView, headerProps);
  const resolvedHeaderProps: React.ComponentProps<typeof Header> = {
    ...headerProps,
    benchmarkUpdatedAt: activeFreshness.benchmarkUpdatedAt,
    calculationUpdatedAt: activeFreshness.calculationUpdatedAt,
    updatedAt: activeFreshness.updatedAt,
    loading: activeFreshness.loading,
    syncing: activeFreshness.syncing,
    stale: activeFreshness.stale,
    hasSyncWarning: activeFreshness.hasSyncWarning,
    typeLabel: activeFreshness.typeLabel,
    customStatusText: activeFreshness.customStatusText,
  };

  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("indexforge:sidebar:collapsed") === "true";
    } catch {
      return false;
    }
  });

  const handleToggleDesktopSidebar = useCallback(() => {
    setIsDesktopSidebarCollapsed((prev) => !prev);
  }, []);

  // 永続化は effect 側で行う。setState の updater は純粋でなければならず、
  // StrictMode の二重実行で二重書き込みや破棄された更新の書き込みが起きる。
  useEffect(() => {
    try {
      localStorage.setItem("indexforge:sidebar:collapsed", String(isDesktopSidebarCollapsed));
    } catch {
      // ignore
    }
  }, [isDesktopSidebarCollapsed]);

  // Closing the drawer restores focus to the header toggle so keyboard users
  // do not lose their place (Escape path and item activation both route here).
  const closeNav = useCallback(() => {
    setIsNavOpen(false);
    navToggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const handleLayoutChange = () => {
      if (!mediaQuery.matches) {
        setIsNavOpen(false);
      }
    };
    mediaQuery.addEventListener("change", handleLayoutChange);
    return () => mediaQuery.removeEventListener("change", handleLayoutChange);
  }, []);

  useEffect(() => {
    if (!isNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isNavOpen]);

  return (
    <>
      <div className="site-wrapper">
        <div className="app-shell">
          <Sidebar
            currentView={currentView}
            navigateTo={navigateTo}
            isOpen={isNavOpen}
            onRequestClose={closeNav}
            isCollapsed={isDesktopSidebarCollapsed}
            onToggleCollapse={handleToggleDesktopSidebar}
            freshnessProps={resolvedHeaderProps}
          />
          <div className="app-column">
            <div className="app">
              <Header
                {...resolvedHeaderProps}
                onNavigateToHome={() => navigateTo("dashboard")}
                isNavOpen={isNavOpen}
                onToggleNav={() => setIsNavOpen((prev) => !prev)}
                navToggleRef={navToggleRef}
              />
              <TradingViewTickerTape />
              <main style={{ minHeight: "calc(100vh - 280px)" }}>{children}</main>
            </div>
          </div>
        </div>
        <Footer onNavigate={navigateTo} currentView={currentView} />
      </div>
      {overlays}
      {searchModal}
      <MobileBottomNav currentView={currentView} onNavigate={navigateTo} />
    </>
  );
}

function getInitialMobileLayout() {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

/**
 * Placeholder for a lazily loaded dashboard widget (PerformanceChart /
 * ThemeHeatmap). It only reserves the space the widget will occupy so the
 * Suspense boundary does not collapse the layout mid-paint.
 */
function LazyWidgetPlaceholder({
  label,
  minHeight = 280,
}: {
  label: string;
  minHeight?: number;
}) {
  return (
    <div
      className="card"
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        minHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      }}
    >
      <RefreshCw size={18} className="animate-spin muted" aria-hidden="true" />
      <span className="muted tiny mono">{label}</span>
    </div>
  );
}

/**
 * Placeholder for the index-dependent part of the dashboard.
 *
 * The app shell (navigation, header, ticker tape, footer) is rendered
 * unconditionally, so the first paint keeps its chrome and only this region
 * waits for `/api/indices`.
 */
function IndexRegionSkeleton() {
  return (
    <div
      className="card"
      role="status"
      aria-live="polite"
      aria-label="指数一覧を読み込み中"
      style={{
        minHeight: 320,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        textAlign: "center",
      }}
    >
      <RefreshCw size={22} className="animate-spin muted" aria-hidden="true" />
      <p className="muted tiny mono" style={{ margin: 0 }}>
        指数一覧を読み込み中...
      </p>
    </div>
  );
}

/**
 * Inline failure state for the index region. `useIndices` falls back to the
 * built-in indices and surfaces the failure as a toast, so this only triggers
 * when there is nothing at all to render — and it keeps the shell intact
 * instead of replacing the whole app.
 */
function IndexRegionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="card"
      role="alert"
      style={{
        minHeight: 280,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        textAlign: "center",
        borderColor: "var(--neon-red)",
      }}
    >
      <p style={{ margin: 0, color: "var(--neon-red)", fontWeight: 600 }}>指数一覧を取得できませんでした</p>
      <p className="muted tiny" style={{ margin: 0 }}>
        {message}
      </p>
      <button type="button" className="btn btn-default" onClick={onRetry}>
        <RefreshCw size={14} style={{ marginRight: 6 }} />
        再試行
      </button>
    </div>
  );
}

/** Lightweight stand-in shown while the ⌘K palette chunk downloads. */
function SearchModalLoadingShell({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog"
        role="status"
        aria-live="polite"
        aria-label="検索画面を読み込み中"
        style={{
          maxWidth: 460,
          minHeight: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <RefreshCw size={16} className="animate-spin muted" aria-hidden="true" />
        <span className="muted tiny mono">検索画面を読み込み中...</span>
      </div>
    </div>
  );
}

function getInitialView(): PageView {
  if (typeof window === "undefined") return "dashboard";
  if (shouldShowTutorialOnLaunch()) return "tutorial";
  return parseViewFromLocation(window.location.pathname, window.location.search);
}

function AppContent({
  isReloadSuppressed = false,
}: {
  isReloadSuppressed?: boolean;
} = {}) {
  const initialDashboardParamsRef = useRef(
    typeof window !== "undefined" ? parseDashboardParams(window.location.search) : {},
  );
  const [isMobileLayout, setIsMobileLayout] = useState(getInitialMobileLayout);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !getInitialMobileLayout());
  // The index-selector column of the dashboard has its own collapse control
  // (distinct from the navigation rail). Like the nav rail it must survive a
  // reload, so the state is read once from storage and written back in an
  // effect (never inside a state updater, which must stay pure).
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(INDEX_SIDEBAR_COLLAPSED_KEY) !== "true";
    } catch {
      return true;
    }
  });

  const toggleDesktopIndexSidebar = useCallback(() => {
    setIsDesktopSidebarOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        INDEX_SIDEBAR_COLLAPSED_KEY,
        String(!isDesktopSidebarOpen),
      );
    } catch {
      // Storage unavailable: the column state simply does not persist.
    }
  }, [isDesktopSidebarOpen]);
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const initialTf = initialDashboardParamsRef.current.timeframe;
    return isValidTimeframe(initialTf) ? initialTf : "1M";
  });
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarWasOpenRef = useRef(false);
  const [currentView, setCurrentView] = useState<PageView>(getInitialView);
  const [activeStockTicker, setActiveStockTicker] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    // Deep links come in as both `/stock?ticker=7203` and `/stock/7203`.
    return (
      resolveStockTicker(window.location.pathname, window.location.search) || null
    );
  });
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const overlayRoot = useOverlayRoot();
  // Whether the lazily imported palette module has finished downloading. While
  // it has not, the modal has never been committed and a second ⌘K must not
  // cancel the pending open (that looks like the shortcut doing nothing).
  const searchChunkLoadedRef = useRef(false);
  const { isAdmin, isAuthenticated } = useAuth();
  const { success: toastSuccess, info: toastInfo, error: toastError, warning: toastWarning } =
    useToast();

  const ensureSearchChunk = useCallback(() => {
    if (searchChunkLoadedRef.current) return;
    void preloadGlobalSearchModal()
      .then(() => {
        searchChunkLoadedRef.current = true;
      })
      .catch(() => {
        // A failed preload must not freeze the toggle in its pending state;
        // the lazy component retries the import itself on the next render.
        searchChunkLoadedRef.current = true;
      });
  }, []);

  const openSearchModal = useCallback(() => {
    ensureSearchChunk();
    setIsSearchModalOpen(true);
  }, [ensureSearchChunk]);

  const toggleSearchModal = useCallback(() => {
    ensureSearchChunk();
    // Pending open (chunk still loading, nothing rendered yet): keep it open.
    if (isSearchModalOpen && !searchChunkLoadedRef.current) return;
    setIsSearchModalOpen(!isSearchModalOpen);
  }, [ensureSearchChunk, isSearchModalOpen]);

  // Global Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (currentView === "admin" || currentView === "tutorial") return;
        e.preventDefault();
        toggleSearchModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSearchModal, currentView]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const syncLayout = () => {
      setIsMobileLayout(mediaQuery.matches);
      setIsSidebarOpen(!mediaQuery.matches);
    };

    syncLayout();
    mediaQuery.addEventListener("change", syncLayout);
    return () => mediaQuery.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    if (!isMobileLayout || !isSidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSidebarOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMobileLayout, isSidebarOpen]);

  useEffect(() => {
    if (!isMobileLayout) {
      sidebarWasOpenRef.current = false;
      return;
    }

    if (!isSidebarOpen) {
      if (sidebarWasOpenRef.current) {
        sidebarWasOpenRef.current = false;
        // Opening the Index Builder closes the drawer and opens a modal in the
        // same commit. Child effects run before parent effects, so useModalFocus
        // has already moved focus into the dialog by the time this runs;
        // re-focusing the toolbar toggle would pull it back out of the modal and
        // leave it stranded on <body> when the modal closes.
        if (!document.querySelector("[data-modal-dialog]")) {
          sidebarToggleRef.current?.focus();
        }
      }
      return;
    }

    const drawer = sidebarRef.current;
    if (!drawer) return;

    sidebarWasOpenRef.current = true;
    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const focusable = () =>
      Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.getClientRects().length > 0,
      );
    const initialTarget = drawer.querySelector<HTMLElement>(".sidebar-close-button, input, button");
    const frame = window.requestAnimationFrame(() => initialTarget?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !drawer.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !drawer.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isMobileLayout, isSidebarOpen]);

  const {
    indices,
    selectedIndex,
    selectIndex,
    loading: loadingIndices,
    error: indicesError,
    saveCustomIndex,
    deleteCustomIndex,
    addStockToIndex,
    removeStockFromIndex,
    refreshIndices,
    isOwner,
  } = useIndices();

  // The indices hook falls back to cached/built-in data on failure so the app
  // keeps rendering, which made the error state unreachable and left users
  // staring at default indices with no hint that their server data is
  // unavailable. Surface it as a toast instead of failing silently.
  useEffect(() => {
    if (indicesError) {
      toastWarning(
        `指数一覧を取得できませんでした（${indicesError}）。内蔵の既定指数を表示しています。`,
      );
    }
  }, [indicesError, toastWarning]);

  const {
    selectedBenchmark,
    setSelectedBenchmark,
    benchmarkData,
    loading: loadingBenchmark,
    error: benchmarkError,
    availableBenchmarks,
    refetch: refetchBenchmark,
    lastUpdatedAt: benchmarkUpdatedAt,
  } = useBenchmark("^N225", currentView === "dashboard");

  const initialBenchmarkHandledRef = useRef(false);
  useEffect(() => {
    if (initialBenchmarkHandledRef.current) return;
    const targetBenchmark = initialDashboardParamsRef.current.benchmark;
    if (isBenchmarkSymbol(targetBenchmark)) {
      setSelectedBenchmark(targetBenchmark);
    }
    initialBenchmarkHandledRef.current = true;
  }, [setSelectedBenchmark]);

  const pendingIndexIdRef = useRef<string | null>(null);

  const navigateTo = useCallback(
    (view: PageView, searchParams: string = "") => {
      setCurrentView(view);
      const basePath = getViewPath(view);
      const targetPath = searchParams ? `${basePath}${searchParams}` : basePath;

      if (view === "stock") {
        const ticker = resolveStockTicker(basePath, searchParams);
        setActiveStockTicker(ticker || null);
      }

      if (view === "dashboard" && searchParams) {
        const params = parseDashboardParams(searchParams);
        if (isValidTimeframe(params.timeframe)) {
          setTimeframe(params.timeframe);
        }
        if (isBenchmarkSymbol(params.benchmark)) {
          setSelectedBenchmark(params.benchmark);
        }
        if (params.indexId) {
          const match = indices?.find((idx) => idx.id === params.indexId);
          if (match) {
            selectIndex(match);
            pendingIndexIdRef.current = null;
          } else {
            pendingIndexIdRef.current = params.indexId;
          }
        } else {
          // An explicit navigation without ?index= abandons any unresolved deep
          // link; otherwise a stale id would keep the URL frozen forever.
          pendingIndexIdRef.current = null;
        }
      }

      const currentPathWithSearch =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "";
      if (typeof window !== "undefined" && currentPathWithSearch !== targetPath) {
        window.history.pushState({}, "", targetPath);
      }
      if (typeof window !== "undefined") {
        try {
          window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
        } catch {
          window.scrollTo(0, 0);
        }
      }
    },
    [indices, selectIndex, setSelectedBenchmark],
  );

  // Apply a pending `?index=` id as soon as the authoritative list contains it.
  // Waiting for `!loadingIndices` keeps a provisional (built-in) list from
  // resolving — and then clearing — a link to a custom index.
  useEffect(() => {
    if (loadingIndices) return;
    if (!pendingIndexIdRef.current || !indices || indices.length === 0) return;
    const match = indices.find((idx) => idx.id === pendingIndexIdRef.current);
    if (match) {
      selectIndex(match);
      pendingIndexIdRef.current = null;
    }
  }, [indices, loadingIndices, selectIndex]);

  const {
    customSeries,
    stockDetails,
    loading: loadingCalc,
    syncing,
    syncProgress,
    syncWarnings,
    error: calcError,
    recalculate,
    lastUpdatedAt: calculationUpdatedAt,
  } = useCalculation(selectedIndex, currentView === "dashboard");

  // The benchmark hook clears state during a symbol switch, but also guard at
  // the render boundary so an unexpected/stale response cannot be relabeled as
  // the currently selected benchmark.
  const activeBenchmarkData = isBenchmarkDataForSymbol(benchmarkData, selectedBenchmark)
    ? benchmarkData
    : null;
  const canEditSelectedIndex = Boolean(
    selectedIndex && (isAdmin || isOwner(selectedIndex.id)),
  );

  const initialIndexHandledRef = useRef(false);
  useEffect(() => {
    if (initialIndexHandledRef.current) return;
    const targetIndexId = initialDashboardParamsRef.current.indexId;
    if (!targetIndexId) {
      initialIndexHandledRef.current = true;
      return;
    }
    // Never resolve a `?index=` deep link against a provisional list. While
    // `loadingIndices` is true `indices` still holds the built-in defaults
    // (`DEFAULT_INDICES`), so matching against them either selects the wrong
    // index or reports "not found" and lets the URL sync erase the id the user
    // was linked to.
    if (loadingIndices || !indices || indices.length === 0) return;
    const match = indices.find((idx) => idx.id === targetIndexId);
    if (match) {
      selectIndex(match);
      pendingIndexIdRef.current = null;
    } else {
      // The list is authoritative and does not contain the id yet (the index
      // may be created later, or the list may still be replaced by a newer
      // response). Keep it pending and let the effect above apply it.
      pendingIndexIdRef.current = targetIndexId;
    }
    initialIndexHandledRef.current = true;
  }, [indices, loadingIndices, selectIndex]);

  // Keep URL query parameters synchronized with dashboard state
  useEffect(() => {
    if (currentView !== "dashboard" || typeof window === "undefined") return;
    // A deep link that has not been resolved yet must stay in the URL: syncing
    // now would replace `?index=<unknown id>` with whatever fallback index is
    // selected and destroy the link the user arrived with.
    if (!initialIndexHandledRef.current || pendingIndexIdRef.current) return;
    const targetQuery = buildDashboardQuery(window.location.search, {
      indexId: selectedIndex?.id ?? null,
      benchmark: selectedBenchmark,
      timeframe,
    });
    const currentUrl = window.location.pathname + window.location.search;
    const targetUrl = window.location.pathname + targetQuery;
    if (currentUrl !== targetUrl) {
      window.history.replaceState(window.history.state, "", targetUrl);
    }
  }, [currentView, selectedIndex?.id, selectedBenchmark, timeframe]);

  // Sync state when user navigates using browser back / forward buttons
  useEffect(() => {
    const onPopState = () => {
      const newView = parseViewFromLocation(window.location.pathname, window.location.search);
      setCurrentView(newView);
      if (newView === "stock") {
        // Back/forward between detail page and hub must follow the URL
        const ticker = resolveStockTicker(
          window.location.pathname,
          window.location.search,
        );
        setActiveStockTicker(ticker || null);
      }
      if (newView === "dashboard") {
        const params = parseDashboardParams(window.location.search);
        if (isValidTimeframe(params.timeframe)) {
          setTimeframe(params.timeframe);
        }
        if (isBenchmarkSymbol(params.benchmark)) {
          setSelectedBenchmark(params.benchmark);
        }
        if (params.indexId) {
          const match = indices?.find((idx) => idx.id === params.indexId);
          if (match) {
            selectIndex(match);
          } else {
            pendingIndexIdRef.current = params.indexId;
          }
        }
      }
      try {
        window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      } catch {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [indices, selectIndex, setSelectedBenchmark]);

  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);

  const handleSelectIndex = useCallback(
    (index: CustomIndex) => {
      // An explicit pick supersedes any unresolved `?index=` deep link.
      pendingIndexIdRef.current = null;
      setSelectedTheme(null);
      selectIndex(index);
      if (isMobileLayout) setIsSidebarOpen(false);
    },
    [isMobileLayout, selectIndex],
  );

  const handleOpenBuilder = useCallback(() => {
    setIsSidebarOpen(false);
    setIsBuilderOpen(true);
  }, []);

  const handlePreviewInDashboard = useCallback(
    (tempIndex: CustomIndex) => {
      setSelectedTheme(null);
      selectIndex(tempIndex);
      setIsBuilderOpen(false);
      navigateTo("dashboard");
    },
    [selectIndex, navigateTo],
  );

  // Shared "add this stock to my index" action for the detail page and the
  // global search. The result is reported here rather than by the callers,
  // because the fallback path (no editable index -> open the builder) is not
  // a successful add and must not claim it was.
  const handleAddStockToIndex = useCallback(
    (ticker: string, name: string, theme: string) => {
      if (!isAuthenticated) {
        setIsAuthModalOpen(true);
        return;
      }
      if (selectedIndex && canEditSelectedIndex) {
        // 挿入は非同期で失敗し得る(レート制限・クォータ・サーバ障害など)。
        // 結果を確認せずに成功トーストを出すと、実際は指数に入っていない銘柄を
        // 追加済みと誤認させるため、Worker の応答を待って報告する。
        reportAddStockResult(
          addStockToIndex(selectedIndex.id, { ticker, name, theme, weight: 10 }),
          name,
          { success: toastSuccess, error: toastError },
        );
      } else {
        handleOpenBuilder();
        toastInfo("編集可能な指数が無いため指数ビルダーを開きました");
      }
    },
    [
      isAuthenticated,
      setIsAuthModalOpen,
      selectedIndex,
      canEditSelectedIndex,
      addStockToIndex,
      handleOpenBuilder,
      toastSuccess,
      toastInfo,
      toastError,
    ],
  );

  const handleAddToWatchlist = useCallback(
    (ticker: string) => {
      if (addWatchlistTicker(ticker)) {
        toastSuccess(`「${ticker}」をウォッチリストに登録しました`);
      } else {
        toastInfo(`「${ticker}」は既にウォッチリストに登録済みです`);
      }
    },
    [toastSuccess, toastInfo],
  );

  const handleAddToPortfolio = useCallback(
    (ticker: string, currentPrice: number, stockName?: string) => {
      if (!isAuthenticated) {
        toastInfo("ポートフォリオ登録にはログインが必要です");
        navigateTo("portfolio");
        return;
      }
      const displayName =
        stockName ||
        POPULAR_STOCKS.find((s) => s.ticker.toUpperCase() === ticker.toUpperCase())?.name ||
        ticker;
      const safePrice =
        Number.isFinite(currentPrice) && currentPrice > 0
          ? currentPrice
          : null;
      if (safePrice === null) {
        // A fabricated cost basis silently corrupts portfolio P/L, so refuse
        // the add instead of guessing a price.
        toastError(
          `「${displayName}」の現在価格を取得できないため、ポートフォリオに追加できませんでした`,
        );
        return;
      }
      const ok = addPortfolioPosition({
        ticker,
        name: displayName,
        shares: 100,
        averageCost: safePrice,
        acquiredAt: todayJstDateString(),
      });
      if (ok) {
        toastSuccess(`「${displayName}」をポートフォリオに追加しました`);
        navigateTo("portfolio");
      } else {
        toastInfo(`「${displayName}」のポートフォリオ登録に失敗しました`);
      }
    },
    [isAuthenticated, navigateTo, toastInfo, toastSuccess, toastError],
  );


  const handleRetry = useCallback(() => {
    if (benchmarkError) refetchBenchmark();
    if (calcError || !customSeries.length) recalculate(true);
  }, [benchmarkError, calcError, customSeries.length, refetchBenchmark, recalculate]);

  const unifiedError = calcError || benchmarkError;

  const currentBenchmarkOption = useMemo(() => {
    return (
      availableBenchmarks.find((b) => b.symbol === selectedBenchmark) || availableBenchmarks[0]
    );
  }, [availableBenchmarks, selectedBenchmark]);

  const chartData = useMemo(() => {
    if (
      !activeBenchmarkData ||
      activeBenchmarkData.series.length === 0 ||
      customSeries.length === 0 ||
      !selectedIndex
    ) {
      return [];
    }
    return buildChartData(activeBenchmarkData.series, customSeries, selectedIndex.baseValue);
  }, [activeBenchmarkData, customSeries, selectedIndex]);

  const periodData = useMemo(() => filterByTimeframe(chartData, timeframe), [chartData, timeframe]);

  const periodMetrics = useMemo(() => {
    if (periodData.length < 2) {
      return {
        customReturnPct: undefined,
        benchmarkReturnPct: undefined,
        alphaPct: undefined,
      };
    }

    const first = periodData[0];
    const last = periodData[periodData.length - 1];
    const customReturnPct =
      first.value > 0 ? ((last.value - first.value) / first.value) * 100 : undefined;
    const benchmarkReturnPct =
      first.nikkei > 0 ? ((last.nikkei - first.nikkei) / first.nikkei) * 100 : undefined;

    return {
      customReturnPct,
      benchmarkReturnPct,
      alphaPct:
        customReturnPct !== undefined && benchmarkReturnPct !== undefined
          ? customReturnPct - benchmarkReturnPct
          : undefined,
    };
  }, [periodData]);

  const latestBenchmarkNormalized = useMemo(() => {
    if (chartData.length === 0) return undefined;
    return chartData[chartData.length - 1]?.nikkei;
  }, [chartData]);

  // Shared page layout props for Header (navigation lives in the Sidebar now)
  const pageLayoutHeaderProps = useMemo<HeaderProps>(
    () => ({
      onOpenSearch: openSearchModal,
      onSearchHover: preloadGlobalSearchModal,
      benchmarkUpdatedAt,
      calculationUpdatedAt,
      loading: loadingBenchmark || loadingCalc,
      syncing,
      hasSyncWarning: syncWarnings.length > 0,
      typeLabel: "日足終値",
      isAuthModalOpen,
      onOpenAuthModal: () => setIsAuthModalOpen(true),
      onCloseAuthModal: () => setIsAuthModalOpen(false),
    }),
    [
      openSearchModal,
      benchmarkUpdatedAt,
      calculationUpdatedAt,
      loadingBenchmark,
      loadingCalc,
      syncing,
      syncWarnings.length,
      isAuthModalOpen,
    ],
  );

  const commonSearchModal = isSearchModalOpen ? (
    // The palette is a separate chunk. A null fallback made ⌘K look broken on
    // a cold cache, so the shell below renders immediately and the pending
    // open survives until the chunk has loaded.
    <Suspense fallback={<SearchModalLoadingShell onClose={() => setIsSearchModalOpen(false)} />}>
      <GlobalSearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        onNavigate={navigateTo}
        availableIndices={indices}
        onAddToIndex={handleAddStockToIndex}
        onAddToWatchlist={handleAddToWatchlist}
      />
    </Suspense>
  ) : null;

  if (currentView === "tutorial") {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <TutorialPage
          onComplete={() => navigateTo("dashboard")}
          onSkip={() => navigateTo("dashboard")}
        />
      </Suspense>
    );
  }

  // Market Intelligence Overview
  if (currentView === "market") {
    return (
      <PageLayout
        headerProps={{ ...pageLayoutHeaderProps, stale: false, typeLabel: "市況サマリー" }}
        currentView={currentView}
        navigateTo={navigateTo}
        searchModal={commonSearchModal}
      >
        <Suspense fallback={<LoadingScreen />}>
          <MarketOverviewPage
            onNavigate={navigateTo}
            onOpenStockDetail={(t) => {
              setActiveStockTicker(t);
              navigateTo("stock", `?ticker=${t}`);
            }}
          />
        </Suspense>
      </PageLayout>
    );
  }

  // Stock Analysis Hub & Detail
  if (currentView === "stock") {
    return (
      <PageLayout
        headerProps={{ ...pageLayoutHeaderProps, stale: false, typeLabel: "銘柄分析" }}
        currentView={currentView}
        navigateTo={navigateTo}
        searchModal={commonSearchModal}
      >
        <Suspense fallback={<LoadingScreen />}>
          {activeStockTicker ? (
            <StockDetailPage
              ticker={activeStockTicker}
              onNavigate={navigateTo}
              onAddToIndex={handleAddStockToIndex}
              onAddToWatchlist={handleAddToWatchlist}
              onAddToPortfolio={handleAddToPortfolio}
            />
          ) : (
            <StockAnalysisPage
              onNavigate={navigateTo}
              onOpenStockDetail={(t) => {
                setActiveStockTicker(t);
                navigateTo("stock", `?ticker=${t}`);
              }}
              onAddToIndex={handleAddStockToIndex}
              onAddToWatchlist={handleAddToWatchlist}
              onAddToPortfolio={handleAddToPortfolio}
            />
          )}
        </Suspense>
      </PageLayout>
    );
  }

  // Real Portfolio Tracking & Index Conversion
  if (currentView === "portfolio") {
    return (
      <PageLayout
        headerProps={{ ...pageLayoutHeaderProps, stale: false, typeLabel: "ポートフォリオ" }}
        currentView={currentView}
        navigateTo={navigateTo}
        searchModal={commonSearchModal}
      >
        <Suspense fallback={<LoadingScreen />}>
          <PortfolioManagerPage
            onNavigate={navigateTo}
            onOpenStockDetail={(t) => {
              setActiveStockTicker(t);
              navigateTo("stock", `?ticker=${t}`);
            }}
            onConvertAndCreateCustomIndex={(basket) => {
              const tempIndex: CustomIndex = {
                id: `portfolio-${Date.now()}`,
                name: "マイ・保有ポートフォリオ指数",
                description: "保有株式の評価額比率から自動生成されたカスタム指数",
                basket,
                baseValue: 1000,
                sortOrder: 1,
              };
              handlePreviewInDashboard(tempIndex);
            }}
          />
        </Suspense>
      </PageLayout>
    );
  }

  // Multi-Factor Screener & Ranking
  if (currentView === "screener") {
    return (
      <PageLayout
        headerProps={{ ...pageLayoutHeaderProps, stale: false, typeLabel: "スクリーナー" }}
        currentView={currentView}
        navigateTo={navigateTo}
        searchModal={commonSearchModal}
      >
        <Suspense fallback={<LoadingScreen />}>
          <ScreenerPage
            onNavigate={navigateTo}
            onOpenStockDetail={(t) => {
              setActiveStockTicker(t);
              navigateTo("stock", `?ticker=${t}`);
            }}
            onBatchCreateCustomIndex={(basket) => {
              const tempIndex: CustomIndex = {
                id: `screener-${Date.now()}`,
                name: "スクリーニング選抜指数",
                description: "スクリーナー条件抽出結果による均等配分指数",
                basket,
                baseValue: 1000,
                sortOrder: 1,
              };
              handlePreviewInDashboard(tempIndex);
            }}
          />
        </Suspense>
      </PageLayout>
    );
  }

  // Financial Calendar
  if (currentView === "calendar") {
    return (
      <PageLayout
        headerProps={{ ...pageLayoutHeaderProps, stale: false, typeLabel: "経済カレンダー" }}
        currentView={currentView}
        navigateTo={navigateTo}
        searchModal={commonSearchModal}
      >
        <Suspense fallback={<LoadingScreen />}>
          <CalendarPage
            onNavigate={navigateTo}
            onOpenStockDetail={(t) => {
              setActiveStockTicker(t);
              navigateTo("stock", `?ticker=${t}`);
            }}
          />
        </Suspense>
      </PageLayout>
    );
  }

  if (currentView === "builder") {
    return (
      <PageLayout
        headerProps={{ ...pageLayoutHeaderProps, stale: false, typeLabel: "指数試算" }}
        currentView={currentView}
        navigateTo={navigateTo}
        searchModal={commonSearchModal}
      >
        <Suspense fallback={<LoadingScreen />}>
          <IndexBuilderPage
            onBackToDashboard={() => navigateTo("dashboard")}
            onSave={saveCustomIndex}
            onPreviewInDashboard={handlePreviewInDashboard}
          />
        </Suspense>
      </PageLayout>
    );
  }

  if (currentView === "disclaimer") {
    return (
      <PageLayout
        headerProps={{ ...pageLayoutHeaderProps, stale: false, typeLabel: "免責事項" }}
        currentView={currentView}
        navigateTo={navigateTo}
        searchModal={commonSearchModal}
      >
        <Suspense fallback={<LoadingScreen />}>
          <DisclaimerPage onNavigate={navigateTo} />
        </Suspense>
      </PageLayout>
    );
  }

  if (currentView === "about") {
    return (
      <PageLayout
        headerProps={{ ...pageLayoutHeaderProps, stale: false, typeLabel: "開発者情報" }}
        currentView={currentView}
        navigateTo={navigateTo}
        searchModal={commonSearchModal}
      >
        <Suspense fallback={<LoadingScreen />}>
          <PortfolioPage onNavigate={navigateTo} />
        </Suspense>
      </PageLayout>
    );
  }

  if (currentView === "admin") {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <AdminDashboard
          indices={indices}
          onBackToApp={() => navigateTo("dashboard")}
          onRefreshIndices={refreshIndices}
          saveCustomIndex={saveCustomIndex}
          deleteCustomIndex={deleteCustomIndex}
        />
      </Suspense>
    );
  }

  // Props shared by every dashboard render path. The dashboard no longer
  // returns a full-screen loading placeholder: the shell below (sidebar,
  // header, ticker tape, footer) always renders and only the index-dependent
  // region is swapped while /api/indices is in flight.
  const dashboardLayoutProps: React.ComponentProps<typeof PageLayout> = {
    headerProps: {
      ...pageLayoutHeaderProps,
      stale: activeBenchmarkData?.stale === true,
      typeLabel: "日足終値",
    },
    currentView,
    navigateTo,
    searchModal: commonSearchModal,
    children: null,
  };

  if (indicesError && indices.length === 0) {
    return (
      <PageLayout {...dashboardLayoutProps}>
        <IndexRegionError message={indicesError} onRetry={() => void refreshIndices()} />
      </PageLayout>
    );
  }

  if (loadingIndices) {
    return (
      <PageLayout {...dashboardLayoutProps}>
        <IndexRegionSkeleton />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      {...dashboardLayoutProps}
      overlays={
        <IndexBuilderModal
          isOpen={isBuilderOpen}
          onClose={() => setIsBuilderOpen(false)}
          onSave={saveCustomIndex}
          onPreviewInDashboard={handlePreviewInDashboard}
        />
      }
    >
      <div className="mobile-dashboard-toolbar" role="toolbar" aria-label="ダッシュボード操作">
        <div className="mobile-current-index">
          <span className="mono tiny uppercase muted">CURRENT INDEX</span>
          <strong title={selectedIndex?.name}>
            {selectedIndex?.name || "指数を選択してください"}
          </strong>
        </div>
        <button
          type="button"
          className="btn btn-default mobile-sidebar-toggle"
          ref={sidebarToggleRef}
          onClick={() => setIsSidebarOpen(true)}
          aria-controls="index-sidebar"
          aria-expanded={isMobileLayout && isSidebarOpen}
        >
          <Menu size={16} />
          <span>指数を選択</span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>

      <div
        className={`layout ${!isMobileLayout && !isDesktopSidebarOpen ? "sidebar-collapsed" : ""}`}
      >
        {(() => {
          const drawerBackdrop = (
            <AnimatePresence>
              {isMobileLayout && isSidebarOpen && (
                <motion.button
                  type="button"
                  className="sidebar-backdrop"
                  aria-label="指数メニューを閉じる"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setIsSidebarOpen(false)}
                />
              )}
            </AnimatePresence>
          );

          const sidebarAside = (
            <aside
              id="index-sidebar"
              ref={sidebarRef}
              className={`index-sidebar ${isSidebarOpen ? "is-open" : ""}`}
              aria-label="指数セレクター"
              aria-hidden={isMobileLayout ? !isSidebarOpen : !isDesktopSidebarOpen}
              role={isMobileLayout ? "dialog" : undefined}
              aria-modal={isMobileLayout ? isSidebarOpen : undefined}
              inert={(isMobileLayout ? !isSidebarOpen : !isDesktopSidebarOpen) ? true : undefined}
              tabIndex={isMobileLayout ? -1 : undefined}
            >
              <div className="sidebar-drawer-header">
                <div className="row" style={{ gap: 8 }}>
                  <Menu size={16} style={{ color: "var(--accent-text)" }} />
                  <span className="mono tiny uppercase">指数メニュー</span>
                </div>
                <button
                  type="button"
                  className="sidebar-close-button"
                  onClick={() => setIsSidebarOpen(false)}
                  aria-label="指数メニューを閉じる"
                >
                  <X size={18} />
                </button>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key="sidebar"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <IndexSelector
                    indices={indices}
                    selectedIndex={selectedIndex}
                    onSelect={handleSelectIndex}
                    onCreateIndex={handleOpenBuilder}
                    onDeleteIndex={deleteCustomIndex}
                    isOwner={isOwner}
                  />
                </motion.div>
              </AnimatePresence>
            </aside>
          );

          if (isMobileLayout) {
            const mobileContent = (
              <>
                {drawerBackdrop}
                {sidebarAside}
              </>
            );
            return overlayRoot ? createPortal(mobileContent, overlayRoot) : mobileContent;
          }

          return sidebarAside;
        })()}

        <div className="dashboard-main grid" style={{ gap: 20 }}>
          {/* StatsGrid lives inside <main>: as a sibling it was page content
              outside every landmark, which broke landmark navigation. */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <StatsGrid
              benchmarkData={activeBenchmarkData}
              benchmarkLoading={loadingBenchmark}
              selectedIndex={selectedIndex}
              latestCustomValue={
                customSeries[customSeries.length - 1]?.value ?? selectedIndex?.baseValue ?? 0
              }
              loading={loadingCalc}
              benchmarkNormalizedValue={latestBenchmarkNormalized}
              benchmarkLabel={currentBenchmarkOption.shortLabel}
              timeframe={timeframe}
              periodCustomReturnPct={periodMetrics.customReturnPct}
              periodBenchmarkReturnPct={periodMetrics.benchmarkReturnPct}
              periodAlphaPct={periodMetrics.alphaPct}
            />
          </motion.div>

          {/* Benchmark Selector Bar with Sidebar Toggle */}
          <div
            className="benchmark-toolbar row space-between flex-wrap"
            aria-busy={loadingBenchmark}
          >
            <div className="row flex-wrap" style={{ gap: 10, alignItems: "center" }}>
              {!isMobileLayout && (
                <button
                  type="button"
                  className="btn btn-sm btn-default"
                  onClick={toggleDesktopIndexSidebar}
                  title={
                    isDesktopSidebarOpen
                      ? "指数一覧の列を格納する"
                      : "指数一覧の列を開く"
                  }
                  aria-expanded={isDesktopSidebarOpen}
                  aria-controls="index-sidebar"
                  style={{ padding: "6px 10px", fontSize: 11 }}
                >
                  <Menu size={13} />
                  <span>{isDesktopSidebarOpen ? "指数一覧を格納" : "指数一覧を開く"}</span>
                </button>
              )}
              <BenchmarkSelector
                benchmarks={availableBenchmarks}
                selectedBenchmark={selectedBenchmark}
                onSelectBenchmark={setSelectedBenchmark}
                loading={loadingBenchmark}
              />
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={selectedIndex?.id || "chart"}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="grid"
              style={{ gap: 20 }}
            >
              {/* Main Performance Chart (lazy: carries recharts) */}
              <Suspense
                fallback={<LazyWidgetPlaceholder label="パフォーマンスチャートを読み込み中..." minHeight={340} />}
              >
                <PerformanceChart
                  data={chartData}
                  loading={loadingCalc || loadingBenchmark}
                  syncing={syncing}
                  syncProgress={syncProgress}
                  syncWarnings={syncWarnings}
                  baseValue={selectedIndex?.baseValue}
                  benchmarkLabel={currentBenchmarkOption.shortLabel}
                  timeframe={timeframe}
                  isReloadSuppressed={isReloadSuppressed}
                  onTimeframeChange={setTimeframe}
                  error={unifiedError}
                  onRetry={handleRetry}
                  emptyTitle={
                    selectedIndex?.basket.length === 0
                      ? "構成銘柄がありません"
                      : "表示できるデータがありません"
                  }
                  emptyDescription={
                    selectedIndex?.basket.length === 0
                      ? "別の指数を選択するか、独自指数を作成して構成銘柄を追加してください。"
                      : "データがまだ取得できていません。再取得すると最新状態を確認できます。"
                  }
                  emptyActionLabel={
                    selectedIndex?.basket.length === 0 ? "独自指数を作成" : "データを再取得"
                  }
                  onEmptyAction={
                    selectedIndex?.basket.length === 0 ? handleOpenBuilder : handleRetry
                  }
                />
              </Suspense>

              {/* Quantitative Risk Metrics Card */}
              {activeBenchmarkData && (
                <RiskMetricsCard
                  customSeries={customSeries}
                  benchmarkSeries={activeBenchmarkData.series}
                  benchmarkName={currentBenchmarkOption.shortLabel}
                  loading={loadingCalc || loadingBenchmark}
                />
              )}

              {/* Stock Heatmap (TreeMap style, lazy: carries recharts) */}
              {stockDetails.length > 0 && (
                <Suspense
                  fallback={<LazyWidgetPlaceholder label="ヒートマップを読み込み中..." />}
                >
                  <ThemeHeatmap
                    stockDetails={stockDetails}
                    selectedTheme={selectedTheme}
                    onSelectTheme={setSelectedTheme}
                  />
                </Suspense>
              )}

              {/* Theme Breakdown Visualizer */}
              {selectedIndex && selectedIndex.basket.length > 0 && (
                <ThemeBreakdown
                  basket={selectedIndex.basket}
                  selectedTheme={selectedTheme}
                  onSelectTheme={setSelectedTheme}
                />
              )}

              {/* Constituents Full Table with Sparklines & Contribution */}
              {selectedIndex && selectedIndex.basket.length > 0 && (
                <ConstituentsTable
                  basket={selectedIndex.basket}
                  stockDetails={stockDetails}
                  selectedTheme={selectedTheme}
                  indexName={selectedIndex.name}
                  canEdit={canEditSelectedIndex}
                  onAddStock={async (stock) => {
                    if (!selectedIndex) return { ok: false, error: "指数が選択されていません" };
                    return addStockToIndex(selectedIndex.id, stock);
                  }}
                  onRemoveStock={async (ticker) => {
                    if (!selectedIndex) return { ok: false, error: "指数が選択されていません" };
                    return removeStockFromIndex(selectedIndex.id, ticker);
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </PageLayout>
  );
}

export default function App(props: { isReloadSuppressed?: boolean } = {}) {
  return (
    <FreshnessProvider>
      <AppContent {...props} />
    </FreshnessProvider>
  );
}


