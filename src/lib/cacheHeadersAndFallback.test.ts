import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, { clearMemoryCache } from "../../worker/internal-impl";

describe("cacheHeadersAndFallback", () => {
  beforeEach(() => {
    clearMemoryCache();
  });

  const makeMockDb = () => ({
    prepare: vi.fn().mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({ success: true }),
    })),
  });

  it("attaches stale-while-revalidate and stale-if-error to GET /api/ticker-prices", async () => {
    const env: any = { DB: makeMockDb() };
    const req = new Request("http://localhost/api/ticker-prices", { method: "GET" });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    const cc = res.headers.get("cache-control");
    expect(cc).toBeDefined();
    expect(cc).toContain("stale-while-revalidate=");
    expect(cc).toContain("stale-if-error=86400");
  });

  it("attaches stale-while-revalidate and stale-if-error to GET /api/market/overview", async () => {
    const env: any = { DB: makeMockDb() };
    const req = new Request("http://localhost/api/market/overview", { method: "GET" });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    const cc = res.headers.get("cache-control");
    expect(cc).toBeDefined();
    expect(cc).toContain("stale-while-revalidate=300");
    expect(cc).toContain("stale-if-error=86400");
  });

  it("attaches stale-while-revalidate and stale-if-error to GET /api/stocks/screener", async () => {
    const env: any = { DB: makeMockDb() };
    const req = new Request("http://localhost/api/stocks/screener", { method: "GET" });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    const cc = res.headers.get("cache-control");
    expect(cc).toBeDefined();
    expect(cc).toContain("stale-while-revalidate=600");
    expect(cc).toContain("stale-if-error=86400");
  });

  it("attaches stale-while-revalidate and stale-if-error to GET /api/market/calendar", async () => {
    const env: any = { DB: makeMockDb() };
    const req = new Request("http://localhost/api/market/calendar", { method: "GET" });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    const cc = res.headers.get("cache-control");
    expect(cc).toBeDefined();
    expect(cc).toContain("stale-while-revalidate=3600");
    expect(cc).toContain("stale-if-error=86400");
  });

  it("provides graceful baseline fallback for snapshot when upstream fetch returns empty and no D1 cache exists", async () => {
    const env: any = { DB: makeMockDb() };
    // Fetch snapshot for ^GSPC with empty D1 cache
    const req = new Request("http://localhost/api/snapshot?symbol=^GSPC", { method: "GET" });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    const data: any = await res.json();
    expect(data.snapshot).toBeDefined();
    expect(data.snapshot.symbol).toBe("^GSPC");
    expect(data.series).toBeDefined();
    expect(data.series.length).toBeGreaterThan(0);

    const cc = res.headers.get("cache-control");
    expect(cc).toBeDefined();
    expect(cc).toContain("stale-while-revalidate=");
  });

  it("sets appropriate Cache-Control for non-asset static files (e.g. favicon / manifest)", async () => {
    const env: any = {
      DB: makeMockDb(),
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response("dummy svg", {
            headers: { "content-type": "image/svg+xml" },
          }),
        ),
      },
    };
    const req = new Request("http://localhost/favicon.svg", { method: "GET" });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    const cc = res.headers.get("Cache-Control");
    expect(cc).toBeDefined();
    expect(cc).toContain("public, max-age=86400");
    expect(cc).toContain("stale-while-revalidate=604800");
  });
});
