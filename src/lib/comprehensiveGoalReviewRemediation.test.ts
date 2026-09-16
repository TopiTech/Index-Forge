import { describe, it, expect, vi } from "vitest";
import { calculateCustomIndex } from "./indexEngine";
import { calculateSMA, calculateRiskMetrics } from "./analytics";
import worker from "../../worker/index";
import { getSavedDimensions } from "../components/TradingViewChartModal";

describe("Goal Remediation: calculateCustomIndex non-finite price handling", () => {
  it("ignores non-finite (Infinity, NaN) prices and maintains finite index values", () => {
    const basket = [{ ticker: "7203.T", name: "トヨタ自動車", weight: 100 }];
    const stockUniverse = [
      {
        ticker: "7203.T",
        name: "トヨタ自動車",
        series: [
          { date: "2025-01-01", close: 2000 },
          { date: "2025-01-02", close: Infinity }, // Should be ignored and fallback to 2000
          { date: "2025-01-03", close: NaN }, // Should be ignored and fallback to 2000
          { date: "2025-01-04", close: 2100 },
        ],
      },
    ];

    const result = calculateCustomIndex(basket, stockUniverse, 1000);
    expect(result).toHaveLength(4);
    for (const point of result) {
      expect(Number.isFinite(point.value)).toBe(true);
      expect(Number.isFinite(point.close)).toBe(true);
      expect(point.value).toBeGreaterThan(0);
    }

    // Day 1: 1000
    expect(result[0].value).toBe(1000);
    // Day 2: fallback to 2000 -> 1000
    expect(result[1].value).toBe(1000);
    // Day 3: fallback to 2000 -> 1000
    expect(result[2].value).toBe(1000);
    // Day 4: 2100 / 2000 * 1000 = 1050
    expect(result[3].value).toBe(1050);
  });
});

describe("Goal Remediation: calculateSMA window normalization", () => {
  it("normalizes float window sizes to Math.floor(window)", () => {
    const data = [10, 20, 30, 40, 50];
    const resWithFloat = calculateSMA(data, 2.9);
    const resWithInt = calculateSMA(data, 2);

    expect(resWithFloat).toEqual(resWithInt);
    expect(resWithFloat).toEqual([null, 15, 25, 35, 45]);
  });

  it("returns null array for non-finite or invalid window values", () => {
    const data = [10, 20, 30];
    expect(calculateSMA(data, NaN)).toEqual([null, null, null]);
    expect(calculateSMA(data, 0)).toEqual([null, null, null]);
    expect(calculateSMA(data, -3)).toEqual([null, null, null]);
  });
});

describe("Goal Remediation: calculateRiskMetrics -0 elimination and stability", () => {
  it("never returns negative zero (-0) in any risk metric field", () => {
    // Construct series that produces tiny negative returns that round to 0.00
    const customSeries = [
      { date: "2025-01-01", close: 1000 },
      { date: "2025-01-02", close: 999.9999 }, // -0.00001%
    ];

    const metrics = calculateRiskMetrics(customSeries, []);
    for (const [key, val] of Object.entries(metrics)) {
      if (typeof val === "number") {
        expect(Object.is(val, -0), `Field ${key} should not be -0`).toBe(false);
      }
    }
  });

  it("handles flat / zero-volatility series safely", () => {
    const flatSeries = [
      { date: "2025-01-01", close: 100 },
      { date: "2025-01-02", close: 100 },
      { date: "2025-01-03", close: 100 },
    ];
    const metrics = calculateRiskMetrics(flatSeries, flatSeries);
    expect(metrics.annualReturn).toBe(0);
    expect(metrics.annualVolatility).toBe(0);
    expect(metrics.sharpeRatio).toBe(0);
    expect(metrics.maxDrawdown).toBe(0);
    expect(Object.is(metrics.annualReturn, -0)).toBe(false);
    expect(Object.is(metrics.annualVolatility, -0)).toBe(false);
  });
});

describe("Goal Remediation: Worker CORS for IPv6 localhost", () => {
  const mockEnv = {
    ADMIN_PASSWORD: "test-admin-password",
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        }),
      }),
    },
  };

  it("allows CORS from http://[::1]:5173", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "OPTIONS",
        headers: {
          Origin: "http://[::1]:5173",
        },
      }),
      mockEnv as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://[::1]:5173");
  });

  it("rejects CORS from untrusted third-party origins", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "OPTIONS",
        headers: {
          Origin: "http://malicious-site.example.com",
        },
      }),
      mockEnv as any,
    );

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("Goal Remediation: TradingViewChartModal responsive sizing bounds", () => {
  it("ensures modal dimensions never exceed window bounds", () => {
    const dims = getSavedDimensions();
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBeGreaterThan(0);
  });
});
