import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { PricePoint } from "../types";
import worker from "../../worker/index";
import { timingSafeEqual } from "../../worker/internal";
import { MAX_SYNC_TICKERS_PER_REQUEST } from "../../worker/internal-impl";
import { SYNC_BATCH_SIZE } from "./priceSync";
import { MAX_OWNER_TOKEN_LENGTH } from "./apiContract";
import { calculateRiskMetrics } from "./analytics";

const workerSrc = readFileSync(resolve("worker/internal-impl.ts"), "utf-8");

describe("regression: worker API contract", () => {
  it("R1: /api/snapshot response includes required Snapshot fields (no misleading OHLC)", () => {
    // Worker snapshot block must define all required Snapshot fields
    expect(workerSrc).toMatch(/const snapshot = \{[^}]*\bcurrent:/s);
    expect(workerSrc).toMatch(/const snapshot = \{[^}]*\bchange:/s);
    expect(workerSrc).toMatch(/const snapshot = \{[^}]*\bchangePct:/s);
    // OHLC fields (open/high/low) should NOT be present since Yahoo chart API
    // only provides close prices; setting them equal to close is misleading.
    expect(workerSrc).not.toMatch(/const snapshot = \{[^}]*\bopen:/s);
    expect(workerSrc).not.toMatch(/const snapshot = \{[^}]*\bhigh:/s);
    expect(workerSrc).not.toMatch(/const snapshot = \{[^}]*\blow:/s);
  });

  it("R2: CORS response includes Vary: Origin to prevent cache poisoning", () => {
    expect(workerSrc).toMatch(/headers\[.vary.\]\s*=\s*.Origin./i);
  });

  it("R2b: CORS only allows localhost origins, not arbitrary origins", () => {
    // Must have an origin allowlist check, not blind reflection
    expect(workerSrc).toMatch(/isAllowedOrigin/);
    expect(workerSrc).toMatch(/localhost/);
  });

  it("R3: invalid JSON body returns 400 not 500", () => {
    expect(workerSrc).toContain("parseJsonBody");
    expect(workerSrc).toContain("Invalid JSON body");
    // Both POST handlers must use the helper
    const syncUsesHelper =
      workerSrc.includes('"/api/sync-prices"') &&
      workerSrc
        .slice(
          workerSrc.indexOf('"/api/sync-prices"'),
          workerSrc.indexOf('"/api/sync-prices"') + 2000,
        )
        .includes("parseJsonBody");
    const calcUsesHelper =
      workerSrc.includes('"/api/calculate"') &&
      workerSrc
        .slice(workerSrc.indexOf('"/api/calculate"'), workerSrc.indexOf('"/api/calculate"') + 2000)
        .includes("parseJsonBody");
    expect(syncUsesHelper).toBe(true);
    expect(calcUsesHelper).toBe(true);
  });

  it("R4: /api/sync-prices rejects batches larger than 12 instead of silently truncating them", async () => {
    // SEC-11/DATA-07: the per-request ticker cap was lowered from 30 to 12
    // and the client batch size follows it (see R7).
    expect(MAX_SYNC_TICKERS_PER_REQUEST).toBe(12);
    expect(workerSrc).toContain("rawTickers.length > MAX_SYNC_TICKERS_PER_REQUEST");

    const env = {
      ASSETS: { fetch: vi.fn() },
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
          }),
        }),
        batch: vi.fn().mockResolvedValue([]),
      },
    };
    const res = await worker.fetch(
      new Request("http://localhost/api/sync-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: Array.from({ length: 13 }, (_, i) => `T${i}`) }),
      }),
      env as never,
    );

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toContain("12");
  });

  it("R5: POST and DELETE /api/indices enforce rate limiting via checkRateLimit", () => {
    const postIndicesBlock = workerSrc.slice(
      workerSrc.indexOf('url.pathname === "/api/indices" && request.method === "POST"'),
      workerSrc.indexOf('url.pathname === "/api/indices" && request.method === "POST"') + 500,
    );
    expect(postIndicesBlock).toContain('checkRateLimit(env, ip, "indices")');

    const deleteIndicesBlock = workerSrc.slice(
      workerSrc.indexOf('url.pathname === "/api/indices" && request.method === "DELETE"'),
      workerSrc.indexOf('url.pathname === "/api/indices" && request.method === "DELETE"') + 500,
    );
    expect(deleteIndicesBlock).toContain('checkRateLimit(env, ip, "indices")');
  });

  it("R6: POST /api/indices rejects an owner token longer than the contract limit", async () => {
    // Behavioural check. The previous assertion only proved that the literal
    // "256" appeared somewhere in the Worker source, so it stayed green even
    // when the length check itself was removed. The limit now lives in the
    // shared API contract; the Worker must enforce exactly that value.
    expect(MAX_OWNER_TOKEN_LENGTH).toBe(256);

    const env = {
      ASSETS: { fetch: vi.fn() },
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
          }),
        }),
        batch: vi.fn().mockResolvedValue([]),
      },
    };

    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Regression",
          ownerToken: "x".repeat(MAX_OWNER_TOKEN_LENGTH + 1),
          basket: [{ ticker: "7203", name: "トヨタ", theme: "自動車", weight: 100 }],
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toContain(String(MAX_OWNER_TOKEN_LENGTH));
  });

  it("R7: useCalculation.ts batches through the shared priceSync module (12 tickers per request)", () => {
    const hookSrc = readFileSync(resolve("src/hooks/useCalculation.ts"), "utf-8");
    const priceSyncSrc = readFileSync(resolve("src/lib/priceSync.ts"), "utf-8");

    // DATA-25: the batch size, the auth headers and the warning texts are
    // owned by src/lib/priceSync, so the dashboard and the builder preview
    // cannot drift apart again. useCalculation must not keep a private copy.
    expect(hookSrc).toContain('import { syncPricesInBatches } from "../lib/priceSync"');
    expect(hookSrc).not.toContain("const BATCH_SIZE");
    expect(priceSyncSrc).toContain("export const SYNC_BATCH_SIZE = 12;");
    // The client batch size must stay in step with the Worker's request cap.
    expect(SYNC_BATCH_SIZE).toBe(MAX_SYNC_TICKERS_PER_REQUEST);
  });

  it("R8: wrangler configuration includes single-page-application and run_worker_first config", () => {
    const trackedConfigPath = resolve("wrangler.jsonc");
    // Precondition: the tracked configuration is the one that is always
    // deployed, so it must exist before it can be inspected.
    expect(existsSync(trackedConfigPath)).toBe(true);

    // `wrangler.local.jsonc` is a git-ignored developer override. The
    // assertion used to live inside `if (existsSync(...))`, so it silently
    // vanished on a clean checkout. The override is now folded into the set of
    // configurations in force: the tracked file is *always* checked and the
    // local override is checked in addition whenever it exists.
    const localConfigPath = resolve("wrangler.local.jsonc");
    const configsInForce = [
      readFileSync(trackedConfigPath, "utf-8"),
      ...(existsSync(localConfigPath) ? [readFileSync(localConfigPath, "utf-8")] : []),
    ];

    expect(configsInForce.length).toBeGreaterThanOrEqual(1);
    for (const config of configsInForce) {
      expect(config).toContain('"not_found_handling": "single-page-application"');
      expect(config).toContain('"run_worker_first": true');
    }
  });

  it("R9: --surface-hover is defined so mobile nav hover never loses its background", () => {
    const tokensSrc = readFileSync(resolve("src/styles/tokens.css"), "utf-8");
    expect(tokensSrc).toMatch(/--surface-hover\s*:/);
  });

  it("R10: /api/calculate requires theme on every basket item (no silent default)", async () => {
    // A theme-less basket item is malformed: the frontend always supplies a
    // theme, and silently defaulting would hide a broken client contract.
    const env = {
      ASSETS: { fetch: vi.fn() },
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true }),
          }),
          all: vi.fn().mockResolvedValue({ results: [] }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
        batch: vi.fn().mockResolvedValue([]),
      },
    };
    const res = await worker.fetch(
      new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basket: [{ ticker: "7203", name: "Toyota", weight: 100 }] }),
      }),
      env as never,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toContain("theme");
  });
});

