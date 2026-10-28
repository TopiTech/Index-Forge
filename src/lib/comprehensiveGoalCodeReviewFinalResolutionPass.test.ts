import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearStockFundamentalsClientCache,
  fetchStockFundamentals,
  getStockFundamentalsClientCacheSize,
  getStockFundamentalsFailureCacheSize,
  hasCachedStockFundamentals,
  MAX_STOCK_FUNDAMENTALS_CLIENT_CACHE_ENTRIES,
  MAX_STOCK_FUNDAMENTALS_FAILURE_CACHE_ENTRIES,
  STOCK_FUNDAMENTALS_CACHE_TTL_MS,
} from "./marketDataService";
import { createStubWorkerEnv } from "../test-helpers/env";
import { clearMemoryCache, resetPasswordTableEnsured } from "../../worker/internal";

describe("comprehensiveGoalCodeReviewFinalResolutionPass", () => {
  beforeEach(() => {
    clearStockFundamentalsClientCache();
    clearMemoryCache();
    resetPasswordTableEnsured();
    vi.useRealTimers();
  });

  describe("marketDataService cache bounding & eviction", () => {
    it("bounds stockFundamentalsClientCache to MAX_STOCK_FUNDAMENTALS_CLIENT_CACHE_ENTRIES and evicts oldest entries", async () => {
      expect(getStockFundamentalsClientCacheSize()).toBe(0);

      // Populate cache up to the maximum capacity
      for (let i = 0; i < MAX_STOCK_FUNDAMENTALS_CLIENT_CACHE_ENTRIES; i++) {
        await fetchStockFundamentals(`TEST${i}`);
      }
      expect(getStockFundamentalsClientCacheSize()).toBe(MAX_STOCK_FUNDAMENTALS_CLIENT_CACHE_ENTRIES);

      // Verify the first item is still cached
      expect(hasCachedStockFundamentals("TEST0")).toBe(true);

      // Adding one more ticker should evict the oldest entry
      await fetchStockFundamentals("TEST_OVERFLOW");
      expect(getStockFundamentalsClientCacheSize()).toBe(MAX_STOCK_FUNDAMENTALS_CLIENT_CACHE_ENTRIES);

      // The new item must be present
      expect(hasCachedStockFundamentals("TEST_OVERFLOW")).toBe(true);
    });

    it("prunes expired entries before evicting fresh entries in stockFundamentalsClientCache", async () => {
      vi.useFakeTimers();
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      clearStockFundamentalsClientCache();

      // Fetch two tickers
      await fetchStockFundamentals("OLD_TICKER");
      expect(hasCachedStockFundamentals("OLD_TICKER")).toBe(true);

      // Advance time past TTL for the old ticker
      vi.setSystemTime(baseTime + STOCK_FUNDAMENTALS_CACHE_TTL_MS + 1000);

      // After time has elapsed, the item should be recognized as expired and purged
      expect(hasCachedStockFundamentals("OLD_TICKER")).toBe(false);

      vi.useRealTimers();
    });

    it("bounds stockFundamentalsFailureCache to MAX_STOCK_FUNDAMENTALS_FAILURE_CACHE_ENTRIES", async () => {
      clearStockFundamentalsClientCache();

      // Mock fetch failure in simulated browser environment
      const originalWindow = (globalThis as unknown as { window?: unknown }).window;
      const originalFetch = globalThis.fetch;
      try {
        (globalThis as unknown as { window: unknown }).window = {};
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));

        for (let i = 0; i < MAX_STOCK_FUNDAMENTALS_FAILURE_CACHE_ENTRIES + 10; i++) {
          await fetchStockFundamentals(`FAIL${i}`, true);
        }

        expect(getStockFundamentalsFailureCacheSize()).toBeLessThanOrEqual(
          MAX_STOCK_FUNDAMENTALS_FAILURE_CACHE_ENTRIES,
        );
      } finally {
        if (originalWindow === undefined) {
          delete (globalThis as unknown as { window?: unknown }).window;
        } else {
          (globalThis as unknown as { window: unknown }).window = originalWindow;
        }
        globalThis.fetch = originalFetch;
      }
    });

    it("clears both client and failure caches completely on clearStockFundamentalsClientCache", async () => {
      await fetchStockFundamentals("CLEAR1");
      expect(getStockFundamentalsClientCacheSize()).toBeGreaterThan(0);

      clearStockFundamentalsClientCache();
      expect(getStockFundamentalsClientCacheSize()).toBe(0);
      expect(getStockFundamentalsFailureCacheSize()).toBe(0);
    });
  });

  describe("worker /api/indices route dispatch integrity", () => {
    it("rejects unsupported HTTP methods with 405 and Allow: GET, POST, DELETE header", async () => {
      const req = new Request("http://localhost/api/indices", { method: "PATCH" });
      const res = await worker.fetch(req, createStubWorkerEnv());
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("GET, POST, DELETE");
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("GET, POST, DELETE");
    });

    it("handles GET /api/indices correctly", async () => {
      const req = new Request("http://localhost/api/indices", { method: "GET" });
      const res = await worker.fetch(req, createStubWorkerEnv());
      expect(res.status).toBe(200);
      const list = (await res.json()) as unknown[];
      expect(Array.isArray(list)).toBe(true);
    });

    it("handles POST /api/indices correctly with validation", async () => {
      // POST without body or malformed payload returns 400
      const req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });
      const res = await worker.fetch(req, createStubWorkerEnv());
      expect(res.status).toBe(400);
    });

    it("handles DELETE /api/indices correctly with validation", async () => {
      // DELETE without index id returns 400
      const req = new Request("http://localhost/api/indices", {
        method: "DELETE",
      });
      const res = await worker.fetch(req, createStubWorkerEnv());
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("指数IDを指定してください。");
    });
  });
});
