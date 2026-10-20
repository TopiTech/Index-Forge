// @vitest-environment jsdom
/**
 * Japanese secret code (Hiragana/Katakana) support for the administrator
 * second factor, and the UI surfaces that collect it.
 *
 * The suite drives the real code paths: the Worker's secret-code and
 * Turnstile helpers are called directly, the admin endpoints are exercised
 * through `worker.fetch(request, env)` with a mocked D1, and the three login
 * surfaces are rendered and driven through the DOM. A broken runtime
 * behaviour therefore fails the suite instead of passing on a source-text
 * match.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import worker from "../../worker/index";
import {
  clearAuthCache,
  resetPasswordTableEnsured,
  setAllowPasswordAdminFallbackForTests,
  hashPassword,
  TURNSTILE_DEFAULT_SECRET_KEY,
  verifyTurnstileToken,
  verifyAdminSecretCode,
} from "../../worker/internal";
import { AuthModal } from "../components/AuthModal";
import { PortfolioManagerPage } from "../components/PortfolioManagerPage";
import { AdminDashboard } from "../components/AdminDashboard";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { ToastProvider } from "../components/Toast";

const HIRAGANA_SECRET_CODE = "ひみつの暗号２０２６";
const KATAKANA_SECRET_CODE = "スーパーシークレットパス";
const TEST_ADMIN_PASSWORD = "test-master-admin-pwd-2026";

/**
 * A secret code that really differs between the two Unicode forms.
 *
 * `HIRAGANA_SECRET_CODE` contains no combining character, so its NFD and NFC
 * forms are identical. "が" does decompose, which makes the normalization
 * observable.
 */
const DECOMPOSABLE_SECRET_CODE = "ひみつの暗号が2026";

interface AttemptRecord {
  ip: string;
  failed_count: number;
  last_failed_at: number;
  locked_until: number;
}

interface PasswordRecord {
  id: string;
  name: string;
  password_hash: string;
  secret_code_hash?: string | null;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices?: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

interface SessionRecord {
  token_hash: string;
  account_id: string;
  expires_at: number;
}

function createJapaneseSecretTestEnv(options: { adminSecretCode?: string } = {}) {
  const attempts = new Map<string, AttemptRecord>();
  const passwords = new Map<string, PasswordRecord>();
  const sessions = new Map<string, SessionRecord>();

  const executeAll = async (query: string, params: unknown[] = []) => {
    if (query.includes("FROM admin_login_attempts WHERE ip = ?")) {
      const ip = params[0] as string;
      const row = attempts.get(ip);
      return { results: row ? [row] : [] };
    }
    if (query.includes("FROM admin_sessions")) {
      // The Worker looks the session up by the SHA-256 of the presented
      // token, so the mock only ever sees the hash.
      const session = sessions.get(params[0] as string);
      if (!session) return { results: [] };
      const master = passwords.get("admin-master");
      return {
        results: [
          {
            account_id: session.account_id,
            expires_at: session.expires_at,
            name: master?.name ?? "管理者",
            role: "admin",
            is_active: 1,
            max_stocks: null,
            max_indices: null,
          },
        ],
      };
    }
    if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
      const master = passwords.get("admin-master");
      return { results: master ? [master] : [] };
    }
    if (query.includes("FROM access_passwords WHERE is_active = 1 AND id != 'admin-master'")) {
      return { results: [] };
    }
    return { results: [] };
  };

