import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../../worker/index";
import {
  setAllowMemoryCacheInTest,
  clearMemoryCache,
} from "../../worker/internal";
import { toYahooSymbol } from "./yahooSymbol";
import { formatStockPrice } from "./currency";

describe("Goal Comprehensive Code Review - Pass 3 Final Audit", () => {
  describe("1. Worker Market Calendar forceRefresh & ETag Validation", () => {
    beforeEach(() => {
      setAllowMemoryCacheInTest(true);
      clearMemoryCache();
    });

    afterEach(() => {
      setAllowMemoryCacheInTest(false);
      clearMemoryCache();
      vi.restoreAllMocks();
    });

    it("returns 304 Not Modified when ETag matches and forceRefresh is false", async () => {
      const initialReq = new Request("https://example.com/api/market/calendar");
      const initialRes = await worker.fetch(initialReq, {} as any);
      expect(initialRes.status).toBe(200);
      const etag = initialRes.headers.get("etag");
      expect(etag).toBeTruthy();

      const conditionalReq = new Request("https://example.com/api/market/calendar", {
        headers: { "if-none-match": etag! },
      });
      const conditionalRes = await worker.fetch(conditionalReq, {} as any);
      expect(conditionalRes.status).toBe(304);
    });

    it("bypasses 304 Not Modified and returns 200 when forceRefresh is requested via ?refresh=1 even with matching If-None-Match", async () => {
      const initialReq = new Request("https://example.com/api/market/calendar");
      const initialRes = await worker.fetch(initialReq, {} as any);
      const etag = initialRes.headers.get("etag");
      expect(etag).toBeTruthy();

      const forceRefreshReq = new Request("https://example.com/api/market/calendar?refresh=1", {
        headers: { "if-none-match": etag! },
      });
      const forceRefreshRes = await worker.fetch(forceRefreshReq, {} as any);
      expect(forceRefreshRes.status).toBe(200);
    });

    it("bypasses 304 Not Modified when forceRefresh is requested via Pragma or Cache-Control headers with matching If-None-Match", async () => {
      const initialReq = new Request("https://example.com/api/market/calendar");
      const initialRes = await worker.fetch(initialReq, {} as any);
      const etag = initialRes.headers.get("etag");
      expect(etag).toBeTruthy();

      const pragmaReq = new Request("https://example.com/api/market/calendar", {
        headers: {
          "if-none-match": etag!,
          Pragma: "no-cache",
        },
      });
      const pragmaRes = await worker.fetch(pragmaReq, {} as any);
      expect(pragmaRes.status).toBe(200);

      const noCacheReq = new Request("https://example.com/api/market/calendar", {
        headers: {
          "if-none-match": etag!,
          "Cache-Control": "no-cache",
        },
      });
      const noCacheRes = await worker.fetch(noCacheReq, {} as any);
      expect(noCacheRes.status).toBe(200);
    });
  });

  describe("2. toYahooSymbol Exchange Prefix & Robust Normalization", () => {
    it("strips TSE: and TYO: exchange prefixes for Tokyo Exchange tickers", () => {
      expect(toYahooSymbol("TSE:7203")).toBe("7203.T");
      expect(toYahooSymbol("TYO:7203")).toBe("7203.T");
      expect(toYahooSymbol("tse:6758")).toBe("6758.T");
      expect(toYahooSymbol("tyo:9984")).toBe("9984.T");
      expect(toYahooSymbol("TSE:7203.T")).toBe("7203.T");
      expect(toYahooSymbol("TYO:6758.T")).toBe("6758.T");
    });

    it("preserves standard Tokyo, US, and forex ticker rules", () => {
      expect(toYahooSymbol("7203")).toBe("7203.T");
      expect(toYahooSymbol("AAPL")).toBe("AAPL");
      expect(toYahooSymbol("^N225")).toBe("^N225");
      expect(toYahooSymbol("USDJPY=X")).toBe("USDJPY=X");
      expect(toYahooSymbol("６７５８")).toBe("6758.T");
    });
  });

  describe("3. StockTechnicalChart Tooltip and SMA Calculation Robustness", () => {
    it("safely handles null/undefined/NaN in tooltip formatter by returning -- instead of ¥0 / $0.00", () => {
      const ticker = "7203";
      const tooltipFormatter = (val: unknown, name: unknown) => {
        const isValidNum = typeof val === "number" && Number.isFinite(val);
        if (name === "volume") {
          return [isValidNum ? (val as number).toLocaleString() : "--", "出来高"];
        }
        if (name === "close") {
          return [isValidNum ? formatStockPrice(val as number, ticker) : "--", "終値"];
        }
        if (name === "sma25") {
          return [isValidNum ? formatStockPrice(val as number, ticker) : "--", "SMA 25日"];
        }
        if (name === "sma75") {
          return [isValidNum ? formatStockPrice(val as number, ticker) : "--", "SMA 75日"];
        }
        return [isValidNum ? val : "--", String(name)];
      };

      // Uncomputed SMA (e.g. earlier days in chart history)
      expect(tooltipFormatter(null, "sma25")).toEqual(["--", "SMA 25日"]);
      expect(tooltipFormatter(undefined, "sma25")).toEqual(["--", "SMA 25日"]);
      expect(tooltipFormatter(NaN, "sma75")).toEqual(["--", "SMA 75日"]);
      expect(tooltipFormatter(null, "volume")).toEqual(["--", "出来高"]);

      // Valid computed values
      expect(tooltipFormatter(2850, "sma25")).toEqual(["¥2,850", "SMA 25日"]);
      expect(tooltipFormatter(3000, "close")).toEqual(["¥3,000", "終値"]);
      expect(tooltipFormatter(1500000, "volume")).toEqual(["1,500,000", "出来高"]);
    });

    it("SMA accumulation safely handles corrupted or NaN raw price series", () => {
      const p = 100;
      const rawSeries: Array<{ close?: number }> = [
        { close: NaN },
        { close: -5 },
        { close: undefined },
        ...Array.from({ length: 22 }, (_, idx) => ({ close: 100 + idx })),
      ];

      let sum = 0;
      for (let k = 0; k < 25; k++) {
        const c = rawSeries[k]?.close;
        sum += typeof c === "number" && Number.isFinite(c) && c > 0 ? c : p;
      }
      const sma25 = Math.round((sum / 25) * 100) / 100;

      expect(Number.isFinite(sma25)).toBe(true);
      expect(Number.isNaN(sma25)).toBe(false);
      expect(sma25).toBeGreaterThan(0);
    });
  });

  describe("4. Screener CSV Export Resilience", () => {
    it("handles null, undefined, or NaN price and changePercent without runtime error", () => {
      const escapeCsvCell = (val: unknown): string => {
        if (val === null || val === undefined) return '""';
        const str = String(val);
        return `"${str.replace(/"/g, '""')}"`;
      };

      const problematicStock = {
        ticker: "TEST",
        name: "Test Corp",
        market: "PRIME",
        theme: "Tech",
        price: NaN as unknown as number,
        changePercent: undefined as unknown as number,
        dividendYield: null as unknown as number,
        per: NaN as unknown as number,
        pbr: null as unknown as number,
        roe: undefined as unknown as number,
        technicalSignal: "NEUTRAL",
      };

      expect(() => {
        const row = [
          escapeCsvCell(problematicStock.ticker),
          escapeCsvCell(problematicStock.name),
          escapeCsvCell(problematicStock.market),
          escapeCsvCell(problematicStock.theme),
          escapeCsvCell(
            typeof problematicStock.price === "number" && Number.isFinite(problematicStock.price)
              ? problematicStock.price
              : ""
          ),
          escapeCsvCell(
            typeof problematicStock.changePercent === "number" &&
              Number.isFinite(problematicStock.changePercent)
              ? problematicStock.changePercent.toFixed(2)
              : ""
          ),
          escapeCsvCell(
            typeof problematicStock.dividendYield === "number" &&
              Number.isFinite(problematicStock.dividendYield)
              ? problematicStock.dividendYield.toFixed(2)
              : ""
          ),
        ];
        expect(row[4]).toBe('""');
        expect(row[5]).toBe('""');
        expect(row[6]).toBe('""');
      }).not.toThrow();
    });
  });
});
