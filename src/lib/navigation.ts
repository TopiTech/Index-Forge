export type PageView = "dashboard" | "admin" | "portfolio" | "disclaimer" | "builder";

/**
 * Parses pathname and search parameters to determine the current view.
 */
export function parseViewFromLocation(pathname: string, search: string = ""): PageView {
  const params = new URLSearchParams(search);
  const pageParam = params.get("page");

  if (pathname === "/admin" || pageParam === "admin") return "admin";
  if (
    pathname === "/portfolio" ||
    pathname === "/profile" ||
    pathname === "/about" ||
    pageParam === "portfolio" ||
    pageParam === "profile"
  ) {
    return "portfolio";
  }
  if (pathname === "/disclaimer" || pageParam === "disclaimer") return "disclaimer";
  if (
    pathname === "/builder" ||
    pathname === "/simulator" ||
    pageParam === "builder" ||
    pageParam === "simulator"
  ) {
    return "builder";
  }
  return "dashboard";
}

export type DashboardQueryParams = {
  indexId?: string;
  benchmark?: string;
  timeframe?: string;
};

/**
 * Parses dashboard-specific query parameters (index ID, benchmark symbol, timeframe).
 */
export function parseDashboardParams(search: string = ""): DashboardQueryParams {
  const params = new URLSearchParams(search);
  const indexId = params.get("index") || undefined;
  const benchmark = params.get("bm") || undefined;
  const timeframe = params.get("tf") || undefined;

  return { indexId, benchmark, timeframe };
}

/**
 * Builds a query string preserving existing non-dashboard params when present.
 */
export function buildDashboardQuery(
  currentSearch: string,
  updates: DashboardQueryParams,
): string {
  const params = new URLSearchParams(currentSearch);

  if (updates.indexId) params.set("index", updates.indexId);
  else if (updates.indexId === null) params.delete("index");

  if (updates.benchmark) params.set("bm", updates.benchmark);
  else if (updates.benchmark === null) params.delete("bm");

  if (updates.timeframe) params.set("tf", updates.timeframe);
  else if (updates.timeframe === null) params.delete("tf");

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function getViewPath(view: PageView): string {
  switch (view) {
    case "admin":
      return "/admin";
    case "portfolio":
      return "/portfolio";
    case "disclaimer":
      return "/disclaimer";
    case "builder":
      return "/builder";
    case "dashboard":
    default:
      return "/";
  }
}