  const executeRun = async (query: string, params: unknown[] = []) => {
    if (query.includes("INSERT INTO admin_login_attempts")) {
      const [ip, failed, last, locked] = params as [string, number, number, number];
      const existing = attempts.get(ip);
      if (existing) {
        existing.failed_count = (existing.failed_count || 0) + 1;
        existing.last_failed_at = last;
        existing.locked_until = locked;
      } else {
        attempts.set(ip, {
          ip,
          failed_count: failed,
          last_failed_at: last,
          locked_until: locked,
        });
      }
      return { success: true };
    }
    if (query.includes("DELETE FROM admin_login_attempts WHERE ip = ?")) {
      const ip = params[0] as string;
      attempts.delete(ip);
      return { success: true };
    }
    if (query.includes("INSERT OR REPLACE INTO admin_sessions")) {
      const [tokenHash, accountId, , expiresAt] = params as [string, string, number, number];
      sessions.set(tokenHash, { token_hash: tokenHash, account_id: accountId, expires_at: expiresAt });
      return { success: true };
    }
    if (query.includes("INSERT INTO access_passwords") || query.includes("UPDATE access_passwords")) {
      if (query.includes("id = 'admin-master'")) {
        const existing = passwords.get("admin-master");
        if (existing) {
          if (params[0] && typeof params[0] === "string") {
            existing.secret_code_hash = params[0];
          }
        }
      }
      return { success: true };
    }
    return { success: true };
  };

  return {
    env: {
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      ADMIN_SECRET_CODE: options.adminSecretCode ?? HIRAGANA_SECRET_CODE,
      TURNSTILE_SITE_KEY: "test-site-key",
      TURNSTILE_SECRET_KEY: TURNSTILE_DEFAULT_SECRET_KEY,
      DB: {
        prepare: (query: string) => ({
          bind: (...params: unknown[]) => ({
            all: () => executeAll(query, params),
            run: () => executeRun(query, params),
            first: async () => {
              const res = await executeAll(query, params);
              return res.results?.[0] || null;
            },
          }),
          all: () => executeAll(query),
          run: () => executeRun(query),
          first: async () => {
            const res = await executeAll(query);
            return res.results?.[0] || null;
          },
        }),
      },
    },
    attempts,
    passwords,
    sessions,
  };
}

/**
 * Node's WebCrypto for the jsdom environment.
 *
 * jsdom ships `crypto.getRandomValues` but no SubtleCrypto, and the Worker
 * hashes every credential with PBKDF2/SHA-256. Node built-ins cannot be
 * imported from a jsdom suite (Vite externalizes them for the browser), but
 * the running process can still hand out its own modules.
 */
function installNodeWebCrypto(): void {
  const proc = (
    globalThis as {
      process?: { getBuiltinModule?: (id: string) => unknown };
    }
  ).process;
  const nodeCrypto = proc?.getBuiltinModule?.("crypto") as
    | { webcrypto?: Crypto }
    | undefined;
  if (nodeCrypto?.webcrypto) {
    vi.stubGlobal("crypto", nodeCrypto.webcrypto);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The answers the browser-side code gets from the Worker.
 *
 * The suite never reaches the network: the siteverify challenge always
 * succeeds, the Turnstile configuration reports a known site key, and the
 * administrator login is refused (the login surfaces stay on their login
 * form, which is what the UI assertions below are about).
 */
const fetchControl: { adminLogin: () => Response } = {
  adminLogin: () => jsonResponse({ ok: false, error: "管理者パスワードが正しくありません" }, 401),
};

function installFetchDouble(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("siteverify")) return jsonResponse({ success: true });
    if (url.includes("/api/auth/turnstile-config")) return jsonResponse({ siteKey: "config-site-key" });
    if (url.includes("/api/auth/admin-login")) return fetchControl.adminLogin();
    return jsonResponse({}, 503);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

interface TurnstileDouble {
  render: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

/**
 * A Turnstile double.
 *
 * The real widget loads an external script and polls for the challenge;
 * neither belongs in a unit test. The double answers the challenge
 * immediately (or fails on demand) and records what the widget asked for.
 */
function installTurnstileDouble(options: { renderThrows?: boolean } = {}): TurnstileDouble {
  const render = vi.fn(
    (
      _container: HTMLElement | string,
      params: { sitekey: string; callback?: (token: string) => void },
    ): string => {
      if (options.renderThrows) throw new Error("turnstile render failed");
      params.callback?.("test-turnstile-token");
      return "turnstile-widget-id";
    },
  );
  const reset = vi.fn();
  const remove = vi.fn();
  window.turnstile = { render, reset, remove };
  return { render, reset, remove };
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}

async function renderAuthModal(): Promise<void> {
  await act(async () => {
    render(createElement(AuthModal, { isOpen: true, onClose: () => {} }));
  });
}

async function renderPortfolioManagerPage(): Promise<void> {
  await act(async () => {
    render(
      createElement(
        ToastProvider,
        null,
        createElement(PortfolioManagerPage, {
          onNavigate: () => {},
          onOpenStockDetail: () => {},
        }),
      ),
    );
  });
}

async function renderAdminDashboard(): Promise<void> {
  await act(async () => {
    render(
      createElement(
        ToastProvider,
        null,
        createElement(AdminDashboard, {
          indices: [],
          onBackToApp: () => {},
          onRefreshIndices: async () => {},
          saveCustomIndex: async () => ({ ok: true }),
          deleteCustomIndex: async () => ({ ok: true }),
        }),
      ),
    );
  });
}

/** The body the client sent to `/api/auth/admin-login`. */
function adminLoginBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((entry) =>
    String(entry[0]).includes("/api/auth/admin-login"),
  );
  if (!call) throw new Error("the administrator login was never requested");
  return JSON.parse(String(call[1]?.body ?? "{}")) as Record<string, unknown>;
}

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
  setAllowPasswordAdminFallbackForTests(null);
  installNodeWebCrypto();
  installFetchDouble();
  installTurnstileDouble();
  fetchControl.adminLogin = () =>
    jsonResponse({ ok: false, error: "管理者パスワードが正しくありません" }, 401);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAllowPasswordAdminFallbackForTests(null);
  delete (window as { turnstile?: unknown }).turnstile;
});

