import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  updateLocalSyncCache,
  parseLocalSyncCache,
  SYNC_STORAGE_KEY,
} from "../hooks/useCalculation";
import { buildSyncBatches } from "../hooks/useSimulation";

describe("Comprehensive Goal Audit Resolution & Regression Suite", () => {
  describe("1. Sync Cache Timestamp Normalization (Seconds vs Milliseconds)", () => {
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
      // Set fixed system time: 2026-09-16T12:00:00Z -> ~1773835200000 ms (~1773835200 sec)
      vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("normalizes second-based lastSynced timestamps to milliseconds so they survive 7-day retention cleanup", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const halfHourAgoSec = nowSec - 1800; // 30 minutes ago in seconds

      updateLocalSyncCache([
        { ticker: "7203.T", lastSynced: halfHourAgoSec },
      ]);

      const stored = JSON.parse(mockStore[SYNC_STORAGE_KEY] || "{}");
      expect(stored["7203.T"]).toBeDefined();
      expect(stored["7203.T"]).toBe(halfHourAgoSec * 1000);
      expect(stored["7203.T"]).toBeGreaterThan(1e11);
    });

    it("preserves millisecond-based lastSynced timestamps without double-scaling", () => {
      const nowMs = Date.now();
      const oneHourAgoMs = nowMs - 3600_000;

      updateLocalSyncCache([
        { ticker: "9984.T", lastSynced: oneHourAgoMs },
      ]);

      const stored = JSON.parse(mockStore[SYNC_STORAGE_KEY] || "{}");
      expect(stored["9984.T"]).toBe(oneHourAgoMs);
    });

    it("defaults to Date.now() when lastSynced is invalid or omitted", () => {
      const nowMs = Date.now();

      updateLocalSyncCache([
        { ticker: "6758.T" },
        { ticker: "8035.T", lastSynced: 0 },
        { ticker: "9432.T", lastSynced: -100 },
        "6861.T",
      ]);

      const stored = JSON.parse(mockStore[SYNC_STORAGE_KEY] || "{}");
      expect(stored["6758.T"]).toBe(nowMs);
      expect(stored["8035.T"]).toBe(nowMs);
      expect(stored["9432.T"]).toBe(nowMs);
      expect(stored["6861.T"]).toBe(nowMs);
    });

    it("normalizes second-based timestamps in parseLocalSyncCache", () => {
      const rawInSeconds = JSON.stringify({
        "7203.T": 1773835200, // seconds (< 1e11)
        "9984.T": 1773835200000, // milliseconds (>= 1e11)
      });

      const parsed = parseLocalSyncCache(rawInSeconds);
      expect(parsed["7203.T"]).toBe(1773835200000);
      expect(parsed["9984.T"]).toBe(1773835200000);
    });
  });

  describe("2. Batching and Sync Worker Request Guardrails", () => {
    it("splits ticker arrays into batches within worker limit (30 items)", () => {
      const tickers = Array.from({ length: 65 }, (_, i) => `TICKER_${i}`);
      const batches = buildSyncBatches(tickers);

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(30);
      expect(batches[1]).toHaveLength(30);
      expect(batches[2]).toHaveLength(5);
      expect(batches.flat()).toEqual(tickers);
    });
  });

  describe("3. Modal Dialog & Global Search Accessibility Audits", () => {
    it("ensures ModalBase defines role='dialog' with aria-modal and proper title ids", () => {
      const modalBaseCode = readFileSync(
        resolve(process.cwd(), "src/components/ModalBase.tsx"),
        "utf-8",
      );
      expect(modalBaseCode).toContain('role={role}');
      expect(modalBaseCode).toContain('aria-modal="true"');
      expect(modalBaseCode).toContain('useModalFocus');
      expect(modalBaseCode).toContain('generatedTitleId');
    });

    it("ensures GlobalSearchModal defines combobox with listbox accessibility semantics", () => {
      const searchCode = readFileSync(
        resolve(process.cwd(), "src/components/GlobalSearchModal.tsx"),
        "utf-8",
      );
      expect(searchCode).toContain('role="combobox"');
      expect(searchCode).toContain('aria-autocomplete="list"');
      expect(searchCode).toContain('aria-activedescendant');
      expect(searchCode).toContain('role="dialog"');
      expect(searchCode).toContain('aria-modal="true"');
    });

    it("ensures PortfolioManagerPage enforces accessible authentication lock", () => {
      const portfolioCode = readFileSync(
        resolve(process.cwd(), "src/components/PortfolioManagerPage.tsx"),
        "utf-8",
      );
      expect(portfolioCode).toContain("portfolio-auth-gate");
      expect(portfolioCode).toContain('htmlFor="portfolio-auth-input"');
      expect(portfolioCode).toContain('id="portfolio-auth-input"');
      expect(portfolioCode).toContain('role="alert"');
      expect(portfolioCode).toContain('aria-live="assertive"');
    });
  });
});
