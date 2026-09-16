import { beforeEach, describe, it, expect, vi } from "vitest";
import worker, { toYahooSymbol, SYSTEM_INDICES, hashToken, clearAuthCache, resetPasswordTableEnsured } from "../../worker/index";

const TEST_ADMIN_PASSWORD = "test-admin-password";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

function createMockEnv(overrides?: Partial<any>) {
  const executeQuery = async (query: string, params: unknown[] = []) => {
    if (query.includes("rate_limits")) {
      return { results: [] };
    }
    if (query.includes("snapshot_cache")) {
      return { results: [] };
    }
    if (query.includes("owner_token_hash") || query.includes("WHERE id = ?")) {
      const targetId = params[0];
      if (targetId === "test-index") {
        return {
          results: [
            {
              id: "test-index",
              name: "Test Index",
              description: "Desc",
              base_value: 1000,
              sort_order: 1,
              owner_token_hash: null,
            },
          ],
        };
      }
      return { results: [] };
    }
    if (query.includes("indices")) {
      return {
        results: [
          {
            id: "test-index",
            name: "Test Index",
            description: "Desc",
            base_value: 1000,
            sort_order: 1,
            ticker: "9984",
            stock_name: "SoftBank",
            weight: 100,
            theme: "AI",
          },
        ],
      };
    }
    if (query.includes("stock_prices")) {
      return {
        results: [
          { ticker: "9984", date: "2026-04-01", price: 1000 },
          { ticker: "9984", date: "2026-04-02", price: 1100 },
        ],
      };
    }
    if (query.includes("sync_logs")) {
      return { results: [] };
    }
    return { results: [] };
  };

  const prepareMock = vi.fn().mockImplementation((query: string) => {
    return {
      bind: vi.fn().mockImplementation((...params: any[]) => {
        return {
          all: () => executeQuery(query, params),
          run: vi.fn().mockResolvedValue({ success: true }),
        };
      }),
      all: () => executeQuery(query, []),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
  });

  return {
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response("Asset", { status: 200 })),
    },
    DB: {
      prepare: prepareMock,
      batch: vi.fn().mockResolvedValue([]),
    },
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    ...overrides,
  };
}