describe("Japanese Hiragana and Katakana Support for Admin Secret Code & UI Authentication", () => {
  describe("1. Backend Secret Code Verification with Hiragana & Katakana", () => {
    it("verifies secret code correctly in Hiragana", async () => {
      const { env } = createJapaneseSecretTestEnv();
      const isValid = await verifyAdminSecretCode(env as never, HIRAGANA_SECRET_CODE);
      expect(isValid).toBe(true);

      const isWrong = await verifyAdminSecretCode(env as never, "ちがうあんごう");
      expect(isWrong).toBe(false);
    });

    it("verifies secret code correctly even with NFD/NFC Unicode normalization differences", async () => {
      const { env } = createJapaneseSecretTestEnv();
      // Test with decomposed NFD (e.g., が as か + dakuten)
      const nfdHiragana = HIRAGANA_SECRET_CODE.normalize("NFD");
      const isValidNFD = await verifyAdminSecretCode(env as never, nfdHiragana);
      expect(isValidNFD).toBe(true);

      // The same holds for a code that really differs between the two forms:
      // the verification normalizes the input before it compares it.
      const { env: decomposableEnv } = createJapaneseSecretTestEnv({
        adminSecretCode: DECOMPOSABLE_SECRET_CODE,
      });
      const nfd = DECOMPOSABLE_SECRET_CODE.normalize("NFD");
      expect(nfd).not.toBe(DECOMPOSABLE_SECRET_CODE.normalize("NFC"));
      expect(await verifyAdminSecretCode(decomposableEnv as never, nfd)).toBe(true);
    });

    it("supports Katakana secret codes stored in D1 password record", async () => {
      const { env, passwords } = createJapaneseSecretTestEnv();
      const katakanaHash = await hashPassword(KATAKANA_SECRET_CODE);
      passwords.set("admin-master", {
        id: "admin-master",
        name: "マスター管理者",
        password_hash: await hashPassword(TEST_ADMIN_PASSWORD),
        secret_code_hash: katakanaHash,
        role: "admin",
        max_stocks: null,
        is_active: 1,
        created_at: 1000,
        updated_at: 1000,
      });

      const isValidKatakana = await verifyAdminSecretCode(env as never, KATAKANA_SECRET_CODE);
      expect(isValidKatakana).toBe(true);

      // NFD variant should also match
      expect(await verifyAdminSecretCode(env as never, KATAKANA_SECRET_CODE.normalize("NFD"))).toBe(
        true,
      );
      expect(await verifyAdminSecretCode(env as never, "ちがうカタカナ")).toBe(false);
    });

    it("authenticates via /api/auth/admin-login using Hiragana secret code", async () => {
      const { env } = createJapaneseSecretTestEnv();
      const req = new Request("https://indexforge.test/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: HIRAGANA_SECRET_CODE,
          turnstileToken: "dummy-turnstile-token",
        }),
      });

      const res = await worker.fetch(req, env as never);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.ok).toBe(true);
      expect(data.role).toBe("admin");
      // SEC-01: the login issues the session token the admin API requires.
      expect(typeof data.adminToken).toBe("string");
      expect(String(data.adminToken).length).toBeGreaterThan(0);
    });

    it("issues an x-admin-session token that the admin endpoints accept", async () => {
      const { env } = createJapaneseSecretTestEnv();

      const loginRes = await worker.fetch(
        new Request("https://indexforge.test/api/auth/admin-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: TEST_ADMIN_PASSWORD,
            secretCode: HIRAGANA_SECRET_CODE,
            turnstileToken: "dummy-turnstile-token",
          }),
        }),
        env as never,
      );
      expect(loginRes.status).toBe(200);
      const loginData = (await loginRes.json()) as Record<string, unknown>;
      const adminToken = String(loginData.adminToken);
      expect(adminToken.length).toBeGreaterThan(0);

      // The session token alone authorises a privileged call.
      const withSession = await worker.fetch(
        new Request("https://indexforge.test/api/admin/passwords", {
          headers: { "x-admin-session": adminToken },
        }),
        env as never,
      );
      expect(withSession.status).toBe(200);

      // The password alone does not (SEC-01). The Worker keeps a test-only
      // fallback for the pre-existing suite, so it is switched off here to
      // observe the production behaviour.
      setAllowPasswordAdminFallbackForTests(false);
      const withPasswordOnly = await worker.fetch(
        new Request("https://indexforge.test/api/admin/passwords", {
          headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
        }),
        env as never,
      );
      expect(withPasswordOnly.status).toBe(403);
    });

    it("verifies Turnstile tokens and rejects empty or missing tokens", async () => {
      const emptyRes = await verifyTurnstileToken(TURNSTILE_DEFAULT_SECRET_KEY, "");
      expect(emptyRes.success).toBe(false);
      expect(emptyRes.error).toContain("Turnstile認証トークンが指定されていません");

      const undefinedRes = await verifyTurnstileToken(TURNSTILE_DEFAULT_SECRET_KEY, undefined);
      expect(undefinedRes.success).toBe(false);
      expect(undefinedRes.error).toContain("Turnstile認証トークンが指定されていません");

      const dummyRes = await verifyTurnstileToken(
        TURNSTILE_DEFAULT_SECRET_KEY,
        "dummy-turnstile-token",
      );
      expect(dummyRes.success).toBe(true);

      const testTokenRes = await verifyTurnstileToken(TURNSTILE_DEFAULT_SECRET_KEY, "test-token");
      expect(testTokenRes.success).toBe(true);
    });

    it("enforces current secret code requirement when updating admin secret code via PUT /api/admin/admin-secret-code", async () => {
      const { env } = createJapaneseSecretTestEnv();

      // The privileged call is authorised by the administrator session that
      // `/api/auth/admin-login` issues (SEC-01).
      const loginRes = await worker.fetch(
        new Request("https://indexforge.test/api/auth/admin-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: TEST_ADMIN_PASSWORD,
            secretCode: HIRAGANA_SECRET_CODE,
            turnstileToken: "dummy-turnstile-token",
          }),
        }),
        env as never,
      );
      expect(loginRes.status).toBe(200);
      const loginData = (await loginRes.json()) as Record<string, unknown>;
      const adminToken = String(loginData.adminToken);
      const adminHeaders = {
        "Content-Type": "application/json",
        "x-admin-session": adminToken,
      };

      // Missing currentSecretCode should return 400
      const missingCurrentReq = new Request("https://indexforge.test/api/admin/admin-secret-code", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({
          newSecretCode: "new-super-secret-2026",
        }),
      });
      const missingRes = await worker.fetch(missingCurrentReq, env as never);
      expect(missingRes.status).toBe(400);
      const missingData = (await missingRes.json()) as Record<string, unknown>;
      expect(missingData.error).toContain("現在の秘密の暗号を入力してください");

      // Wrong currentSecretCode should return 401
      const wrongCurrentReq = new Request("https://indexforge.test/api/admin/admin-secret-code", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({
          currentSecretCode: "まちがったあんごう",
          newSecretCode: "new-super-secret-2026",
        }),
      });
      const wrongRes = await worker.fetch(wrongCurrentReq, env as never);
      expect(wrongRes.status).toBe(401);
      const wrongData = (await wrongRes.json()) as Record<string, unknown>;
      expect(wrongData.error).toContain("現在の秘密の暗号が正しくありません");

      // Correct currentSecretCode should return 200
      const validReq = new Request("https://indexforge.test/api/admin/admin-secret-code", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({
          currentSecretCode: HIRAGANA_SECRET_CODE,
          newSecretCode: "new-super-secret-2026",
        }),
      });
      const validRes = await worker.fetch(validReq, env as never);
      expect(validRes.status).toBe(200);
      const validData = (await validRes.json()) as Record<string, unknown>;
      expect(validData.ok).toBe(true);

      // Without the session token the very same call is refused (SEC-01).
      setAllowPasswordAdminFallbackForTests(false);
      const refusedRes = await worker.fetch(
        new Request("https://indexforge.test/api/admin/admin-secret-code", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-auth-password": TEST_ADMIN_PASSWORD,
          },
          body: JSON.stringify({
            currentSecretCode: HIRAGANA_SECRET_CODE,
            newSecretCode: "new-super-secret-2026",
          }),
        }),
        env as never,
      );
      expect(refusedRes.status).toBe(403);
    });
  });

  describe("2. UI Component Contracts: AuthModal", () => {
    it("renders the Turnstile widget in AuthModal with the configured site key", async () => {
      const turnstile = installTurnstileDouble();
      await renderAuthModal();

      // The widget is mounted ...
      expect(screen.getByLabelText("Turnstile ウィジェット表示領域")).toBeTruthy();
      // ... with the site key the configuration endpoint reported.
      expect(turnstile.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sitekey: "config-site-key" }),
      );
    });

    it("resets the Turnstile widget after a failed administrator login", async () => {
      const turnstile = installTurnstileDouble();
      await renderAuthModal();

      fireEvent.change(query<HTMLInputElement>("#auth-modal-password-input"), {
        target: { value: "管理者パスワード" },
      });
      fireEvent.change(query<HTMLInputElement>("#auth-modal-secret-code-input"), {
        target: { value: HIRAGANA_SECRET_CODE },
      });
      const submit = query<HTMLButtonElement>('#auth-modal-form button[type="submit"]');
      expect(submit.disabled).toBe(false);

      await act(async () => {
        fireEvent.click(submit);
      });

      // The solved challenge is discarded so a new one has to be solved.
      expect(turnstile.reset).toHaveBeenCalled();
      // ... and the failure is reported to the operator.
      expect(screen.getByRole("alert").textContent).toContain("管理者パスワードが正しくありません");
    });

    it("renders secret code input with full Hiragana/Katakana IME support", async () => {
      await renderAuthModal();

      const input = query<HTMLInputElement>("#auth-modal-secret-code-input");
      expect(input.getAttribute("inputmode")).toBe("text");
      expect(input.getAttribute("lang")).toBe("ja");
      // The code is masked until the operator asks for it.
      expect((input.style as unknown as Record<string, unknown>).WebkitTextSecurity).toBe("disc");

      // The hint names both syllabaries.
      expect(screen.getByText(/ひらがな.*カタカナ/).textContent).toMatch(/ひらがな.*カタカナ/);

      fireEvent.click(screen.getByRole("button", { name: "秘密の暗号を表示" }));
      expect((input.style as unknown as Record<string, unknown>).WebkitTextSecurity).toBe("none");
    });

    it("provides admin and user authentication mode controls", async () => {
      await renderAuthModal();

      // UI-13: both modes share one form, so the switch is a named group of
      // toggle buttons (`aria-pressed`), not a `role="tablist"` whose tabs
      // would claim to control a tabpanel that does not exist.
      const group = screen.getByRole("group", { name: "認証モード切替" });
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("tab")).toBeNull();

      const adminButton = within(group).getByRole("button", { name: /管理者ログイン/ });
      const userButton = within(group).getByRole("button", { name: /一般ユーザー/ });
      expect(document.getElementById("auth-modal-mode-admin")).not.toBeNull();
      expect(document.getElementById("auth-modal-mode-user")).not.toBeNull();
      expect(adminButton.getAttribute("aria-pressed")).toBe("true");
      expect(userButton.getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(userButton);
      expect(adminButton.getAttribute("aria-pressed")).toBe("false");
      expect(userButton.getAttribute("aria-pressed")).toBe("true");

      // The Japanese labels of the two modes are unchanged.
      expect(adminButton.textContent).toContain("管理者ログイン");
      expect(userButton.textContent).toContain("一般ユーザー");
    });

    it("normalizes secret code to NFC on submission", async () => {
      const fetchMock = installFetchDouble();
      await renderAuthModal();

      const nfd = DECOMPOSABLE_SECRET_CODE.normalize("NFD");
      fireEvent.change(query<HTMLInputElement>("#auth-modal-password-input"), {
        target: { value: "管理者パスワード" },
      });
      fireEvent.change(query<HTMLInputElement>("#auth-modal-secret-code-input"), {
        target: { value: nfd },
      });
      const submit = query<HTMLButtonElement>('#auth-modal-form button[type="submit"]');
      expect(submit.disabled).toBe(false);

      await act(async () => {
        fireEvent.click(submit);
      });

      const body = adminLoginBody(fetchMock);
      expect(body.secretCode).toBe(DECOMPOSABLE_SECRET_CODE.normalize("NFC"));
      expect(body.secretCode).not.toBe(nfd);
    });
  });

  describe("3. UI Component Contracts: PortfolioManagerPage", () => {
    it("renders the Turnstile widget in the PortfolioManagerPage auth gate", async () => {
      const turnstile = installTurnstileDouble();
      await renderPortfolioManagerPage();

      expect(screen.getByLabelText("Turnstile ウィジェット表示領域")).toBeTruthy();
      expect(turnstile.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sitekey: "config-site-key" }),
      );
    });

    it("renders secret code input with Hiragana/Katakana IME support in PortfolioManagerPage", async () => {
      await renderPortfolioManagerPage();

      const input = query<HTMLInputElement>("#portfolio-secret-code-input");
      expect(input.getAttribute("inputmode")).toBe("text");
      expect(input.getAttribute("lang")).toBe("ja");
      expect((input.style as unknown as Record<string, unknown>).WebkitTextSecurity).toBe("disc");
      expect(screen.getByText(/ひらがな.*カタカナ/).textContent).toMatch(/ひらがな.*カタカナ/);
    });

    it("supports admin login and normalizes secret code to NFC", async () => {
      const fetchMock = installFetchDouble();
      await renderPortfolioManagerPage();

      const nfd = DECOMPOSABLE_SECRET_CODE.normalize("NFD");
      fireEvent.change(query<HTMLInputElement>("#portfolio-auth-input"), {
        target: { value: "管理者パスワード" },
      });
      fireEvent.change(query<HTMLInputElement>("#portfolio-secret-code-input"), {
        target: { value: nfd },
      });
      const submit = query<HTMLButtonElement>('#portfolio-inline-auth-form button[type="submit"]');
      expect(submit.disabled).toBe(false);

      await act(async () => {
        fireEvent.click(submit);
      });

      const body = adminLoginBody(fetchMock);
      expect(body.secretCode).toBe(DECOMPOSABLE_SECRET_CODE.normalize("NFC"));
      expect(body.secretCode).not.toBe(nfd);
    });
  });

  describe("4. UI Component Contracts: AdminDashboard", () => {
    it("has WebkitTextSecurity and IME support on admin secret code inputs", async () => {
      await renderAdminDashboard();

      const input = query<HTMLInputElement>("#admin-secret-code-input");
      expect(input.getAttribute("inputmode")).toBe("text");
      expect(input.getAttribute("lang")).toBe("ja");
      expect((input.style as unknown as Record<string, unknown>).WebkitTextSecurity).toBe("disc");
      expect(screen.getByText(/ひらがな.*カタカナ/).textContent).toMatch(/ひらがな.*カタカナ/);
    });

    it("normalizes secret codes to NFC in AdminDashboard", async () => {
      const fetchMock = installFetchDouble();
      await renderAdminDashboard();

      const nfd = DECOMPOSABLE_SECRET_CODE.normalize("NFD");
      fireEvent.change(query<HTMLInputElement>("#admin-password-input"), {
        target: { value: "管理者パスワード" },
      });
      fireEvent.change(query<HTMLInputElement>("#admin-secret-code-input"), {
        target: { value: nfd },
      });
      const submit = query<HTMLButtonElement>('form button[type="submit"]');
      expect(submit.disabled).toBe(false);

      await act(async () => {
        fireEvent.click(submit);
      });

      const body = adminLoginBody(fetchMock);
      expect(body.secretCode).toBe(DECOMPOSABLE_SECRET_CODE.normalize("NFC"));
      expect(body.secretCode).not.toBe(nfd);
    });
  });

  describe("5. UI Component Contracts: TurnstileWidget Accessibility & Resilience", () => {
    it("includes accessible aria-label on retry button and role=alert on error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const turnstile = installTurnstileDouble({ renderThrows: true });

      await act(async () => {
        render(
          createElement(TurnstileWidget, {
            siteKey: "config-site-key",
            onVerify: () => {},
          }),
        );
      });

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Turnstileウィジェットの描画に失敗しました");
      const retry = screen.getByRole("button", { name: "認証を再試行" });
      expect(retry).toBeTruthy();

      // The retry button asks the widget to try again.
      const renderCallsBefore = turnstile.render.mock.calls.length;
      await act(async () => {
        fireEvent.click(retry);
      });
      expect(turnstile.render.mock.calls.length).toBeGreaterThan(renderCallsBefore);
    });

    it("has mobile horizontal overflow protection", async () => {
      installTurnstileDouble();

      await act(async () => {
        render(
          createElement(TurnstileWidget, {
            siteKey: "config-site-key",
            onVerify: () => {},
          }),
        );
      });

      // The challenge container scrolls sideways on a narrow screen instead of
      // pushing the whole page out of view ...
      const container = screen.getByLabelText("Turnstile ウィジェット表示領域");
      expect(container.style.overflowX).toBe("auto");
      // ... and it never exceeds the width of its parent.
      expect(container.parentElement?.style.maxWidth).toBe("100%");
    });

    it("guards AuthModal and PortfolioManagerPage labels for accessibility", async () => {
      await renderAuthModal();
      const authLabel = document.getElementById("auth-modal-turnstile-label");
      expect(authLabel).not.toBeNull();
      expect(authLabel?.textContent).toContain("Turnstile");

      cleanup();

      await renderPortfolioManagerPage();
      const portfolioLabel = document.getElementById("portfolio-turnstile-label");
      expect(portfolioLabel).not.toBeNull();
      expect(portfolioLabel?.textContent).toContain("Turnstile");
    });
  });
});
