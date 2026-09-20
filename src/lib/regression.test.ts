import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import worker, { timingSafeEqual } from "../../worker/index";
import { calculateRiskMetrics } from "./analytics";

const workerSrc = readFileSync(resolve("worker/index.ts"), "utf-8");

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

  it("R4: /api/sync-prices rejects batches larger than 30 instead of silently truncating them", () => {
    expect(workerSrc).toContain("rawTickers.length > 30");
    expect(workerSrc).toContain("At most 30 tickers may be synced per request");
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

  it("R6: POST /api/indices validates ownerToken length <= 256", () => {
    expect(workerSrc).toContain("body.ownerToken.length > 256");
  });

  it("R7: useCalculation.ts uses BATCH_SIZE = 30 to match worker subrequest limit", () => {
    const hookSrc = readFileSync(resolve("src/hooks/useCalculation.ts"), "utf-8");
    expect(hookSrc).toContain("const BATCH_SIZE = 30;");
  });

  it("R8: wrangler configuration includes single-page-application and run_worker_first config", () => {
    const wranglerSrc = readFileSync(resolve("wrangler.jsonc"), "utf-8");
    expect(wranglerSrc).toContain('"not_found_handling": "single-page-application"');
    expect(wranglerSrc).toContain('"run_worker_first": true');

    if (existsSync(resolve("wrangler.local.jsonc"))) {
      const wranglerLocalSrc = readFileSync(resolve("wrangler.local.jsonc"), "utf-8");
      expect(wranglerLocalSrc).toContain('"not_found_handling": "single-page-application"');
      expect(wranglerLocalSrc).toContain('"run_worker_first": true');
    }
  });

  it("R9: --surface-hover is defined so mobile nav hover never loses its background", () => {
    const cssSrc = readFileSync(resolve("src/index.css"), "utf-8");
    expect(cssSrc).toMatch(/--surface-hover\s*:/);
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
  it("computes annualized return via CAGR, not linear scaling", () => {
    // Build a synthetic 500-day series (2 years of trading days) with 100% total return.
    // Linear scaling: 100% * (250/499) ≈ 50.1%  (WRONG)
    // CAGR: ((1 + 1.0) ^ (250/499) - 1) * 100 ≈ 41.42%  (CORRECT)
    const points = Array.from({ length: 500 }, (_, i) => ({
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`,
      value: 1000 + (1000 * i) / 499, // linearly from 1000 to 2000
      close: 1000 + (1000 * i) / 499,
    }));

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
    const points = Array.from({ length: 251 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      value: 1000 * (1 - 0.2 * (i / 250)),
      close: 1000 * (1 - 0.2 * (i / 250)),
    }));

    const metrics = calculateRiskMetrics(points, []);

    // CAGR for -20% over 250 days (exactly 1 year) = -20%
    expect(metrics.annualReturn).toBeCloseTo(-20, 0);
  });
});
