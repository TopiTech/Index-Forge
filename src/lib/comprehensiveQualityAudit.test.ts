import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  determineTickFlashDirection,
  isTseMarketOpen,
  getTickerPollingInterval,
} from "../components/TradingViewTickerTape";
import { updateLocalSyncCache, SYNC_STORAGE_KEY } from "../hooks/useCalculation";
import {
  checkMemoryRateLimit,
  clearMemoryRateLimits,
  MAX_MEMORY_RATE_LIMIT_ENTRIES,
} from "../../worker/index";

describe("Comprehensive Quality Audit - Regression and Unit Tests", () => {
  describe("determineTickFlashDirection", () => {
    it("returns 'down' when price decreases even if the day's trend isPositiveFallback is true", () => {
      // Stock is up on the day (+3%), but dropped on this tick from 38,980.50 to 38,970.00
      const direction = determineTickFlashDirection("38,980.50", "38,970.00", true);
      expect(direction).toBe("down");
    });

    it("returns 'up' when price increases even if the day's trend isPositiveFallback is false", () => {
      // Stock is down on the day (-2%), but bounced on this tick from 71.45 to 71.55
      const direction = determineTickFlashDirection("71.45", "71.55", false);
      expect(direction).toBe("up");
    });

    it("falls back to isPositiveFallback when prices are identical or unparseable", () => {
      expect(determineTickFlashDirection("100.00", "100.00", true)).toBe("up");
      expect(determineTickFlashDirection("100.00", "100.00", false)).toBe("down");
      expect(determineTickFlashDirection("N/A", "N/A", true)).toBe("up");
      expect(determineTickFlashDirection("N/A", "N/A", false)).toBe("down");
    });
  });

  describe("isTseMarketOpen & getTickerPollingInterval", () => {
    it("identifies TSE open hours on weekdays and uses 60s interval", () => {
      // Wednesday 10:30 JST (01:30 UTC)
      const openDate = new Date("2026-09-16T01:30:00Z");
      expect(isTseMarketOpen(openDate)).toBe(true);
      expect(getTickerPollingInterval(openDate)).toBe(60_000);
    });

    it("identifies TSE closed hours (night/evening) on weekdays and uses 15m interval", () => {
      // Wednesday 20:00 JST (11:00 UTC)
      const closedEvening = new Date("2026-09-16T11:00:00Z");
      expect(isTseMarketOpen(closedEvening)).toBe(false);
      expect(getTickerPollingInterval(closedEvening)).toBe(15 * 60_000);

      // Wednesday 08:30 JST (Tuesday 23:30 UTC)
      const closedMorning = new Date("2026-09-15T23:30:00Z");
      expect(isTseMarketOpen(closedMorning)).toBe(false);
      expect(getTickerPollingInterval(closedMorning)).toBe(15 * 60_000);
    });

    it("identifies TSE closed hours on weekends and uses 15m interval", () => {
      // Sunday 11:00 JST (02:00 UTC)
      const weekend = new Date("2026-09-20T02:00:00Z");
      expect(isTseMarketOpen(weekend)).toBe(false);
      expect(getTickerPollingInterval(weekend)).toBe(15 * 60_000);
    });
  });

  describe("updateLocalSyncCache", () => {
    const STORAGE_KEY = SYNC_STORAGE_KEY;
    let mockStore: Record<string, string> = {};

    beforeEach(() => {
      mockStore = {};
      const mockLocalStorage = {
        getItem: vi.fn((key: string) => mockStore[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          mockStore[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockStore[key];
        }),
        clear: vi.fn(() => {
          mockStore = {};
        }),
      };
      vi.stubGlobal("localStorage", mockLocalStorage);
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("stores and preserves explicit lastSynced timestamp from SyncCacheUpdateEntry", () => {
      const explicitTimestamp = Date.now() - 3600_000; // 1 hour ago (within 7-day retention)
      updateLocalSyncCache([
        { ticker: "7203.T", lastSynced: explicitTimestamp },
        { ticker: "9984.T" }, // Omits lastSynced -> defaults to Date.now()
        "6758.T", // Legacy string -> defaults to Date.now()
      ]);

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      expect(stored["7203.T"]).toBe(explicitTimestamp);
      expect(stored["9984.T"]).toBe(Date.now());
      expect(stored["6758.T"]).toBe(Date.now());
    });

    it("cleans entries older than 7 days while retaining fresh entries", () => {
      const now = Date.now();
      const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
      const initialCache = {
        "OLD.T": tenDaysAgo,
        "FRESH.T": now - 1000,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialCache));

      updateLocalSyncCache(["NEW.T"]);

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      expect(stored["OLD.T"]).toBeUndefined();
      expect(stored["FRESH.T"]).toBe(now - 1000);
      expect(stored["NEW.T"]).toBe(now);
    });
  });

  describe("checkMemoryRateLimit & LRU behavior", () => {
    beforeEach(() => {
      clearMemoryRateLimits();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    });

    afterEach(() => {
      clearMemoryRateLimits();
      vi.useRealTimers();
    });

    it("allows requests up to maxRequests and blocks subsequent requests within the window", () => {
      const ip = "192.0.2.1";
      const endpoint = "test-endpoint";
      const max = 3;
      const windowSec = 60;

      expect(checkMemoryRateLimit(ip, endpoint, max, windowSec)).toBe(true); // 1
      expect(checkMemoryRateLimit(ip, endpoint, max, windowSec)).toBe(true); // 2
      expect(checkMemoryRateLimit(ip, endpoint, max, windowSec)).toBe(true); // 3
      expect(checkMemoryRateLimit(ip, endpoint, max, windowSec)).toBe(false); // 4 (exceeded)

      // Advance time beyond window
      vi.advanceTimersByTime(61 * 1000);

      // Should reset and allow again
      expect(checkMemoryRateLimit(ip, endpoint, max, windowSec)).toBe(true);
    });

    it("does not evict entries when updating an existing entry whose window expired", () => {
      // Fill to MAX_MEMORY_RATE_LIMIT_ENTRIES
      for (let i = 0; i < MAX_MEMORY_RATE_LIMIT_ENTRIES; i++) {
        checkMemoryRateLimit(`ip-${i}`, "ep", 10, 60);
      }

      // First entry ip-0 should exist
      // Advance time so window expires
      vi.advanceTimersByTime(65 * 1000);

      // Now request for ip-0 again (existing key, window expired)
      const allowed = checkMemoryRateLimit("ip-0", "ep", 10, 60);
      expect(allowed).toBe(true);

      // Crucial test: ip-1 should NOT have been evicted because ip-0 was not a new key
      // Within the new window, ip-1 can still be accessed
      const ip1Allowed = checkMemoryRateLimit("ip-1", "ep", 10, 60);
      expect(ip1Allowed).toBe(true);
    });

    it("evicts oldest entry only when inserting a brand new key at maximum capacity", () => {
      // Insert entries from 0 to MAX_MEMORY_RATE_LIMIT_ENTRIES - 1
      for (let i = 0; i < MAX_MEMORY_RATE_LIMIT_ENTRIES; i++) {
        checkMemoryRateLimit(`test-ip-${i}`, "ep", 2, 60);
      }

      // Exhaust limit on test-ip-0
      checkMemoryRateLimit("test-ip-0", "ep", 2, 60);
      expect(checkMemoryRateLimit("test-ip-0", "ep", 2, 60)).toBe(false); // blocked at limit

      // Now insert a brand new entry (test-ip-new)
      checkMemoryRateLimit("test-ip-new", "ep", 2, 60);

      // test-ip-0 was the oldest and should have been evicted.
      // Therefore, querying test-ip-0 again will treat it as a fresh new entry with count: 1 (returning true)
      expect(checkMemoryRateLimit("test-ip-0", "ep", 2, 60)).toBe(true);
    });
  });
});
