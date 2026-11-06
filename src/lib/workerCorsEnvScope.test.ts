import { describe, expect, it } from "vitest";
import worker from "../../worker/index";
import {
  json,
  notModified,
  requestEnvScope,
  type Env,
} from "../../worker/internal-impl";

function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    DB: {} as unknown as Env["DB"],
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    ALLOWED_ORIGINS: "https://dashboard.example.com, https://app.custom-domain.org",
    ...overrides,
  };
}

describe("Worker CORS env propagation via requestEnvScope", () => {
  it("emits CORS headers for allowed production origins on 200 JSON responses", async () => {
    const env = createMockEnv();
    const req = new Request("https://worker.internal/api/health", {
      method: "GET",
      headers: {
        Origin: "https://dashboard.example.com",
      },
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://dashboard.example.com");
    expect(res.headers.get("vary")).toBe("Origin");
    const body = await res.json() as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
  });

  it("does not emit CORS allow-origin header for unauthorized origins", async () => {
    const env = createMockEnv();
    const req = new Request("https://worker.internal/api/health", {
      method: "GET",
      headers: {
        Origin: "https://malicious-attacker.com",
      },
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("permits local development origins even when ALLOWED_ORIGINS is not set", async () => {
    const env = createMockEnv({ ALLOWED_ORIGINS: undefined });
    const req = new Request("https://worker.internal/api/health", {
      method: "GET",
      headers: {
        Origin: "http://localhost:5173",
      },
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("propagates env to notModified responses via requestEnvScope", () => {
    const env = createMockEnv();
    const req = new Request("https://worker.internal/api/snapshot", {
      headers: {
        Origin: "https://app.custom-domain.org",
      },
    });
    requestEnvScope.set(req, env);

    const res = notModified(req, { etag: '"test-etag"' });
    expect(res.status).toBe(304);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.custom-domain.org");
    expect(res.headers.get("etag")).toBe('"test-etag"');
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("propagates env to json helper when env argument is omitted", () => {
    const env = createMockEnv();
    const req = new Request("https://worker.internal/api/custom-endpoint", {
      headers: {
        Origin: "https://dashboard.example.com",
      },
    });
    requestEnvScope.set(req, env);

    const res = json({ hello: "world" }, 200, req);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://dashboard.example.com");
  });
});
