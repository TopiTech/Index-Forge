import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import { clearMemoryCache, resetPasswordTableEnsured } from "../../worker/internal";
import { createStubWorkerEnv } from "../test-helpers/env";

/**
 * The HTTP contract of the Worker's public read endpoints.
 *
 * These replace source-text assertions about the Worker module: the CORS
 * decision, the `Vary` header and the 400 for a malformed body are all
 * observable on a real `Response`, so they are asserted here instead of by
 * grepping `internal-impl.ts`.
 */
/** Answer the Yahoo chart endpoint with the given closes (oldest first). */
function stubYahooChart(closes: number[]) {
  const timestamps = closes.map((_, index) => Math.floor(Date.UTC(2026, 0, 1 + index) / 1000));
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v8/finance/chart/")) {
      return new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                timestamp: timestamps,
                indicators: { quote: [{ close: closes }] },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ chart: { result: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  clearMemoryCache();
  resetPasswordTableEnsured();
  vi.unstubAllGlobals();
});

describe("Worker HTTP contract", () => {
  it("builds /api/snapshot from the closes without inventing OHLC", async () => {
    stubYahooChart([100, 101]);

    const response = await worker.fetch(
      new Request("http://localhost/api/snapshot?symbol=%5EN225"),
      createStubWorkerEnv(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      snapshot: Record<string, unknown>;
      series: { date: string; close: number }[];
    };
    // The values come from the chart closes, so the baseline fallback (which
    // returns its own reference price) cannot satisfy this.
    expect(body.snapshot.current).toBe(101);
    expect(body.snapshot.change).toBe(1);
    expect(body.snapshot.changePct).toBe(1);
    expect(body.series.at(-1)?.close).toBe(101);
    // The chart API only provides closes, so open/high/low would be a
    // fabricated price. The response must not carry them.
    expect(body.snapshot).not.toHaveProperty("open");
    expect(body.snapshot).not.toHaveProperty("high");
    expect(body.snapshot).not.toHaveProperty("low");
  });

  it("reflects only a loopback Origin and always declares Vary: Origin", async () => {
    const allowed = await worker.fetch(
      new Request("http://localhost/api/health", {
        headers: { origin: "http://localhost:5173" },
      }),
      createStubWorkerEnv(),
    );

    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(allowed.headers.get("vary")).toBe("Origin");

    const denied = await worker.fetch(
      new Request("http://localhost/api/health", {
        headers: { origin: "https://evil.example" },
      }),
      createStubWorkerEnv(),
    );

    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    // The header is selected by Origin, so the response must say so even when
    // this particular origin was refused (RFC 9110 §12.5.5).
    expect(denied.headers.get("vary")).toBe("Origin");
  });

  it("rejects a malformed JSON body with 400 on every POST endpoint", async () => {
    for (const path of ["/api/calculate", "/api/sync-prices"]) {
      const response = await worker.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not-json",
        }),
        createStubWorkerEnv(),
      );

      expect(response.status, path).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error, path).toContain("Invalid JSON body");
    }
  });
});
