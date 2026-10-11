export type PageView =
  | "dashboard"
  | "market"
  | "stock"
  | "portfolio"
  | "screener"
  | "calendar"
  | "admin"
  | "disclaimer"
  | "builder"
  | "tutorial";

/**
 * Parses pathname and search parameters to determine the current view.
 */
export function parseViewFromLocation(pathname: string, search: string = ""): PageView {
  const params = new URLSearchParams(search);
  const pageParam = params.get("page");

  if (pathname === "/market" || pageParam === "market") return "market";
  if (pathname === "/stock" || pathname.startsWith("/stock/") || pageParam === "stock") return "stock";
  if (pathname === "/screener" || pageParam === "screener") return "screener";
  if (pathname === "/calendar" || pageParam === "calendar") return "calendar";

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
  if (pathname === "/tutorial" || pageParam === "tutorial") return "tutorial";
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

export type StockQueryParams = {
  ticker?: string;
};

/**
 * Parses stock detail query parameters.
 */
export function parseStockParams(search: string = ""): StockQueryParams {
  const params = new URLSearchParams(search);
  const ticker = params.get("ticker") || undefined;
  return { ticker };
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
    case "market":
      return "/market";
    case "stock":
      return "/stock";
    case "screener":
      return "/screener";
    case "calendar":
      return "/calendar";
    case "admin":
      return "/admin";
    case "portfolio":
      return "/portfolio";
    case "disclaimer":
      return "/disclaimer";
    case "builder":
      return "/builder";
    case "tutorial":
      return "/tutorial";
    case "dashboard":
    default:
      return "/";
  }
}

