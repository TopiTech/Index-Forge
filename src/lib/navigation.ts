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

/**
 * Returns the URL pathname for the given PageView.
 */
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