// ── Fix-specific regression tests ──

describe("regression: timingSafeEqual timing-safe behavior", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });

  it("returns false for different-length strings without early-returning", () => {
    // This test ensures the function does NOT short-circuit on length mismatch.
    // The old implementation returned false immediately when lengths differed,
    // leaking length information via timing.
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("a", "ab")).toBe(false);
    expect(timingSafeEqual("", "a")).toBe(false);
    expect(timingSafeEqual("a", "")).toBe(false);
  });

  it("implementation does not early-return on length mismatch (source code check)", () => {
    // Ensure the source code does NOT contain the pattern:
    //   if (a.length !== b.length) { return false; }
    // which would be a timing leak.
    expect(workerSrc).not.toMatch(
      /function timingSafeEqual[\s\S]*?a\.length\s*!==\s*b\.length[\s\S]*?return false/,
    );
  });
});

describe("regression: annualReturn uses CAGR (compound annualization)", () => {
  /**
   * Build a strictly increasing series of real ISO dates.
   *
   * The previous fixture produced strings such as `2024-17-01` and
   * `2024-01-256`. Those are not dates, so `Date.parse` returned NaN and
   * `calculateRiskMetrics` silently skipped its date-sorting path - the very
   * path these fixtures are supposed to exercise.
   */
  function buildIsoDatedSeries(length: number, valueAt: (index: number) => number): PricePoint[] {
    const start = Date.UTC(2024, 0, 1);
    const points: PricePoint[] = [];
    for (let i = 0; i < length; i++) {
      const date = new Date(start + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const value = valueAt(i);
      points.push({ date, value, close: value });
    }
    return points;
  }

  it("builds a fixture whose dates are parseable ISO days in ascending order", () => {
    const points = buildIsoDatedSeries(500, (i) => 1000 + (1000 * i) / 499);

    expect(points).toHaveLength(500);
    for (const point of points) {
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(point.date))).toBe(false);
    }
    // Ascending: the analytics sort must be a no-op on a well-formed fixture.
    const parsed = points.map((p) => Date.parse(p.date));
    expect(parsed).toEqual([...parsed].sort((a, b) => a - b));
  });

  it("computes annualized return via CAGR, not linear scaling", () => {
    // Build a synthetic 500-day series (2 years of trading days) with 100% total return.
    // Linear scaling: 100% * (250/499) ≈ 50.1%  (WRONG)
    // CAGR: ((1 + 1.0) ^ (250/499) - 1) * 100 ≈ 41.42%  (CORRECT)
    const points = buildIsoDatedSeries(500, (i) => 1000 + (1000 * i) / 499);

    const metrics = calculateRiskMetrics(points, []);

    // CAGR for 100% over 500 trading days (250/499 ≈ 0.5010) should be ~41.42%
    // Linear would give ~50.1%. We assert that the value is closer to the CAGR result.
    expect(metrics.annualReturn).toBeGreaterThan(38);
    expect(metrics.annualReturn).toBeLessThan(45);
    // Definitively NOT the linear-scaled value:
    expect(metrics.annualReturn).not.toBeGreaterThan(49);
  });

  it("handles negative total returns correctly with CAGR", () => {
    // 250-day series with -20% total return
    const points = buildIsoDatedSeries(251, (i) => 1000 * (1 - 0.2 * (i / 250)));

    const metrics = calculateRiskMetrics(points, []);

    // CAGR for -20% over 250 days (exactly 1 year) = -20%
    expect(metrics.annualReturn).toBeCloseTo(-20, 0);
  });
});
