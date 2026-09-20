import { useState, useCallback, useMemo, useEffect, useRef, Suspense, lazy } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Menu, X } from "lucide-react";
import { useIndices } from "./hooks/useIndices";
import { isBenchmarkDataForSymbol, useBenchmark, AVAILABLE_BENCHMARKS } from "./hooks/useBenchmark";
import { useCalculation } from "./hooks/useCalculation";
import { useAuth } from "./hooks/useAuth";
import { Header } from "./components/Header";
import { TradingViewTickerTape } from "./components/TradingViewTickerTape";
import { StatsGrid } from "./components/StatsGrid";
import { BenchmarkSelector } from "./components/BenchmarkSelector";
import { IndexSelector } from "./components/IndexSelector";
import { PerformanceChart } from "./components/PerformanceChart";
import { ThemeHeatmap } from "./components/ThemeHeatmap";
import { ThemeBreakdown } from "./components/ThemeBreakdown";
import { RiskMetricsCard } from "./components/RiskMetricsCard";
import { ConstituentsTable } from "./components/ConstituentsTable";
import { IndexBuilderModal } from "./components/IndexBuilderModal";
// Route-level pages are lazy-loaded so the initial bundle (dashboard) does
// not pay for three.js (tutorial 3D scene), recharts-heavy admin tooling,
// or rarely-visited static pages. The three-*.js output chunk is then
// fetched only when the tutorial route is opened.
const IndexBuilderPage = lazy(() =>
  import("./components/IndexBuilderPage").then((m) => ({ default: m.IndexBuilderPage })),
);
const AdminDashboard = lazy(() =>
  import("./components/AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
);

import { ErrorFallback } from "./components/ErrorFallback";
import { LoadingScreen } from "./components/LoadingScreen";
import { buildChartData } from "./lib/chartData";
import { filterByTimeframe } from "./lib/timeframe";
import { Footer } from "./components/Footer";
const PortfolioPage = lazy(() =>
  import("./components/PortfolioPage").then((m) => ({ default: m.PortfolioPage })),
);
const DisclaimerPage = lazy(() =>
  import("./components/DisclaimerPage").then((m) => ({ default: m.DisclaimerPage })),
);
const TutorialPage = lazy(() =>
  import("./components/TutorialPage").then((m) => ({ default: m.TutorialPage })),
);
import { shouldShowTutorialOnLaunch } from "./lib/tutorialStorage";
import {
  parseViewFromLocation,
  getViewPath,
  parseDashboardParams,
  buildDashboardQuery,
  type PageView,
} from "./lib/navigation";
import type { Timeframe, BenchmarkSymbol } from "./types";
import type { CustomIndex } from "./data/indices";
import type { ReactNode } from "react";

const VALID_TIMEFRAMES: readonly Timeframe[] = ["1W", "1M", "3M", "6M", "YTD", "1Y"] as const;
function isValidTimeframe(tf: string | undefined): tf is Timeframe {
  return typeof tf === "string" && (VALID_TIMEFRAMES as readonly string[]).includes(tf);
}

function isBenchmarkSymbol(s: string | undefined): s is BenchmarkSymbol {
  return AVAILABLE_BENCHMARKS.some((b) => b.symbol === s);
}

const MOBILE_LAYOUT_QUERY = "(max-width: 1080px)";

/** Shared page layout for all non-admin views (Header + TickerTape + Footer). */
function PageLayout({
  headerProps,
  currentView,
  navigateTo,
  children,
}: {
  headerProps: React.ComponentProps<typeof Header>;
  currentView: PageView;
  navigateTo: (view: PageView) => void;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <Header {...headerProps} />
      <TradingViewTickerTape />
      <main style={{ minHeight: "calc(100vh - 280px)" }}>{children}</main>
      <Footer onNavigate={navigateTo} currentView={currentView} />
    </div>
  );
}

function getInitialMobileLayout() {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

function getInitialView(): PageView {
  if (typeof window === "undefined") return "dashboard";
  if (shouldShowTutorialOnLaunch()) return "tutorial";
  return parseViewFromLocation(window.location.pathname, window.location.search);
}

export default function App({
  isReloadSuppressed = false,
}: {
  isReloadSuppressed?: boolean;
} = {}) {
  const initialDashboardParamsRef = useRef(
    typeof window !== "undefined" ? parseDashboardParams(window.location.search) : {},
  );
  const [isMobileLayout, setIsMobileLayout] = useState(getInitialMobileLayout);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !getInitialMobileLayout());
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const initialTf = initialDashboardParamsRef.current.timeframe;
    return isValidTimeframe(initialTf) ? initialTf : "1M";
  });
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarWasOpenRef = useRef(false);
  const [currentView, setCurrentView] = useState<PageView>(getInitialView);
  const { isAdmin } = useAuth();

  const navigateTo = useCallback((view: PageView) => {
    setCurrentView(view);
    const targetPath = getViewPath(view);

    if (typeof window !== "undefined" && window.location.pathname !== targetPath) {
      window.history.pushState({}, "", targetPath);
    }
    if (typeof window !== "undefined") {
      // "instant" is valid in modern browsers but unknown to older TS DOM
      // libs / engines; fall back to "auto" so the scroll still happens.
      try {
        window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      } catch {
        window.scrollTo(0, 0);
      }
    }
  }, []);


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
        sidebarToggleRef.current?.focus();
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
    if (initialIndexHandledRef.current || !indices || indices.length === 0) return;
    const targetIndexId = initialDashboardParamsRef.current.indexId;
    if (targetIndexId) {
      const match = indices.find((idx) => idx.id === targetIndexId);
      if (match) {
        selectIndex(match);
      }
    }
    initialIndexHandledRef.current = true;
  }, [indices, selectIndex]);

  // Keep URL query parameters synchronized with dashboard state
  useEffect(() => {
    if (currentView !== "dashboard" || typeof window === "undefined") return;
    const targetQuery = buildDashboardQuery(window.location.search, {
      indexId: selectedIndex?.id,
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
      if (newView === "dashboard") {
        const params = parseDashboardParams(window.location.search);
        if (isValidTimeframe(params.timeframe)) {
          setTimeframe(params.timeframe);
        }
        if (isBenchmarkSymbol(params.benchmark)) {
          setSelectedBenchmark(params.benchmark);
        }
        if (params.indexId && indices) {
          const match = indices.find((idx) => idx.id === params.indexId);
          if (match) selectIndex(match);
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

  // Shared page layout props for Header
  const pageLayoutHeaderProps = {
    onNavigateToHome: () => navigateTo("dashboard"),
    onNavigateToAdmin: () => navigateTo("admin"),
    onNavigateToBuilder: () => navigateTo("builder"),
    onNavigateToPortfolio: () => navigateTo("portfolio"),
    onNavigateToDisclaimer: () => navigateTo("disclaimer"),
    onNavigateToTutorial: () => navigateTo("tutorial"),
    currentView,
    benchmarkUpdatedAt,
    calculationUpdatedAt,
    dataLoading: loadingBenchmark || loadingCalc,
    syncing,
    hasSyncWarning: syncWarnings.length > 0,
  };

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

  // Static pages do not depend on the index list. Render them even while the
  // optional dashboard data request is slow or unavailable.
  if (currentView === "builder") {
    return (
      <PageLayout headerProps={{ ...pageLayoutHeaderProps, benchmarkStale: false }} currentView={currentView} navigateTo={navigateTo}>
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

  if (currentView === "portfolio") {
    return (
      <PageLayout headerProps={{ ...pageLayoutHeaderProps, benchmarkStale: false }} currentView={currentView} navigateTo={navigateTo}>
        <Suspense fallback={<LoadingScreen />}>
          <PortfolioPage onNavigate={navigateTo} />
        </Suspense>
      </PageLayout>
    );
  }

  if (currentView === "disclaimer") {
    return (
      <PageLayout headerProps={{ ...pageLayoutHeaderProps, benchmarkStale: false }} currentView={currentView} navigateTo={navigateTo}>
        <Suspense fallback={<LoadingScreen />}>
          <DisclaimerPage onNavigate={navigateTo} />
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

  if (indicesError && indices.length === 0) {
    return <ErrorFallback error={indicesError} onRetry={() => window.location.reload()} />;
  }

  if (loadingIndices) {
    return <LoadingScreen />;
  }

  return (
    <div className="app">
      <Header
        {...pageLayoutHeaderProps}
        benchmarkStale={activeBenchmarkData?.stale === true}
      />

      <TradingViewTickerTape />

      <div className="mobile-dashboard-toolbar" aria-label="ダッシュボード操作">
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

      <div
        className={`layout ${!isMobileLayout && !isDesktopSidebarOpen ? "sidebar-collapsed" : ""}`}
      >
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

        <aside
          id="index-sidebar"
          ref={sidebarRef}
          className={`index-sidebar ${isSidebarOpen ? "is-open" : ""}`}
          aria-label="指数セレクター"
          aria-hidden={isMobileLayout ? !isSidebarOpen : !isDesktopSidebarOpen}
          role={isMobileLayout ? "dialog" : undefined}
          aria-modal={isMobileLayout ? isSidebarOpen : undefined}
          inert={isMobileLayout && !isSidebarOpen ? true : undefined}
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

        <main className="dashboard-main grid" style={{ gap: 20 }}>
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
                  onClick={() => setIsDesktopSidebarOpen((prev) => !prev)}
                  title={isDesktopSidebarOpen ? "サイドバーを折りたたむ" : "サイドバーを展開する"}
                  aria-expanded={isDesktopSidebarOpen}
                  aria-controls="index-sidebar"
                  style={{ padding: "6px 10px", fontSize: 11 }}
                >
                  <Menu size={13} />
                  <span>{isDesktopSidebarOpen ? "サイドバー格納" : "指数一覧を開く"}</span>
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
              {/* Main Performance Chart */}
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
                onEmptyAction={selectedIndex?.basket.length === 0 ? handleOpenBuilder : handleRetry}
              />

              {/* Quantitative Risk Metrics Card */}
              {activeBenchmarkData && (
                <RiskMetricsCard
                  customSeries={customSeries}
                  benchmarkSeries={activeBenchmarkData.series}
                  benchmarkName={currentBenchmarkOption.shortLabel}
                  loading={loadingCalc || loadingBenchmark}
                />
              )}

              {/* Stock Heatmap (TreeMap style) */}
              {stockDetails.length > 0 && (
                <ThemeHeatmap
                  stockDetails={stockDetails}
                  selectedTheme={selectedTheme}
                  onSelectTheme={setSelectedTheme}
                />
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
        </main>
      </div>

      {/* Footer */}
      <Footer onNavigate={navigateTo} currentView={currentView} />

      {/* Index Builder Modal */}
      <IndexBuilderModal
        isOpen={isBuilderOpen}
        onClose={() => setIsBuilderOpen(false)}
        onSave={saveCustomIndex}
        onPreviewInDashboard={handlePreviewInDashboard}
      />
    </div>
  );
}

