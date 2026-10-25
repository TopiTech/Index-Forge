import { isValidTicker } from "./apiContract";
import { normalizeTicker as normalizeTickerBase } from "./yahooSymbol";

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
  | "tutorial"
  | "about";

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
    pathname === "/about" ||
    pathname === "/profile" ||
    pageParam === "about" ||
    pageParam === "profile"
  ) {
    return "about";
  }
  if (pathname === "/portfolio" || pageParam === "portfolio") {
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
 * Update payload for buildDashboardQuery. `null` explicitly removes the
 * parameter from the URL; `undefined` leaves the existing value untouched.
 * The old implementation compared against `null` while the type only allowed
 * `undefined`, so the delete branches were dead code and a stale `index=`
 * could survive an index deselection.
 */
export type DashboardQueryUpdates = {
  indexId?: string | null;
  benchmark?: string | null;
  timeframe?: string | null;
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

// Tickers arrive from the URL (deep links, back/forward), so only accept a
// short, known-safe symbol shape instead of echoing arbitrary path text into
// the detail view. The shape is the shared API contract
// (`src/lib/apiContract.ts`), i.e. the same one the Worker's
// /api/stock/fundamentals validation applies.

function normalizeTicker(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded).trim();
  } catch {
    // Malformed percent-encoding: keep the raw text for the shape check below.
  }
  // Base normalization (trim, full-width to half-width, upper-case) is
  // single-sourced in `./yahooSymbol`; only the URL percent-decoding and the
  // contract shape check stay here, because they are URL-layer concerns.
  const normalized = normalizeTickerBase(decoded);
  if (!isValidTicker(normalized)) return undefined;
  return normalized;
}

/**
 * Resolves the active stock ticker from both supported URL shapes:
 * `/stock?ticker=7203` (in-app navigation) and `/stock/7203` (deep link).
 * The query parameter wins so in-app navigation always reflects the last
 * selection even when the path segment still holds a previous ticker.
 */
export function resolveStockTicker(pathname: string = "", search: string = ""): string | undefined {
  return (
    normalizeTicker(new URLSearchParams(search).get("ticker")) ||
    normalizeTicker(
      pathname.startsWith("/stock/") ? pathname.slice("/stock/".length) : undefined,
    )
  );
}

/**
 * Builds a query string preserving existing non-dashboard params when present.
 */
export function buildDashboardQuery(
  currentSearch: string,
  updates: DashboardQueryUpdates,
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
    case "about":
      return "/about";
    case "dashboard":
    default:
      return "/";
  }
}

