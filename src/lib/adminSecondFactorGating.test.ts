/**
 * Regression tests for the admin second-factor gating.
 *
 * Two development conveniences were reachable from production before:
 *
 * 1. `DEFAULT_DEV_ADMIN_SECRET_CODE` is committed to the repository, so on a
 *    deployment without `ADMIN_SECRET_CODE` the "secret" second factor was a
 *    publicly known constant.
 * 2. `TURNSTILE_DEFAULT_SECRET_KEY` is Cloudflare's official always-passing
 *    test secret, so without `TURNSTILE_SECRET_KEY` the CAPTCHA accepted any
 *    token (Cloudflare documents it as "Always passes validation":
 *    https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
 *
 * Both now work only on local/test hosts; anywhere else the Worker fails
 * closed with an actionable message.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DEV_ADMIN_SECRET_CODE,
  TURNSTILE_DEFAULT_SECRET_KEY,
  isLocalHostname,
  isLocalOrTestHost,
  verifyAdminSecretCode,
  verifyTurnstileToken,
} from "../../worker/internal";

interface PasswordRecord {
  id: string;
  name: string;
  password_hash?: string | null;
  secret_code_hash?: string | null;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

function createEnv(options: {
  adminSecretCode?: string;
  breakSecretCodeLookup?: boolean;
} = {}) {
  const passwords = new Map<string, PasswordRecord>();

  const run = async (_query: string, _params: unknown[] = []) => ({ meta: { changes: 1 } });
  const all = async (query: string, _params: unknown[] = []) => {
    if (query.includes("secret_code_hash FROM access_passwords")) {
      if (options.breakSecretCodeLookup) throw new Error("D1 is unavailable");
      const master = passwords.get("admin-master");
      return { results: master ? [master] : [] };
    }
    if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
      const master = passwords.get("admin-master");
      return { results: master ? [master] : [] };
    }
    return { results: [] };
  };

  const env: Record<string, unknown> = {
    DB: {
      prepare: (query: string) => ({
        bind: () => ({ all: () => all(query), run: () => run(query) }),
        all: () => all(query),
        run: () => run(query),
      }),
    },
    ADMIN_PASSWORD: "test-master-admin-pwd",
  };
  if (options.adminSecretCode !== undefined) env.ADMIN_SECRET_CODE = options.adminSecretCode;
  return { env, passwords };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("host classification for development defaults", () => {
  it("isLocalHostname accepts local development hosts only", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("[::1]")).toBe(true);
    expect(isLocalHostname("localhost:8787")).toBe(true);

    expect(isLocalHostname("example.com")).toBe(false);
    expect(isLocalHostname("indexforge.example.workers.dev")).toBe(false);
    expect(isLocalHostname("")).toBe(false);
  });

  it("isLocalOrTestHost also admits the unit-test runtime (existing suites log in from any host)", () => {
    // The endpoint-level suites address the Worker as https://indexforge.test/,
    // so the handler flag must stay permissive under vitest while remaining a
    // pure host check in production.
    expect(isLocalOrTestHost("indexforge.test")).toBe(true);
  });
});

describe("verifyAdminSecretCode gating", () => {
  it("rejects the committed development code on a non-local host when nothing is configured", async () => {
    const { env } = createEnv();

    expect(await verifyAdminSecretCode(env as never, DEFAULT_DEV_ADMIN_SECRET_CODE, false)).toBe(
      false,
    );
    expect(await verifyAdminSecretCode(env as never, "wrong-code", false)).toBe(false);
  });

  it("still accepts the development code where development defaults are allowed", async () => {
    const { env } = createEnv();

    expect(await verifyAdminSecretCode(env as never, DEFAULT_DEV_ADMIN_SECRET_CODE, true)).toBe(
      true,
    );
  });

  it("accepts an explicitly configured env secret on any host", async () => {
    const { env } = createEnv({ adminSecretCode: "configured-secret-42" });

    expect(await verifyAdminSecretCode(env as never, "configured-secret-42", false)).toBe(true);
    expect(await verifyAdminSecretCode(env as never, DEFAULT_DEV_ADMIN_SECRET_CODE, false)).toBe(
      false,
    );
  });

  it("fails closed when the D1 lookup errors instead of falling back to the public default", async () => {
    const { env } = createEnv({ breakSecretCodeLookup: true });

    // allowDevDefault=true (the old behaviour was to fall through to the
    // default code on any D1 error) must not resurrect a bypass.
    expect(await verifyAdminSecretCode(env as never, DEFAULT_DEV_ADMIN_SECRET_CODE, true)).toBe(
      false,
    );
  });
});

describe("verifyTurnstileToken gating", () => {
  it("rejects every token when only the always-passing test secret is available in production", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const withDefaultSecret = await verifyTurnstileToken(
      undefined,
      "dummy-turnstile-token",
      undefined,
      false,
    );
    const withTestSecret = await verifyTurnstileToken(
      TURNSTILE_DEFAULT_SECRET_KEY,
      "XXXX.DUMMY.TOKEN.XXXX",
      undefined,
      false,
    );

    expect(withDefaultSecret.success).toBe(false);
    expect(withDefaultSecret.error).toContain("Turnstileが未設定");
    expect(withTestSecret.success).toBe(false);
    // No siteverify round-trip is attempted for an unusable configuration.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the documented development behaviour when test keys are allowed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const res = await verifyTurnstileToken(
      TURNSTILE_DEFAULT_SECRET_KEY,
      "dummy-turnstile-token",
      undefined,
      true,
    );
    expect(res.success).toBe(true);
  });

  it("does not treat a network failure as success for a real secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("siteverify unreachable")),
    );

    const res = await verifyTurnstileToken("real-secret-key", "any-token", undefined, false);
    expect(res.success).toBe(false);
    expect(res.error).toContain("通信エラー");
  });
});

describe("admin-login wiring", () => {
  const source = readFileSync(resolve(process.cwd(), "worker/internal-impl.ts"), "utf8");

  it("derives the development-default permission from the request host", () => {
    const turnstileCall = source.indexOf("verifyTurnstileToken(");
    const secretCodeCall = source.indexOf("verifyAdminSecretCode(\n            env,");
    expect(turnstileCall).toBeGreaterThan(0);
    expect(secretCodeCall).toBeGreaterThan(0);
    expect(source.slice(secretCodeCall, secretCodeCall + 220)).toContain(
      "isLocalOrTestHost(url.hostname)",
    );
    // The siteverify request must carry a deadline like every other external call.
    expect(source).toContain('signal: AbortSignal.timeout(5000)');
  });
});
