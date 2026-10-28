// @vitest-environment jsdom
/**
 * Regression suite for the comprehensive code-review fixes.
 *
 * The sidebar `inert` state is asserted against the real `App` component.
 * The previous version of this file re-implemented the `inert` expression
 * inside the test body, so the assertions could never fail when the
 * production markup changed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import {
  clearMemoryCache,
  getMemoryCache,
  setMemoryCache,
  setAllowMemoryCacheInTest,
  OVERVIEW_ASSET_DEFS,
} from "../../worker/internal";
import { BASELINE_ASSET_QUOTES } from "../data/marketConstants";
import { DEFAULT_MARKET_OVERVIEW } from "./marketDataService";
import {
  deserializeIndexFromJson,
  deserializeBasketFromCsv,
  deserializePortfolioFromCsv,
} from "./indexSerialization";
import {
  convertPortfolioToCustomIndexBasket,
  type PortfolioPosition,
} from "./portfolioStorage";
import { toSafeDownloadFileName } from "./downloadFileName";
import App from "../App";
import { ToastProvider } from "../components/Toast";

describe("comprehensiveCodeReviewFinalFixes", () => {
  describe("1. clearMemoryCache multi-map cleanup", () => {
    it("clears matching prefixed keys from both memoryCache and calcMemoryCache", () => {
      setAllowMemoryCacheInTest(true);
      try {
        clearMemoryCache();

        // Setup entries in both cache stores via setMemoryCache
        setMemoryCache("prefix:key1", "val1", 60);
        setMemoryCache("other:key2", "val2", 60);
        setMemoryCache("calc:prefix:calc1", "calc1", 60);
        setMemoryCache("calc:other:calc2", "calc2", 60);

        expect(getMemoryCache("prefix:key1")).toBe("val1");
        expect(getMemoryCache("calc:prefix:calc1")).toBe("calc1");
        expect(getMemoryCache("other:key2")).toBe("val2");
        expect(getMemoryCache("calc:other:calc2")).toBe("calc2");

        // Clear prefix across both maps
        clearMemoryCache("prefix:");

        expect(getMemoryCache("prefix:key1")).toBeNull();
        expect(getMemoryCache("other:key2")).toBe("val2");
        expect(getMemoryCache("calc:prefix:calc1")).toBe("calc1");

        // Clear calc: prefix
        clearMemoryCache("calc:prefix:");
        expect(getMemoryCache("calc:prefix:calc1")).toBeNull();
        expect(getMemoryCache("calc:other:calc2")).toBe("calc2");

        // Full clear without prefix
        clearMemoryCache();
        expect(getMemoryCache("other:key2")).toBeNull();
        expect(getMemoryCache("calc:other:calc2")).toBeNull();
      } finally {
        setAllowMemoryCacheInTest(false);
      }
    });
  });

  describe("2. Baseline asset quotes consistency", () => {
    it("aligns OVERVIEW_ASSET_DEFS in worker with shared BASELINE_ASSET_QUOTES", () => {
      const n225 = OVERVIEW_ASSET_DEFS.find((d) => d.symbol === "^N225");
      expect(n225).toBeDefined();
      expect(n225!.defaultPrice).toBe(39500);
      expect(n225!.defaultPrice).not.toBe(69030.92);

      const sp500 = OVERVIEW_ASSET_DEFS.find((d) => d.symbol === "^GSPC");
      expect(sp500).toBeDefined();
      expect(sp500!.defaultPrice).toBe(5850);
      expect(sp500!.defaultPrice).not.toBe(7811.54);

      expect(OVERVIEW_ASSET_DEFS.length).toBe(BASELINE_ASSET_QUOTES.length);
    });

    it("aligns DEFAULT_MARKET_OVERVIEW in marketDataService with shared BASELINE_ASSET_QUOTES", () => {
      const n225 = DEFAULT_MARKET_OVERVIEW.indices.find((d) => d.symbol === "^N225");
      expect(n225).toBeDefined();
      expect(n225!.price).toBe(39500);
      expect(n225!.price).not.toBe(69030.92);

      const topix = DEFAULT_MARKET_OVERVIEW.indices.find((d) => d.symbol === "^TOPX");
      expect(topix).toBeDefined();
      expect(topix!.price).toBe(2720);

      const gold = DEFAULT_MARKET_OVERVIEW.commodities.find((d) => d.symbol === "GC=F");
      expect(gold).toBeDefined();
      expect(gold!.price).toBe(2750);
      expect(gold!.price).not.toBe(4216.3);

      const usdjpy = DEFAULT_MARKET_OVERVIEW.forex.find((d) => d.symbol === "USDJPY=X");
      expect(usdjpy).toBeDefined();
      expect(usdjpy!.price).toBe(155.0);
    });
  });

  describe("3. UTF-8 BOM tolerance in deserialization", () => {
    it("successfully deserializes JSON with leading UTF-8 BOM", () => {
      const validJson = JSON.stringify({
        name: "BOM Test Index",
        description: "Test description",
        baseValue: 1000,
        basket: [
          { ticker: "7203", name: "トヨタ自動車", theme: "モビリティ", weight: 60 },
          { ticker: "6758", name: "ソニーグループ", theme: "エンタメ", weight: 40 },
        ],
      });

      const bomJson = "\uFEFF" + validJson;
      const result = deserializeIndexFromJson(bomJson);

      expect(result.ok).toBe(true);
      expect(result.data?.name).toBe("BOM Test Index");
      expect(result.data?.basket.length).toBe(2);
    });

    it("successfully deserializes Basket CSV with leading UTF-8 BOM", () => {
      const csvWithBom =
        '\uFEFF"ticker","name","theme","weight"\r\n"7203","トヨタ自動車","自動車","60"\r\n"6758","ソニーグループ","エンタメ","40"';
      const result = deserializeBasketFromCsv(csvWithBom);

      expect(result.ok).toBe(true);
      expect(result.data?.length).toBe(2);
      expect(result.data?.[0].ticker).toBe("7203");
      expect(result.data?.[0].weight).toBe(60);
    });

    it("successfully deserializes Portfolio CSV with leading UTF-8 BOM", () => {
      const csvWithBom =
        '\uFEFF"ticker","name","theme","shares","costPrice","market"\r\n"7203","トヨタ","自動車","100","2500","TSE"\r\n"AAPL","Apple","Tech","10","180","US"';
      const result = deserializePortfolioFromCsv(csvWithBom);

      expect(result.ok).toBe(true);
      expect(result.data?.length).toBe(2);
      expect(result.data?.[0].ticker).toBe("7203");
      expect(result.data?.[1].ticker).toBe("AAPL");
    });
  });

  describe("4. Portfolio to Index conversion ticker normalization", () => {
    it("normalizes case and whitespace to group duplicate positions", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-aapl-1",
          ticker: "aapl",
          name: "Apple Inc.",
          shares: 10,
          averageCost: 150,
          currentPrice: 200,
        },
        {
          id: "pos-aapl-2",
          ticker: "AAPL ",
          name: "Apple Inc.",
          shares: 5,
          averageCost: 160,
          currentPrice: 200,
        },
        {
          id: "pos-7203",
          ticker: " 7203 ",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2500,
          currentPrice: 3000,
        },
      ];

      const basket = convertPortfolioToCustomIndexBasket(positions, 150);

      // Should have 2 unique constituents: AAPL and 7203
      expect(basket.length).toBe(2);
      const tickers = basket.map((b) => b.ticker);
      expect(tickers).toContain("AAPL");
      expect(tickers).toContain("7203");

      // Total weights must equal 100
      const totalWeight = basket.reduce((sum, b) => sum + b.weight, 0);
      expect(totalWeight).toBe(100);
    });
  });

  describe("5. File name sanitization", () => {
    it("sanitizes dangerous or prohibited path characters in file names", () => {
      const unsafe = 'my/cool:index*name?with"chars<and>pipe|';
      const safe = toSafeDownloadFileName(`indexforge-${unsafe}.json`);
      expect(safe).not.toMatch(/[/\\:*?"<>|]/);
      expect(safe).toBe("indexforge-my_cool_index_name_with_chars_and_pipe_.json");
    });
  });

  describe("6. Sidebar inert state condition", () => {
    /**
     * The `inert` attribute of the index sidebar is production markup
     * (`src/App.tsx`), so it is asserted on the rendered component instead of
     * on a copy of the expression:
     *  - mobile layout: the drawer starts closed -> the panel is inert
     *  - desktop layout: the column can be collapsed -> the panel is inert
     *  - desktop layout, column expanded -> the panel stays interactive
     */

    /** jsdom implements neither `ResizeObserver` (recharts needs it) nor `matchMedia`. */
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    let mobileLayout = false;

    function createMediaQueryList(matches: boolean): MediaQueryList {
      return {
        matches,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList;
    }

    beforeEach(() => {
      mobileLayout = false;
      vi.stubGlobal("ResizeObserver", ResizeObserverStub);
      window.matchMedia = vi.fn(() =>
        createMediaQueryList(mobileLayout),
      ) as unknown as typeof window.matchMedia;
      window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
      // Only the index list is needed to render the dashboard shell; every
      // other endpoint fails immediately.
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/api/indices")) {
            // A faithful Response keeps the shared readJsonBody contract.
            return Promise.resolve(
              new Response(JSON.stringify([]), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }
          return Promise.reject(new Error("network disabled in test"));
        }),
      );
      // The first-launch tutorial replaces the app; dismiss it so that the
      // dashboard (and with it the index sidebar) is rendered.
      window.localStorage.setItem("indexforge_tutorial_seen_v1", "true");
      window.history.replaceState({}, "", "/");
    });

    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      window.localStorage.clear();
    });

    async function renderIndexSidebar(): Promise<HTMLElement> {
      render(createElement(ToastProvider, null, createElement(App, {})));
      await vi.waitFor(() => {
        expect(document.getElementById("index-sidebar")).not.toBeNull();
      });
      const sidebar = document.getElementById("index-sidebar");
      expect(sidebar).not.toBeNull();
      return sidebar as HTMLElement;
    }

    it("keeps the index sidebar interactive while the desktop column is expanded", async () => {
      const sidebar = await renderIndexSidebar();

      expect(sidebar.hasAttribute("inert")).toBe(false);
      expect(sidebar.getAttribute("aria-hidden")).toBe("false");
    });

    it("marks the index sidebar inert while the mobile drawer is closed", async () => {
      mobileLayout = true;
      const sidebar = await renderIndexSidebar();

      expect(sidebar.hasAttribute("inert")).toBe(true);
      expect(sidebar.getAttribute("aria-hidden")).toBe("true");
    });

    it("marks the index sidebar inert while the desktop column is collapsed", async () => {
      window.localStorage.setItem("indexforge:index-sidebar:collapsed", "true");
      const sidebar = await renderIndexSidebar();

      expect(sidebar.hasAttribute("inert")).toBe(true);
      expect(sidebar.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
