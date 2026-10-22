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
 *
 * The suite drives the real code paths: the exported helpers are called
 * directly and the admin-login endpoint is exercised through
 * `worker.fetch(request, env)` with a mocked D1, so a broken runtime
 * behaviour fails the suite instead of passing on a source-text match.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  DEFAULT_DEV_ADMIN_SECRET_CODE,
  TURNSTILE_DEFAULT_SECRET_KEY,
  clearAuthCache,
  isLocalHostname,
  isLocalOrTestHost,
  resetPasswordTableEnsured,
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

const TEST_ADMIN_PASSWORD = "test-master-admin-pwd";

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
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
  };
  if (options.adminSecretCode !== undefined) env.ADMIN_SECRET_CODE = options.adminSecretCode;
  return { env, passwords };
}

/** A siteverify answer that accepts the challenge. */
function stubSuccessfulSiteverify(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function adminLoginRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  it("verifies the secret code on the admin-login endpoint", async () => {
    // The endpoint must call the secret-code verification: a wrong code is
    // refused with the Japanese second-factor message, and no administrator
    // session is issued for it.
    const fetchSpy = stubSuccessfulSiteverify();
    const { env } = createEnv({ adminSecretCode: "configured-secret-42" });
    env.TURNSTILE_SECRET_KEY = "real-turnstile-secret";

    const wrongRes = await worker.fetch(
      adminLoginRequest("https://indexforge.test/api/auth/admin-login", {
        password: TEST_ADMIN_PASSWORD,
        secretCode: "wrong-secret-code",
        turnstileToken: "dummy-turnstile-token",
      }),
      env as never,
    );

    expect(wrongRes.status).toBe(401);
    const wrongData = (await wrongRes.json()) as Record<string, unknown>;
    expect(wrongData.ok).toBe(false);
    expect(String(wrongData.error)).toContain("秘密の暗号が正しくありません");
    expect(wrongData.adminToken).toBeUndefined();

    // The Turnstile challenge was really verified before the secret code.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
  });

  it("accepts the configured secret code and issues an administrator session", async () => {
    stubSuccessfulSiteverify();
    const { env } = createEnv({ adminSecretCode: "configured-secret-42" });
    env.TURNSTILE_SECRET_KEY = "real-turnstile-secret";

    const res = await worker.fetch(
      adminLoginRequest("https://indexforge.test/api/auth/admin-login", {
        password: TEST_ADMIN_PASSWORD,
        secretCode: "configured-secret-42",
        turnstileToken: "dummy-turnstile-token",
      }),
      env as never,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.role).toBe("admin");
    // SEC-01: the successful login is what issues the `x-admin-session`
    // credential every privileged endpoint requires.
    expect(typeof data.adminToken).toBe("string");
    expect(String(data.adminToken).length).toBeGreaterThan(0);
  });

  it("accepts the committed development code on a local host", async () => {
    // The host classification is what decides whether the committed
    // development code may be used at all, and a local host is a context in
    // which it is allowed.
    stubSuccessfulSiteverify();
    const { env } = createEnv();
    env.TURNSTILE_SECRET_KEY = "real-turnstile-secret";

    const res = await worker.fetch(
      adminLoginRequest("http://localhost/api/auth/admin-login", {
        password: TEST_ADMIN_PASSWORD,
        secretCode: DEFAULT_DEV_ADMIN_SECRET_CODE,
        turnstileToken: "dummy-turnstile-token",
      }),
      env as never,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.role).toBe("admin");
  });

  it("gives the siteverify round-trip a 5 second deadline", async () => {
    // The siteverify call is the only external request without a deadline
    // otherwise; a hung connection would hold the admin-login request open
    // indefinitely. The deadline is asserted on the call arguments, because
    // the abort itself only becomes observable after five seconds.
    stubSuccessfulSiteverify();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    const res = await verifyTurnstileToken(
      "real-secret-key",
      "any-token",
      "203.0.113.7",
      false,
    );

    expect(res.success).toBe(true);
    expect(timeoutSpy).toHaveBeenCalledWith(5000);

    const fetchSpy = vi.mocked(globalThis.fetch);
    const init = fetchSpy.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal).toBe(timeoutSpy.mock.results[0].value);
  });

  it("derives the development-default permission from the request host (static contract)", () => {
    // Static contract: the admin-login handler must derive the
    // "development defaults are allowed" flag from the request's host instead
    // of hard-coding it, so that the committed development code and the
    // always-passing Turnstile test secret are refused on a public host.
    //
    // There is no runtime counterpart for the *refusal* half of this
    // contract: the unit-test runtime is itself a development context, so
    // `isLocalOrTestHost()` is true for every host here and both branches
    // behave identically. The observable halves are covered elsewhere: the
    // endpoint refuses a wrong secret code and accepts the configured one
    // (above), the committed development code is accepted on a local host
    // (above), and the host classification itself is asserted by
    // `isLocalHostname` / `isLocalOrTestHost` (first describe block).
    const source = readFileSync(resolve(process.cwd(), "worker/internal-impl.ts"), "utf8");

    // W-01: 呼び出し境界は分類情報を持つ verifyAdminSecretCodeDetailed を使う。
    const secretCodeCall = source.indexOf("verifyAdminSecretCodeDetailed(\n            env,");
    expect(secretCodeCall).toBeGreaterThan(0);
    expect(source.slice(secretCodeCall, secretCodeCall + 220)).toContain(
      "isLocalOrTestHost(url.hostname)",
    );
  });
});
