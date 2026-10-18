import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import type { PageView } from "../lib/navigation";

export interface TabFreshness {
  updatedAt?: number | string | null;
  loading?: boolean;
  syncing?: boolean;
  stale?: boolean;
  hasSyncWarning?: boolean;
  typeLabel?: string;
  customStatusText?: string;
  benchmarkUpdatedAt?: number | null;
  calculationUpdatedAt?: number | null;
}

export const VIEW_DEFAULT_TYPE_LABELS: Record<PageView, string> = {
  dashboard: "日足終値",
  market: "市況サマリー",
  stock: "銘柄分析",
  calendar: "経済カレンダー",
  screener: "スクリーナー",
  portfolio: "ポートフォリオ",
  builder: "指数試算",
  about: "開発者情報",
  tutorial: "チュートリアル",
  disclaimer: "免責事項",
  admin: "管理コンソール",
};

interface FreshnessContextValue {
  registerFreshness: (view: PageView, freshness: TabFreshness) => void;
  getFreshness: (view: PageView) => TabFreshness | undefined;
  globalLatestUpdatedAt: number | null;
  freshnessMap: Partial<Record<PageView, TabFreshness>>;
}

const FreshnessContext = createContext<FreshnessContextValue | null>(null);

export function FreshnessProvider({ children }: { children: React.ReactNode }) {
  const [freshnessMap, setFreshnessMap] = useState<Partial<Record<PageView, TabFreshness>>>({});
  const [globalLatestUpdatedAt, setGlobalLatestUpdatedAt] = useState<number | null>(() => Date.now());

  const registerFreshness = useCallback((view: PageView, freshness: TabFreshness) => {
    setFreshnessMap((prev) => {
      const existing = prev[view];
      if (
        existing &&
        existing.updatedAt === freshness.updatedAt &&
        existing.loading === freshness.loading &&
        existing.syncing === freshness.syncing &&
        existing.stale === freshness.stale &&
        existing.hasSyncWarning === freshness.hasSyncWarning &&
        existing.typeLabel === freshness.typeLabel &&
        existing.customStatusText === freshness.customStatusText &&
        existing.benchmarkUpdatedAt === freshness.benchmarkUpdatedAt &&
        existing.calculationUpdatedAt === freshness.calculationUpdatedAt
      ) {
        return prev;
      }
      return {
        ...prev,
        [view]: {
          ...existing,
          ...freshness,
          typeLabel: freshness.typeLabel || VIEW_DEFAULT_TYPE_LABELS[view] || "市場データ",
        },
      };
    });

    // Update global latest timestamp if fresh valid timestamp is provided
    const rawTime = freshness.updatedAt;
    const parsed =
      typeof rawTime === "string"
        ? Date.parse(rawTime)
        : typeof rawTime === "number" && Number.isFinite(rawTime) && rawTime > 0
          ? rawTime
          : null;

    if (parsed && Number.isFinite(parsed) && parsed > 0) {
      setGlobalLatestUpdatedAt((current) => (current ? Math.max(current, parsed) : parsed));
    }
  }, []);

  const getFreshness = useCallback(
    (view: PageView) => freshnessMap[view],
    [freshnessMap],
  );

  const value = useMemo<FreshnessContextValue>(
    () => ({
      registerFreshness,
      getFreshness,
      globalLatestUpdatedAt,
      freshnessMap,
    }),
    [registerFreshness, getFreshness, globalLatestUpdatedAt, freshnessMap],
  );

  return <FreshnessContext.Provider value={value}>{children}</FreshnessContext.Provider>;
}

export function useFreshnessContext(): FreshnessContextValue {
  const context = useContext(FreshnessContext);
  if (!context) {
    // Graceful fallback for components rendered outside FreshnessProvider (e.g. in standalone tests)
    return {
      registerFreshness: () => {},
      getFreshness: () => undefined,
      globalLatestUpdatedAt: null,
      freshnessMap: {},
    };
  }
  return context;
}