describe("worker fetch handlers", () => {
  it("handles OPTIONS request with CORS headers for localhost origin", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/health", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173" },
    });
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("does not set CORS headers for non-localhost origins", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/health", {
      method: "OPTIONS",
      headers: { Origin: "http://example.com" },
    });
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("handles GET /api/health", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/health");
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, service: "indexforge-worker" });
  });

  it("handles GET /api/indices", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/indices");
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].id).toBe("test-index");
    expect(data[0].basket.length).toBe(1);
    expect(data[0].basket[0].ticker).toBe("9984");
  });

  it("validates POST /api/sync-prices inputs", async () => {
    const env = createMockEnv();

    // Invalid JSON
    const res1 = await worker.fetch(
      new Request("http://localhost/api/sync-prices", {
        method: "POST",
        body: "invalid-json",
      }),
      env as any,
    );
    expect(res1.status).toBe(400);

    // Empty tickers
    const res2 = await worker.fetch(
      new Request("http://localhost/api/sync-prices", {
        method: "POST",
        body: JSON.stringify({ tickers: [] }),
      }),
      env as any,
    );
    expect(res2.status).toBe(400);

    // Invalid ticker characters
    const res3 = await worker.fetch(
      new Request("http://localhost/api/sync-prices", {
        method: "POST",
        body: JSON.stringify({ tickers: ["invalid ticker!!"] }),
      }),
      env as any,
    );
    expect(res3.status).toBe(400);
  });

  it("validates POST /api/calculate inputs", async () => {
    const env = createMockEnv();

    // Invalid baseValue
    const res1 = await worker.fetch(
      new Request("http://localhost/api/calculate", {
        method: "POST",
        body: JSON.stringify({ basket: [{ ticker: "9984", name: "SBG", theme: "AI", weight: 100 }], baseValue: -5 }),
      }),
      env as any,
    );
    expect(res1.status).toBe(400);

    // Invalid weight (>100)
    const res2 = await worker.fetch(
      new Request("http://localhost/api/calculate", {
        method: "POST",
        body: JSON.stringify({ basket: [{ ticker: "9984", name: "SBG", theme: "AI", weight: 150 }] }),
      }),
      env as any,
    );
    expect(res2.status).toBe(400);
  });

  it("executes POST /api/calculate successfully", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/calculate", {
      method: "POST",
      body: JSON.stringify({
        basket: [{ ticker: "9984", name: "SoftBank", theme: "AI", weight: 100 }],
        baseValue: 1000,
      }),
    });
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.baseValue).toBe(1000);
    expect(data.series.length).toBe(2);
    expect(data.series[0].value).toBe(1000);
    expect(data.series[1].value).toBe(1100);
  });

  it("serves static assets with immutable cache headers for /assets/*", async () => {
    const env = createMockEnv({
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response("console.log('asset')", {
            status: 200,
            headers: { "content-type": "application/javascript" },
          }),
        ),
      },
    });
    const req = new Request("http://localhost/assets/index-DAfVT__E.js");
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("serves HTML with no-cache headers for root", async () => {
    const env = createMockEnv({
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response("<!doctype html><html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        ),
      },
    });
    const req = new Request("http://localhost/");
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
  });

  it("returns 404 JSON for unmatched /api/* endpoints instead of falling through to static assets", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/nonexistent-endpoint");
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Endpoint not found");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("validates POST /api/indices inputs strictly", async () => {
    const env = createMockEnv();

    // Invalid baseValue
    const res1 = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        body: JSON.stringify({
          name: "Test",
          baseValue: -100,
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      }),
      env as any,
    );
    expect(res1.status).toBe(400);

    // Invalid ticker characters
    const res2 = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        body: JSON.stringify({
          name: "Test",
          basket: [{ ticker: "7203<script>", name: "Toyota", weight: 100 }],
        }),
      }),
      env as any,
    );
    expect(res2.status).toBe(400);

    // Invalid weight
    const res3 = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        body: JSON.stringify({
          name: "Test",
          basket: [{ ticker: "7203", name: "Toyota", weight: 0 }],
        }),
      }),
      env as any,
    );
    expect(res3.status).toBe(400);

    // Empty basket
    const res4 = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        body: JSON.stringify({ name: "Test", basket: [] }),
      }),
      env as any,
    );
    expect(res4.status).toBe(400);
  });

  it("validates DELETE /api/indices parameter", async () => {
    const env = createMockEnv();

    // Missing id
    const res1 = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "DELETE",
      }),
      env as any,
    );
    expect(res1.status).toBe(400);

    // Invalid id characters
    const res2 = await worker.fetch(
      new Request("http://localhost/api/indices?id=invalid;id", {
        method: "DELETE",
      }),
      env as any,
    );
    expect(res2.status).toBe(400);
  });

  it("validates GET /api/snapshot symbol parameter", async () => {
    const env = createMockEnv();

    // Invalid characters in symbol
    const res = await worker.fetch(
      new Request("http://localhost/api/snapshot?symbol=INVALID/SYMBOL<script>"),
      env as any,
    );
    expect(res.status).toBe(400);
  });

  it("safely handles missing env.ASSETS", async () => {
    const env = createMockEnv({ ASSETS: undefined });
    const req = new Request("http://localhost/assets/index.js");
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(404);
  });

  it("safely catches and handles env.ASSETS.fetch exception without crashing", async () => {
    const env = createMockEnv({
      ASSETS: {
        fetch: vi.fn().mockRejectedValue(new Error("Cloudflare Assets internal failure")),
      },
    });
    const req = new Request("http://localhost/assets/index-DAfVT__E.js");
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("Failed to load static asset");
  });

  it("normalizes Japanese TSE tickers and US/global tickers correctly with toYahooSymbol", () => {
    // Japanese numeric and new alphanumeric codes
    expect(toYahooSymbol("7203")).toBe("7203.T");
    expect(toYahooSymbol("9984")).toBe("9984.T");
    expect(toYahooSymbol("130A")).toBe("130A.T");
    expect(toYahooSymbol("256A")).toBe("256A.T");
    expect(toYahooSymbol("7203.T")).toBe("7203.T");

    // US and global tickers
    expect(toYahooSymbol("AAPL")).toBe("AAPL");
    expect(toYahooSymbol("NVDA")).toBe("NVDA");
    expect(toYahooSymbol("MSFT")).toBe("MSFT");

    // Benchmarks and Forex
    expect(toYahooSymbol("^N225")).toBe("^N225");
    expect(toYahooSymbol("^GSPC")).toBe("^GSPC");
    expect(toYahooSymbol("USDJPY=X")).toBe("USDJPY=X");
  });

  it("rejects duplicate tickers in POST /api/indices with 400 Bad Request", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "custom-dup",
        name: "Duplicate Test",
        basket: [
          { ticker: "7203", name: "Toyota 1", weight: 50, theme: "Auto" },
          { ticker: "7203", name: "Toyota 2", weight: 50, theme: "Auto" },
        ],
      }),
    });
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Duplicate ticker in basket");
  });

  it("rejects duplicate tickers in POST /api/calculate with 400 Bad Request", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseValue: 1000,
        basket: [
          { ticker: "9984", name: "SBG 1", weight: 50, theme: "AI" },
          { ticker: "9984", name: "SBG 2", weight: 50, theme: "AI" },
        ],
      }),
    });
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Duplicate ticker in basket");
  });

  it("prevents deletion of built-in system indices and returns 403 Forbidden", async () => {
    const env = createMockEnv();

    for (const sysId of Array.from(SYSTEM_INDICES)) {
      const req = new Request(`http://localhost/api/indices?id=${sysId}`, {
        method: "DELETE",
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Cannot delete built-in system index");
    }
  });

  it("safely handles corrupted snapshot cache JSON without throwing a 500 error", async () => {
    const env = createMockEnv({
      DB: {
        prepare: vi.fn().mockImplementation((query: string) => {
          return {
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockImplementation(() => {
              if (query.includes("rate_limits")) return { results: [] };
              if (query.includes("snapshot_cache")) {
                return {
                  results: [{ data: "INVALID_JSON_CORRUPT{", cached_at: Math.floor(Date.now() / 1000) }],
                };
              }
              return { results: [] };
            }),
            run: vi.fn().mockResolvedValue({ success: true }),
          };
        }),
        batch: vi.fn().mockResolvedValue([]),
      },
    });

    // Mock fetch to return empty series (fresh fetch fails)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ chart: { result: [] } }), { status: 200 }),
    );

    try {
      const req = new Request("http://localhost/api/snapshot?symbol=%5EN225");
      const res = await worker.fetch(req, env as any);
      // Because cache is corrupt and fresh fetch returns no data, it cleanly returns 502 instead of unhandled 500 crash
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("hashToken generates a 64-character hex SHA-256 string", async () => {
    const hash1 = await hashToken("secret-token-123");
    const hash2 = await hashToken("secret-token-123");
    const hash3 = await hashToken("different-token");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("POST /api/indices generates and returns an ownerToken for authenticated new indices", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-auth-password": TEST_ADMIN_PASSWORD },
      body: JSON.stringify({
        name: "Protected Tech Index",
        basket: [{ ticker: "9984", name: "SBG", weight: 100, theme: "AI" }],
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.ownerToken).toBe("string");
    expect(data.ownerToken.length).toBeGreaterThan(10);
    expect(data.id).toMatch(/^custom-/);
  });

  it("POST /api/indices rejects unauthenticated creation even when an owner token is supplied", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-owner-token": "attacker-token" },
      body: JSON.stringify({
        id: "unauthenticated-index",
        name: "Unauthorized Index",
        basket: [{ ticker: "9984", name: "SBG", weight: 100, theme: "AI" }],
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("パスワード認証");
  });

  it("DELETE /api/indices rejects deletion with 403 when owner token is missing or invalid", async () => {
    const myToken = "creator-secret-token";
    const myHash = await hashToken(myToken);

    const env = createMockEnv({
      DB: {
        prepare: vi.fn().mockImplementation((query: string) => ({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockImplementation(() => {
            if (query.includes("SELECT") && query.includes("indices")) {
              return { results: [{ id: "custom-protected", owner_token_hash: myHash }] };
            }
            return { results: [] };
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        })),
        batch: vi.fn().mockResolvedValue([]),
      },
    });

    // 1. Without token: 403 Forbidden
    const resNoToken = await worker.fetch(
      new Request("http://localhost/api/indices?id=custom-protected", { method: "DELETE" }),
      env as any,
    );
    expect(resNoToken.status).toBe(403);
    const noTokenData = await resNoToken.json();
    expect(noTokenData.error).toContain("作成者トークン");

    // 2. With wrong token: 403 Forbidden
    const resWrongToken = await worker.fetch(
      new Request("http://localhost/api/indices?id=custom-protected", {
        method: "DELETE",
        headers: { "x-owner-token": "wrong-token-abc" },
      }),
      env as any,
    );
    expect(resWrongToken.status).toBe(403);
    const wrongTokenData = await resWrongToken.json();
    expect(wrongTokenData.error).toContain("一致しません");

    // 3. With correct token: 200 OK
    const resValid = await worker.fetch(
      new Request("http://localhost/api/indices?id=custom-protected", {
        method: "DELETE",
        headers: { "x-owner-token": myToken },
      }),
      env as any,
    );
    expect(resValid.status).toBe(200);
    const validData = await resValid.json();
    expect(validData.ok).toBe(true);
  });

  it("POST /api/indices rejects updating existing index when owner token is invalid or missing", async () => {
    const originalToken = "owner-valid-token";
    const originalHash = await hashToken(originalToken);

    const env = createMockEnv({
      DB: {
        prepare: vi.fn().mockImplementation((query: string) => ({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockImplementation(() => {
            if (query.includes("SELECT") && query.includes("indices")) {
              return { results: [{ id: "custom-existing-1", owner_token_hash: originalHash }] };
            }
            return { results: [] };
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        })),
        batch: vi.fn().mockResolvedValue([]),
      },
    });

    // Attempt overwrite with wrong token: 403
    const reqWrong = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-owner-token": "bad-token" },
      body: JSON.stringify({
        id: "custom-existing-1",
        name: "Hacked Index",
        basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
      }),
    });
    const resWrong = await worker.fetch(reqWrong, env as any);
    expect(resWrong.status).toBe(403);

    // Attempt update with correct token: 200
    const reqValid = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-owner-token": originalToken },
      body: JSON.stringify({
        id: "custom-existing-1",
        name: "Updated Valid Index",
        basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
      }),
    });
    const resValid = await worker.fetch(reqValid, env as any);
    expect(resValid.status).toBe(200);
  });

  it("POST /api/calculate loads and calculates prices from stock_series table", async () => {
    const seriesJson = JSON.stringify([
      { date: "2026-04-01", close: 2000 },
      { date: "2026-04-02", close: 2200 },
    ]);

    const env = createMockEnv({
      DB: {
        prepare: vi.fn().mockImplementation((query: string) => ({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockImplementation(() => {
            if (query.includes("stock_series")) {
              return { results: [{ ticker: "7203", prices: seriesJson }] };
            }
            return { results: [] };
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        })),
        batch: vi.fn().mockResolvedValue([]),
      },
    });

    const req = new Request("http://localhost/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        basket: [{ ticker: "7203", name: "Toyota", theme: "Auto", weight: 100 }],
        baseValue: 1000,
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.series.length).toBe(2);
    expect(data.series[0].value).toBe(1000);
    expect(data.series[1].value).toBe(1100);
  });

  it("POST /api/indices returns 429 when rate limit is exceeded", async () => {
    const env = createMockEnv({
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
          }),
        }),
        batch: vi.fn().mockResolvedValue([]),
      },
    });

    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Rate Limited Index",
        basket: [{ ticker: "9984", name: "SBG", weight: 100, theme: "AI" }],
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toContain("Rate limit exceeded");
  });

  it("DELETE /api/indices returns 429 when rate limit is exceeded", async () => {
    const env = createMockEnv({
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
          }),
        }),
        batch: vi.fn().mockResolvedValue([]),
      },
    });

    const req = new Request("http://localhost/api/indices?id=custom-rate-limited", {
      method: "DELETE",
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toContain("Rate limit exceeded");
  });

  it("POST /api/indices rejects ownerToken exceeding 256 characters with 400", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Too Long Token Index",
        ownerToken: "a".repeat(257),
        basket: [{ ticker: "9984", name: "SBG", weight: 100, theme: "AI" }],
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid ownerToken");
  });

  it("toYahooSymbol normalizes lowercase Japanese tickers and US stock symbols", () => {
    expect(toYahooSymbol("7203.t")).toBe("7203.T");
    expect(toYahooSymbol("7203")).toBe("7203.T");
    expect(toYahooSymbol("aapl")).toBe("AAPL");
    expect(toYahooSymbol("nvda")).toBe("NVDA");
    expect(toYahooSymbol("^n225")).toBe("^N225");
  });

  describe("Authentication & Admin Password Management", () => {
    it("POST /api/auth/verify verifies the configured deployment admin password", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.role).toBe("admin");
    });

    it("POST /api/auth/verify rejects incorrect password with 401", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it("does not authenticate with a built-in password when ADMIN_PASSWORD is unset", async () => {
      const env = createMockEnv({ ADMIN_PASSWORD: undefined });
      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "admin1234" }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(401);
    });

    it("fails closed when the authentication rate-limit check is unavailable", async () => {
      const env = createMockEnv();
      const defaultPrepare = env.DB.prepare;
      env.DB.prepare = vi.fn().mockImplementation((query: string) => {
        if (query.includes("rate_limits")) {
          throw new Error("rate-limit table unavailable");
        }
        return defaultPrepare(query);
      });
      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("認証試行回数");
    });

    it("GET /api/admin/passwords rejects non-admin with 403", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "GET",
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("管理者権限が必要です");
    });

    it("POST /api/admin/passwords allows admin to create user password with maxStocks limit", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "Test Analyst",
          password: "userpass123",
          maxStocks: 5,
          role: "user",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.password.name).toBe("Test Analyst");
      expect(data.password.max_stocks).toBe(5);
    });

    it("POST /api/indices/stock requires authentication", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indexId: "test-index",
          stock: { ticker: "7203", name: "Toyota", weight: 20 },
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("パスワード認証が必要です");
    });

    it("POST /api/indices/stock allows admin to add constituent stock", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          indexId: "test-index",
          stock: { ticker: "7203", name: "Toyota", weight: 20, theme: "Mobility" },
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.ticker).toBe("7203");
    });

    it("DELETE /api/indices/stock rejects unauthenticated request with 401", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/indices/stock?indexId=test-index&ticker=7203", {
        method: "DELETE",
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(401);
    });

    it("includes PUT in access-control-allow-methods for CORS allowed origins", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/health", {
        headers: { origin: "http://localhost:5173" },
      });
      const res = await worker.fetch(req, env as any);
      const allowMethods = res.headers.get("access-control-allow-methods");
      expect(allowMethods).toBeDefined();
      expect(allowMethods).toContain("PUT");
    });

    it("allows POST /api/calculate with more than 100 basket items (e.g. 175 stocks)", async () => {
      const env = createMockEnv();
      const items = Array.from({ length: 175 }, (_, i) => ({
        ticker: `T${i}`,
        name: `Stock ${i}`,
        weight: 1,
        theme: "Test",
      }));
      const req = new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basket: items,
          baseValue: 1000,
        }),
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.basket).toHaveLength(175);
    });

    it("rejects POST /api/calculate with empty basket", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basket: [],
          baseValue: 1000,
        }),
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid basket");
    });

    it("allows admins to save and calculate an index with more than 100 basket items", async () => {
      const env = createMockEnv();
      const items = Array.from({ length: 101 }, (_, i) => ({
        ticker: `T${i}`,
        name: `Stock ${i}`,
        weight: 1,
        theme: "Test",
      }));
      const adminHeaders = {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      };

      const saveRes = await worker.fetch(
        new Request("http://localhost/api/indices", {
          method: "POST",
          headers: adminHeaders,
          body: JSON.stringify({ id: "admin-large-index", basket: items }),
        }),
        env as any,
      );
      expect(saveRes.status).toBe(200);

      const calculateRes = await worker.fetch(
        new Request("http://localhost/api/calculate", {
          method: "POST",
          headers: adminHeaders,
          body: JSON.stringify({ basket: items, baseValue: 1000 }),
        }),
        env as any,
      );
      expect(calculateRes.status).toBe(200);
      const data = await calculateRes.json();
      expect(data.ok).toBe(true);
      expect(data.basket).toHaveLength(101);
    });

    it("R3: normalizes lowercase tickers to uppercase in POST /api/calculate", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basket: [
            { ticker: "aapl", name: "Apple", weight: 50, theme: "Tech" },
            { ticker: "msft", name: "Microsoft", weight: 50, theme: "Tech" },
          ],
          baseValue: 1000,
        }),
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.basket[0].ticker).toBe("AAPL");
      expect(data.basket[1].ticker).toBe("MSFT");
    });

    it("POST /api/indices gracefully saves index on unmigrated database missing owner_token_hash column", async () => {
      let executedQueryWithLegacyColumns = false;
      const env = {
        ASSETS: { fetch: vi.fn().mockResolvedValue(new Response("Asset")) },
        ADMIN_PASSWORD: "admin-password",
        DB: {
          prepare: vi.fn().mockImplementation((query: string) => ({
            bind: vi.fn().mockImplementation((...params: unknown[]) => ({
              all: vi.fn().mockImplementation(async () => {
                if (query.includes("owner_token_hash")) {
                  throw new Error("D1_ERROR: table indices has no column named owner_token_hash: SQLITE_ERROR");
                }
                if (query.includes("FROM indices WHERE id = ?")) {
                  return { results: [] };
                }
                return { results: [] };
              }),
              run: vi.fn().mockImplementation(async () => {
                if (query.includes("owner_token_hash")) {
                  throw new Error("D1_ERROR: table indices has no column named owner_token_hash: SQLITE_ERROR");
                }
                return { success: true };
              }),
              query,
              params,
            })),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true }),
          })),
          batch: vi.fn().mockImplementation(async (stmts: any[]) => {
            for (const s of stmts) {
              if (s?.query?.includes("owner_token_hash") || s?.query?.includes("created_at")) {
                throw new Error("D1_ERROR: table indices has no column named owner_token_hash: SQLITE_ERROR");
              }
              if (s?.query?.includes("INSERT OR REPLACE INTO indices (id, name, description, base_value, sort_order)")) {
                executedQueryWithLegacyColumns = true;
              }
            }
            return [];
          }),
        },
      };

      const req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-password": "admin-password" },
        body: JSON.stringify({
          id: "unmigrated-index-1",
          name: "Unmigrated Index",
          description: "Testing fallback without owner_token_hash",
          baseValue: 1000,
          basket: [{ ticker: "7203", name: "Toyota", weight: 100, theme: "Auto" }],
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(executedQueryWithLegacyColumns).toBe(true);
      expect(data.ownerToken).toBeUndefined();
    });

    it("DELETE /api/indices finds and deletes index on unmigrated database missing owner_token_hash column", async () => {
      let deleted = false;
      const env = createMockEnv({
        DB: {
          prepare: vi.fn().mockImplementation((query: string) => {
            const exec = async (_params: any[] = []) => {
              if (query.includes("owner_token_hash")) {
                throw new Error("D1_ERROR: table indices has no column named owner_token_hash: SQLITE_ERROR");
              }
              if (query.includes("SELECT id FROM indices WHERE id = ?")) {
                return { results: [{ id: "legacy-index-1" }] };
              }
              if (query.includes("access_passwords")) {
                return {
                  results: [
                    {
                      id: "admin-master",
                      name: "Admin",
                      password_hash: await hashToken("admin-password"),
                      role: "admin",
                      is_active: 1,
                    },
                  ],
                };
              }
              return { results: [] };
            };
            return {
              bind: vi.fn().mockImplementation((...params: any[]) => ({
                all: () => exec(params),
                run: vi.fn().mockImplementation(async () => {
                  if (query.includes("DELETE FROM indices")) deleted = true;
                  return { success: true };
                }),
              })),
              all: () => exec([]),
              run: vi.fn().mockImplementation(async () => {
                if (query.includes("DELETE FROM indices")) deleted = true;
                return { success: true };
              }),
            };
          }),
          batch: vi.fn().mockImplementation(async (_stmts: any[]) => {
            deleted = true;
            return [];
          }),
        },
      });

      const req = new Request("http://localhost/api/indices?id=legacy-index-1", {
        method: "DELETE",
        headers: { "x-auth-password": "admin-password" },
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(deleted).toBe(true);
    });
  });
});
