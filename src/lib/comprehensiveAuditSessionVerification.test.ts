import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../../worker/index";
import { setAllowMemoryCacheInTest, clearMemoryCache } from "../../worker/internal";
import { generateUpcomingEvents, UPCOMING_EVENTS } from "./marketDataService";
import fs from "fs";
import path from "path";

describe("Comprehensive Audit Session Verification", () => {
  beforeEach(() => {
    setAllowMemoryCacheInTest(true);
    clearMemoryCache();
  });

  afterEach(() => {
    setAllowMemoryCacheInTest(false);
    clearMemoryCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("1. Worker Stock Fundamentals Ticker Validation & News JST Offset", () => {
    it("allows index symbols (^N225, ^TOPX) and currency tickers (USDJPY=X) in /api/stock/fundamentals", async () => {
      const allowedSymbols = ["^N225", "^TOPX", "USDJPY=X", "7203.T", "BRK_B", "AAPL"];
      for (const symbol of allowedSymbols) {
        const req = new Request(
          `https://example.com/api/stock/fundamentals?ticker=${encodeURIComponent(symbol)}`,
        );
        const res = await worker.fetch(req, {} as any);
        // Should not reject with 400 Bad Request (Invalid ticker format)
        expect(res.status).not.toBe(400);
      }
    });

    it("rejects malicious or invalid ticker formats with 400 Bad Request", async () => {
      const invalidSymbols = [
        "<script>",
        "../../etc",
        "AAPL;DROP TABLE",
        "TICKER WITH SPACES",
        "VERY_LONG_TICKER_EXCEEDING_TWENTY_CHARACTERS_123456",
      ];
      for (const symbol of invalidSymbols) {
        const req = new Request(
          `https://example.com/api/stock/fundamentals?ticker=${encodeURIComponent(symbol)}`,
        );
        const res = await worker.fetch(req, {} as any);
        expect(res.status).toBe(400);
        const data = (await res.json()) as any;
        expect(data.error).toBe("ティッカーの形式が正しくありません。");
      }
    });

    it("calculates JST (UTC+9) timestamps for provider market news", async () => {
      // N-1: 合成フォールバックは時刻を持たないため、JST 変換は配信元供給の
      // providerPublishTime から検証する。Yahoo 呼び出しは決定的なテストダブルで
      // 差し替え (2026-10-28T05:30:00Z = JST 14:30)。
      const providerSecs = Date.UTC(2026, 9, 28, 5, 30, 0) / 1000;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/v1/finance/search")) {
            return new Response(
              JSON.stringify({
                news: [
                  {
                    uuid: "uuid-jst-1",
                    title: "実在の配信記事",
                    publisher: "テスト通信",
                    link: "https://example.com/article",
                    providerPublishTime: providerSecs,
                    relatedTickers: ["8035"],
                  },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }),
      );
      try {
        const req = new Request("https://example.com/api/market/overview");
        const res = await worker.fetch(req, {} as any);
        expect(res.status).toBe(200);
        const data = (await res.json()) as any;
        expect(data.news).toBeDefined();
        expect(Array.isArray(data.news)).toBe(true);
        expect(data.news.length).toBeGreaterThan(0);
        for (const item of data.news) {
          // publishedAt format should be "HH:mm" in JST
          expect(item.publishedAt).toMatch(/^\d{2}:\d{2}$/);
        }
        expect(data.news[0].publishedAt).toBe("14:30");
        expect(data.news[0].publishedTimestamp).toBe("2026-10-28T05:30:00.000Z");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("2. Dynamic Upcoming Calendar Events & Backward Compatibility", () => {
    it("exports UPCOMING_EVENTS for full backward compatibility", () => {
      expect(Array.isArray(UPCOMING_EVENTS)).toBe(true);
      expect(UPCOMING_EVENTS.length).toBeGreaterThan(0);
    });

    it("generates valid calendar date days in February without producing invalid dates like 02/31", () => {
      const febDate = new Date(2026, 1, 15); // Feb 2026 (non-leap year, 28 days)
      const events = generateUpcomingEvents(febDate);
      expect(events.length).toBeGreaterThan(0);
      for (const evt of events) {
        expect(evt.date).toMatch(/^\d{2}\/\d{2}$/);
        const [mStr, dStr] = evt.date.split("/");
        const m = parseInt(mStr, 10);
        const d = parseInt(dStr, 10);
        expect(m).toBeGreaterThanOrEqual(1);
        expect(m).toBeLessThanOrEqual(12);
        if (m === 2) {
          expect(d).toBeLessThanOrEqual(28);
        }
      }
    });
  });

  describe("3. StockDetailPage Lifecycle Guards & ARIA Tablist Arrow Navigation", () => {
    const stockDetailPath = path.resolve(__dirname, "../components/StockDetailPage.tsx");
    const stockDetailCode = fs.readFileSync(stockDetailPath, "utf-8");

    it("includes monotonic requestIdRef and mountedRef in loadStockData to guard against async race conditions", () => {
      expect(stockDetailCode).toContain("const requestIdRef = useRef(0);");
      expect(stockDetailCode).toContain("const mountedRef = useRef(true);");
      expect(stockDetailCode).toContain(
        "if (!mountedRef.current || requestId !== requestIdRef.current) return;",
      );
    });

    it("formats US stock prices with 2 decimal places", () => {
      expect(stockDetailCode).toMatch(/minimumFractionDigits:\s*stock\.market === "US" \? 2 :/);
      expect(stockDetailCode).toContain("maximumFractionDigits: 2");
    });

    it("supports keyboard arrow navigation across tabs in the WAI-ARIA tablist", () => {
      expect(stockDetailCode).toContain('role="tablist"');
      expect(stockDetailCode).toContain('tabIndex={activeTab === "CHART" ? 0 : -1}');
      expect(stockDetailCode).toContain('tabIndex={activeTab === "FINANCIALS" ? 0 : -1}');
      expect(stockDetailCode).toMatch(/e\.key === "ArrowRight"/);
      expect(stockDetailCode).toMatch(/e\.key === "ArrowLeft"/);
    });
  });

  describe("4. PortfolioManagerPage Decimal Fractions & Concurrency", () => {
    const portfolioPath = path.resolve(__dirname, "../components/PortfolioManagerPage.tsx");
    const portfolioCode = fs.readFileSync(portfolioPath, "utf-8");

    it("supports decimal share counts and cent prices via step='any' and fractional min attributes", () => {
      expect(portfolioCode).toMatch(/min="0\.001"\s+step="any"/);
      expect(portfolioCode).toMatch(/min="0\.01"\s+step="any"/);
    });

    it("includes monotonic requestIdRef and mountedRef in loadLiveQuotes to prevent race conditions", () => {
      expect(portfolioCode).toContain("const requestIdRef = useRef(0);");
      expect(portfolioCode).toContain("const mountedRef = useRef(true);");
      expect(portfolioCode).toContain(
        "if (!mountedRef.current || requestId !== requestIdRef.current) return;",
      );
    });

    it("formats US holding prices with 2 decimal places", () => {
      expect(portfolioCode).toContain('minimumFractionDigits: curr === "$" ? 2 : 0');
    });
  });

  describe("5. ScreenerPage Falsy 0 Metric Handling & Concurrency", () => {
    const screenerPath = path.resolve(__dirname, "../components/ScreenerPage.tsx");
    const screenerCode = fs.readFileSync(screenerPath, "utf-8");

    it("safely formats dividendYield === 0 without omitting it in CSV or table display", () => {
      // Whitespace-tolerant: the assertion pins the falsy-0 handling, not the
      // line layout (the formatter may wrap the ternary).
      expect(screenerCode).toMatch(
        /typeof stock\.dividendYield === "number"\s*\?\s*`\$\{stock\.dividendYield\.toFixed\(2\)\}%`\s*:\s*"--"/,
      );
      expect(screenerCode).toMatch(
        /typeof s\.dividendYield === "number"(?:\s*&&\s*Number\.isFinite\(s\.dividendYield\))?\s*\?\s*s\.dividendYield\.toFixed\(2\)\s*:\s*""/,
      );
    });

    it("includes monotonic requestIdRef in loadScreenerData", () => {
      expect(screenerCode).toContain("const requestIdRef = useRef(0);");
      expect(screenerCode).toContain("requestId !== requestIdRef.current");
    });

    it("formats US stock prices with 2 decimal places in screener results", () => {
      // Whitespace-tolerant: the formatter may wrap the options object.
      expect(screenerCode).toMatch(
        /stock\.price\.toLocaleString\(\s*"en-US",\s*\{\s*minimumFractionDigits:\s*2,\s*maximumFractionDigits:\s*2,?\s*\}\)/,
      );
    });
  });

  describe("6. CalendarPage Refresh Concurrency Guard", () => {
    const calendarPath = path.resolve(__dirname, "../components/CalendarPage.tsx");
    const calendarCode = fs.readFileSync(calendarPath, "utf-8");

    it("includes monotonic requestIdRef in loadEvents to guard against refresh button race conditions", () => {
      expect(calendarCode).toContain("const requestIdRef = useRef(0);");
      expect(calendarCode).toContain("requestId !== requestIdRef.current");
    });
  });
});
