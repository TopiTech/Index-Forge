import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, it, expect, vi } from "vitest";
import worker from "../../worker/index";
import { clearAuthCache, resetPasswordTableEnsured } from "../../worker/internal";

const TEST_ADMIN_PASSWORD = "test-admin-password";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

function createMockEnv() {
  const prepare = vi.fn().mockImplementation((query: string) => {
    return {
      bind: vi.fn().mockImplementation(() => ({
        all: async () => {
          if (query.includes("rate_limits")) return { results: [] };
          return { results: [] };
        },
        run: async () => ({ success: true }),
      })),
      all: async () => {
        if (query.includes("rate_limits")) return { results: [] };
        return { results: [] };
      },
      run: async () => ({ success: true }),
    };
  });

  return {
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response("Asset", { status: 200 })),
    },
    DB: {
      prepare,
      batch: vi.fn().mockResolvedValue([]),
    },
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
  };
}

describe("review hardening: production asset pipeline", () => {
  it("run_worker_first must be enabled so the Worker applies security headers to static assets", () => {
    // With the previous `run_worker_first: ["/api/*"]` form, asset-matching
    // requests (including the SPA entry index.html) were served directly by
    // the Cloudflare asset layer without ever invoking the Worker, silently
    // dropping the CSP/X-Frame-Options/no-cache headers in production.
    const configPath = join(
      fileURLToPath(new URL("../../", import.meta.url)),
      "wrangler.jsonc",
    );
    const config = readFileSync(configPath, "utf-8");
    const runWorkerFirstMatch = config.match(/"run_worker_first"\s*:\s*([^,\n}]+)/);
    expect(runWorkerFirstMatch).not.toBeNull();
    expect(runWorkerFirstMatch![1].trim()).toBe("true");
  });

  it("marks HTML responses as no-cache by Content-Type, not by path", async () => {
    // SPA fallback (not_found_handling: single-page-application) serves
    // index.html for arbitrary deep links such as /admin, so a path check
    // misses them and stale HTML could be cached by shared caches.
    const env = createMockEnv();
    env.ASSETS.fetch = vi.fn().mockResolvedValue(
      new Response("<!doctype html><html></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const res = await worker.fetch(new Request("http://localhost/admin"), env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
  });

  it("keeps immutable long-term caching for hashed /assets/* files", async () => {
    const env = createMockEnv();
    env.ASSETS.fetch = vi.fn().mockResolvedValue(
      new Response("console.log('x')", {
        status: 200,
        headers: { "content-type": "application/javascript" },
      }),
    );

    const res = await worker.fetch(
      new Request("http://localhost/assets/index-DAfVT__E.js"),
      env as any,
    );
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("does not long-cache un-hashed public assets (asset-error-recovery.js)", async () => {
    // index.html loads /asset-error-recovery.js with a stable path. If it were
    // cached for a year, a deploy that changes it would not reach clients.
    const env = createMockEnv();
    env.ASSETS.fetch = vi.fn().mockResolvedValue(
      new Response("console.log('recovery')", {
        status: 200,
        headers: { "content-type": "application/javascript" },
      }),
    );

    const res = await worker.fetch(
      new Request("http://localhost/asset-error-recovery.js"),
      env as any,
    );
    const cacheControl = res.headers.get("Cache-Control") || "";
    expect(cacheControl).not.toBe("public, max-age=31536000, immutable");
  });
});

describe("review hardening: separated auth rate-limit buckets", () => {
  it("uses auth-api for protected requests after using auth-login for verification", async () => {
    const env = createMockEnv();
    const rateLimitBuckets: string[] = [];
    env.DB.prepare = vi.fn().mockImplementation((query: string) => ({
      bind: (...params: unknown[]) => ({
        all: async () => ({ results: [] }),
        run: async () => {
          if (query.includes("INSERT INTO rate_limits")) {
            rateLimitBuckets.push(String(params[1]));
          }
          return { success: true };
        },
      }),
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
    }));

    await worker.fetch(
      new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" }),
      }),
      env as any,
    );
    await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
      }),
      env as any,
    );

    expect(rateLimitBuckets).toContain("auth-login");
    expect(rateLimitBuckets).toContain("auth-api");
  });

  it("still fails closed when the auth login rate-limit table is unavailable", async () => {
    const env = createMockEnv();
    const defaultPrepare = env.DB.prepare;
    env.DB.prepare = vi.fn().mockImplementation((query: string) => {
      if (query.includes("rate_limits")) {
        throw new Error("rate-limit table unavailable");
      }
      return defaultPrepare(query);
    });

    const res = await worker.fetch(
      new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
      }),
      env as any,
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("認証試行回数");
  });
});
