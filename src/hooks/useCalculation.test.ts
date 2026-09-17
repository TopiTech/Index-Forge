import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SYNC_STORAGE_KEY, determineSyncForce, getMissingPriceDataTickers, parseLocalSyncCache } from "./useCalculation";

describe("SYNC_STORAGE_KEY shared contract", () => {
  it("exports a non-empty localStorage key", () => {
    expect(typeof SYNC_STORAGE_KEY).toBe("string");
    expect(SYNC_STORAGE_KEY.length).toBeGreaterThan(0);
  });

  it("is the single source of truth: useSimulation must import it instead of duplicating the literal", () => {
    // Regression guard: useSimulation previously declared its own copy of the
    // "osi_stock_sync_cache" literal. If one copy were renamed while the other
    // kept the old key, the two hooks would read/write disjoint sync caches
    // and prices would appear stale on one screen but fresh on the other.
    const source = readFileSync(resolve(__dirname, "./useSimulation.ts"), "utf8");
    expect(source).toContain('SYNC_STORAGE_KEY, parseLocalSyncCache } from "./useCalculation"');
    expect(source).not.toMatch(/const\s+SYNC_STORAGE_KEY\s*=/);
  });
});

describe("parseLocalSyncCache", () => {
  it("ignores malformed and non-positive timestamps from browser storage", () => {
    expect(parseLocalSyncCache(JSON.stringify({
      AAPL: 1_700_000_000_000,
      aapl: 1_600_000_000_000,
      INVALID_TEXT: "fresh",
      ZERO: 0,
      NAN: null,
      NEGATIVE: -1,
    }))).toEqual({ AAPL: 1_700_000_000_000 });
  });

  it("returns an empty cache for non-object JSON values", () => {
    expect(parseLocalSyncCache("[]")).toEqual({});
    expect(parseLocalSyncCache("not-json")).toEqual({});
  });
});

describe("getMissingPriceDataTickers", () => {
  it("reports tickers that are returned without any usable price points", () => {
    const missing = getMissingPriceDataTickers(
      [
        { ticker: "7203", name: "Toyota", theme: "Auto", weight: 40 },
        { ticker: "9984", name: "SoftBank", theme: "AI", weight: 30 },
        { ticker: "8035", name: "Tokyo Electron", theme: "Semi", weight: 30 },
      ],
      [
        {
          ticker: "7203",
          name: "Toyota",
          theme: "Auto",
          sector: "Test",
          latestPrice: 0,
          series: [],
        },
        {
          ticker: "9984",
          name: "SoftBank",
          theme: "AI",
          sector: "Test",
          latestPrice: 100,
          series: [{ date: "2026-09-04", close: 100 }],
        },
      ],
    );

    expect(missing).toEqual(["7203", "8035"]);
  });

  it("matches ticker case-insensitively and ignores invalid price points", () => {
    const missing = getMissingPriceDataTickers(
      [
        { ticker: "abc", name: "A", theme: "T", weight: 50 },
        { ticker: "XYZ", name: "X", theme: "T", weight: 50 },
      ],
      [
        {
          ticker: "ABC",
          name: "A",
          theme: "T",
          sector: "Test",
          latestPrice: 0,
          series: [{ date: "2026-09-04", close: Number.NaN }],
        },
        {
          ticker: "xyz",
          name: "X",
          theme: "T",
          sector: "Test",
          latestPrice: 12,
          series: [{ date: "2026-09-04", close: 12 }],
        },
      ],
    );

    expect(missing).toEqual(["abc"]);
  });
});

describe("determineSyncForce", () => {
  it("returns false if force is false, regardless of session", () => {
    expect(determineSyncForce(false, null)).toBe(false);
    expect(determineSyncForce(false, { password: "admin-password" })).toBe(false);
  });

  it("returns false if force is true but session has no password (prevents 401 on unauthenticated retries)", () => {
    expect(determineSyncForce(true, null)).toBe(false);
    expect(determineSyncForce(true, undefined)).toBe(false);
    expect(determineSyncForce(true, { password: "" })).toBe(false);
  });

  it("returns true only if force is true and session has a password", () => {
    expect(determineSyncForce(true, { password: "valid-password" })).toBe(true);
  });
});