/**
 * Register and keep up-to-date data freshness for a specific page/tab view.
 */
export function useRegisterFreshness(view: PageView, freshness: TabFreshness) {
  const { registerFreshness } = useFreshnessContext();

  const updatedAt = freshness.updatedAt;
  const loading = freshness.loading;
  const syncing = freshness.syncing;
  const stale = freshness.stale;
  const hasSyncWarning = freshness.hasSyncWarning;
  const typeLabel = freshness.typeLabel;
  const customStatusText = freshness.customStatusText;
  const benchmarkUpdatedAt = freshness.benchmarkUpdatedAt;
  const calculationUpdatedAt = freshness.calculationUpdatedAt;

  useEffect(() => {
    registerFreshness(view, {
      updatedAt,
      loading,
      syncing,
      stale,
      hasSyncWarning,
      typeLabel: typeLabel || VIEW_DEFAULT_TYPE_LABELS[view] || "市場データ",
      customStatusText,
      benchmarkUpdatedAt,
      calculationUpdatedAt,
    });
  }, [
    registerFreshness,
    view,
    updatedAt,
    loading,
    syncing,
    stale,
    hasSyncWarning,
    typeLabel,
    customStatusText,
    benchmarkUpdatedAt,
    calculationUpdatedAt,
  ]);
}

/**
 * Resolve the active freshness state for the currently visible view,
 * merging with explicit props (e.g. benchmark/calculation from App.tsx).
 */
export function useActiveFreshness(
  currentView: PageView,
  explicitProps?: Partial<TabFreshness>,
): TabFreshness {
  const { getFreshness, globalLatestUpdatedAt } = useFreshnessContext();
  const registered = getFreshness(currentView);

  return useMemo(() => {
    const defaultType = VIEW_DEFAULT_TYPE_LABELS[currentView] || "市場データ";
    const isDashboard = currentView === "dashboard";

    const typeLabel = isDashboard
      ? (explicitProps?.typeLabel || "日足終値")
      : (registered?.typeLabel || explicitProps?.typeLabel || defaultType);

    // Loading / syncing state
    const loading = isDashboard
      ? (explicitProps?.loading ?? registered?.loading ?? false)
      : (registered?.loading ?? explicitProps?.loading ?? false);

    const syncing = isDashboard
      ? (explicitProps?.syncing ?? registered?.syncing ?? false)
      : (registered?.syncing ?? explicitProps?.syncing ?? false);

    const stale = isDashboard
      ? (explicitProps?.stale ?? registered?.stale ?? false)
      : (registered?.stale ?? explicitProps?.stale ?? false);

    const hasSyncWarning = isDashboard
      ? (explicitProps?.hasSyncWarning ?? registered?.hasSyncWarning ?? false)
      : (registered?.hasSyncWarning ?? explicitProps?.hasSyncWarning ?? false);

    const customStatusText = registered?.customStatusText || explicitProps?.customStatusText;

    // Timestamps
    const benchmarkUpdatedAt = isDashboard
      ? (explicitProps?.benchmarkUpdatedAt ?? registered?.benchmarkUpdatedAt)
      : undefined;
    const calculationUpdatedAt = isDashboard
      ? (explicitProps?.calculationUpdatedAt ?? registered?.calculationUpdatedAt)
      : undefined;

    const explicitUpdatedAt = registered?.updatedAt ?? (isDashboard ? undefined : explicitProps?.updatedAt);

    // If explicit timestamps are absent, fall back to global latest timestamp rather than leaving it empty
    const resolvedUpdatedAt =
      explicitUpdatedAt ||
      benchmarkUpdatedAt ||
      calculationUpdatedAt ||
      globalLatestUpdatedAt ||
      null;

    return {
      updatedAt: resolvedUpdatedAt,
      benchmarkUpdatedAt,
      calculationUpdatedAt,
      loading,
      syncing,
      stale,
      hasSyncWarning,
      typeLabel,
      customStatusText,
    };
  }, [currentView, explicitProps, registered, globalLatestUpdatedAt]);
}
