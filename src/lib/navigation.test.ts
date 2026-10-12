import { describe, it, expect } from "vitest";
import {
  parseViewFromLocation,
  getViewPath,
  parseDashboardParams,
  buildDashboardQuery,
  resolveStockTicker,
} from "./navigation";

describe("Navigation & View Routing Logic", () => {
  describe("parseViewFromLocation", () => {
    it("defaults to dashboard for root path", () => {
      expect(parseViewFromLocation("/")).toBe("dashboard");
      expect(parseViewFromLocation("")).toBe("dashboard");
    });

    it("parses admin path and search parameter", () => {
      expect(parseViewFromLocation("/admin")).toBe("admin");
      expect(parseViewFromLocation("/", "?page=admin")).toBe("admin");
      expect(parseViewFromLocation("/index.html", "?page=admin")).toBe("admin");
    });

    it("parses portfolio paths and search parameter", () => {
      expect(parseViewFromLocation("/portfolio")).toBe("portfolio");
      expect(parseViewFromLocation("/", "?page=portfolio")).toBe("portfolio");
    });

    it("parses developer profile (about) paths and search parameters", () => {
      expect(parseViewFromLocation("/about")).toBe("about");
      expect(parseViewFromLocation("/profile")).toBe("about");
      expect(parseViewFromLocation("/", "?page=about")).toBe("about");
      expect(parseViewFromLocation("/", "?page=profile")).toBe("about");
    });

    it("parses disclaimer path and search parameter", () => {
      expect(parseViewFromLocation("/disclaimer")).toBe("disclaimer");
      expect(parseViewFromLocation("/", "?page=disclaimer")).toBe("disclaimer");
    });

    it("parses builder path and search parameter", () => {
      expect(parseViewFromLocation("/builder")).toBe("builder");
      expect(parseViewFromLocation("/simulator")).toBe("builder");
      expect(parseViewFromLocation("/", "?page=builder")).toBe("builder");
      expect(parseViewFromLocation("/", "?page=simulator")).toBe("builder");
    });

    it("parses tutorial path and search parameter", () => {
      expect(parseViewFromLocation("/tutorial")).toBe("tutorial");
      expect(parseViewFromLocation("/", "?page=tutorial")).toBe("tutorial");
    });

    it("parses market, stock, screener, calendar paths and search params", () => {
      expect(parseViewFromLocation("/market")).toBe("market");
      expect(parseViewFromLocation("/", "?page=market")).toBe("market");
      expect(parseViewFromLocation("/stock")).toBe("stock");
      expect(parseViewFromLocation("/stock/7203")).toBe("stock");
      expect(parseViewFromLocation("/", "?page=stock&ticker=7203")).toBe("stock");
      expect(parseViewFromLocation("/screener")).toBe("screener");
      expect(parseViewFromLocation("/", "?page=screener")).toBe("screener");
      expect(parseViewFromLocation("/calendar")).toBe("calendar");
      expect(parseViewFromLocation("/", "?page=calendar")).toBe("calendar");
    });

    it("falls back to dashboard for unknown paths", () => {
      expect(parseViewFromLocation("/unknown-page")).toBe("dashboard");
      expect(parseViewFromLocation("/", "?page=other")).toBe("dashboard");
    });
  });

  describe("resolveStockTicker", () => {
    it("reads the in-app query shape", () => {
      expect(resolveStockTicker("/stock", "?ticker=NVDA")).toBe("NVDA");
      expect(resolveStockTicker("/stock", "?page=stock&ticker=7203")).toBe("7203");
    });

    it("reads the deep-link path shape", () => {
      expect(resolveStockTicker("/stock/7203", "")).toBe("7203");
      expect(resolveStockTicker("/stock/BTC-USD", "")).toBe("BTC-USD");
      expect(resolveStockTicker("/stock/^GSPC", "")).toBe("^GSPC");
    });

    it("prefers the query ticker over a stale path segment", () => {
      expect(resolveStockTicker("/stock/7203", "?ticker=NVDA")).toBe("NVDA");
    });

    it("rejects missing or malformed tickers from the URL", () => {
      expect(resolveStockTicker("/stock", "")).toBeUndefined();
      expect(resolveStockTicker("/stock/", "")).toBeUndefined();
      expect(resolveStockTicker("/stock/%3Cscript%3E", "")).toBeUndefined();
      expect(resolveStockTicker(`/stock/${"A".repeat(40)}`, "")).toBeUndefined();
      expect(resolveStockTicker("/other", "?ticker=")).toBeUndefined();
      expect(resolveStockTicker("/other", "")).toBeUndefined();
    });

    it("ignores path segments that are not a stock route", () => {
      expect(resolveStockTicker("/market", "")).toBeUndefined();
      expect(resolveStockTicker("/stocks/7203", "")).toBeUndefined();
    });
  });

  describe("getViewPath", () => {
    it("returns correct paths for all views", () => {
      expect(getViewPath("dashboard")).toBe("/");
      expect(getViewPath("market")).toBe("/market");
      expect(getViewPath("stock")).toBe("/stock");
      expect(getViewPath("portfolio")).toBe("/portfolio");
      expect(getViewPath("screener")).toBe("/screener");
      expect(getViewPath("calendar")).toBe("/calendar");
      expect(getViewPath("admin")).toBe("/admin");
      expect(getViewPath("disclaimer")).toBe("/disclaimer");
      expect(getViewPath("builder")).toBe("/builder");
      expect(getViewPath("tutorial")).toBe("/tutorial");
      expect(getViewPath("about")).toBe("/about");
    });
  });

  describe("parseDashboardParams & buildDashboardQuery", () => {
    it("parses dashboard parameters correctly", () => {
      const parsed = parseDashboardParams("?index=nikkei225&bm=topix&tf=1Y");
      expect(parsed).toEqual({
        indexId: "nikkei225",
        benchmark: "topix",
        timeframe: "1Y",
      });
    });

    it("handles missing parameters", () => {
      const parsed = parseDashboardParams("");
      expect(parsed).toEqual({
        indexId: undefined,
        benchmark: undefined,
        timeframe: undefined,
      });
    });

    it("builds query updates while preserving existing params", () => {
      const query = buildDashboardQuery("?page=dashboard&other=123", {
        indexId: "custom-1",
        timeframe: "5Y",
      });
      expect(query).toContain("index=custom-1");
      expect(query).toContain("tf=5Y");
      expect(query).toContain("page=dashboard");
      expect(query).toContain("other=123");
    });
  });
});

