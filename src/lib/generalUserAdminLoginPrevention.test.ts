// @vitest-environment jsdom
/**
 * Regression tests for the general-user login surface.
 *
 * SEC-02: `/api/auth/verify` is an unauthenticated endpoint, so it must never
 * distinguish "this is an administrator password" from "this password is
 * unknown". The old 403 branch ("管理者としてログインするには…") confirmed
 * exactly that, which made the endpoint a password oracle for the master
 * credential.
 *
 * The suite therefore drives the real code paths — the Worker through
 * `worker.fetch(request, env)` with a mocked D1, the client library through
 * `verifyPassword()`, and the two login surfaces through the DOM — so a
 * broken runtime behaviour fails the suite instead of passing on a
 * source-text match.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import worker from "../../worker/index";
import { verifyPassword, clearAuth, getStoredAuth } from "./auth";
import { hashPassword } from "../../worker/internal";
import { AuthModal } from "../components/AuthModal";
import { PortfolioManagerPage } from "../components/PortfolioManagerPage";
import { ToastProvider } from "../components/Toast";

const TEST_ADMIN_PASSWORD = "test-master-admin-pwd-2026";
const TEST_USER_PASSWORD = "test-general-user-pwd-2026";

interface PasswordRecord {
  id: string;
  name: string;
  password_hash: string;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices?: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

function createMockEnv() {
  const passwords = new Map<string, PasswordRecord>();

  return {
    env: {
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      ADMIN_SECRET_CODE: "テスト暗号",
      TURNSTILE_SITE_KEY: "test-site-key",
      TURNSTILE_SECRET_KEY: "test-secret-key",
      DB: {
        prepare: (query: string) => ({
          bind: (..._params: unknown[]) => ({
            all: async () => {
              if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
                const master = passwords.get("admin-master");
                return { results: master ? [master] : [] };
              }
              if (query.includes("FROM access_passwords WHERE is_active = 1 AND id != 'admin-master'")) {
                const rows = Array.from(passwords.values()).filter(
                  (p) => p.is_active === 1 && p.id !== "admin-master",
                );
                return { results: rows };
              }
              return { results: [] };
            },
            run: async () => ({ success: true, meta: { changes: 1 } }),
          }),
          all: async () => {
            if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
              const master = passwords.get("admin-master");
              return { results: master ? [master] : [] };
            }
            if (query.includes("FROM access_passwords WHERE is_active = 1 AND id != 'admin-master'")) {
              const rows = Array.from(passwords.values()).filter(
                (p) => p.is_active === 1 && p.id !== "admin-master",
              );
              return { results: rows };
            }
            return { results: [] };
          },
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }),
        batch: async () => [],
      },
      ASSETS: {
        fetch: async () => new Response("asset"),
      },
    },
    passwords,
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

/**
 * A Turnstile double.
 *
 * The widget loads an external script and polls for the challenge; neither
 * belongs in a unit test. The double answers every challenge immediately so
 * the login forms become submittable.
 */
function installTurnstileDouble(): void {
  window.turnstile = {
    render: () => "turnstile-widget-id",
    reset: () => {},
    remove: () => {},
  };
}

beforeEach(() => {
  clearAuth();
  installTurnstileDouble();
  installNodeWebCrypto();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { turnstile?: unknown }).turnstile;
});

describe("General User Login Security: Prevention of Admin Login Bypass", () => {
  describe("1. Worker API: POST /api/auth/verify user-only enforcement", () => {
    /**
     * The generic message every failed verification returns.
     *
     * SEC-02: `/api/auth/verify` is an unauthenticated endpoint, so it must
     * never distinguish "this is an administrator password" from "this password
     * is unknown". The old 403 branch ("管理者としてログインするには…") confirmed
     * exactly that, which made the endpoint a password oracle for the master
     * credential.
     */
    const GENERIC_VERIFY_FAILURE = "パスワードが正しくありません";

    it("rejects the admin password with the same generic 401 a wrong password gets", async () => {
      const { env } = createMockEnv();
      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          userOnly: true,
        }),
      });

      const res = await worker.fetch(req, env as never);
      expect(res.status).toBe(401);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.ok).toBe(false);
      // No session, no role, no account id: the admin credential never
      // authenticates through the user-only endpoint.
      expect(data.role).toBeUndefined();
      expect(data.id).toBeUndefined();
      expect(data.name).toBeUndefined();
      expect(data.adminToken).toBeUndefined();
      expect(data.error).toBe(GENERIC_VERIFY_FAILURE);
      // The response must not leak that the credential was administrative.
      expect(String(data.error)).not.toContain("管理者");

      // No password oracle: an unknown password produces the very same answer.
      const wrongRes = await worker.fetch(
        new Request("http://localhost/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "definitely-not-the-admin-password" }),
        }),
        env as never,
      );
      expect(wrongRes.status).toBe(res.status);
      const wrongData = (await wrongRes.json()) as Record<string, unknown>;
      expect(wrongData.error).toBe(data.error);
    });

    it("rejects the admin password with the generic 401 when role: user is specified", async () => {
      const { env } = createMockEnv();
      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          role: "user",
        }),
      });

      const res = await worker.fetch(req, env as never);
      expect(res.status).toBe(401);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.ok).toBe(false);
      expect(data.role).toBeUndefined();
      expect(data.id).toBeUndefined();
      expect(data.error).toBe(GENERIC_VERIFY_FAILURE);
      expect(String(data.error)).not.toContain("管理者");
    });

    it("rejects the admin password with the generic 401 when x-auth-mode: user header is sent", async () => {
      const { env } = createMockEnv();
      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-mode": "user",
        },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
        }),
      });

      const res = await worker.fetch(req, env as never);
      expect(res.status).toBe(401);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.ok).toBe(false);
      expect(data.role).toBeUndefined();
      expect(data.id).toBeUndefined();
      expect(data.error).toBe(GENERIC_VERIFY_FAILURE);
      expect(String(data.error)).not.toContain("管理者");
    });

    it("authenticates legitimate general user password under user-only flow", async () => {
      const { env, passwords } = createMockEnv();
      passwords.set("usr-1", {
        id: "usr-1",
        name: "一般テストユーザー",
        password_hash: await hashPassword(TEST_USER_PASSWORD),
        role: "user",
        max_stocks: 20,
        max_indices: 5,
        is_active: 1,
        created_at: 1000,
        updated_at: 1000,
      });

      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-mode": "user",
        },
        body: JSON.stringify({
          password: TEST_USER_PASSWORD,
          userOnly: true,
        }),
      });

      const res = await worker.fetch(req, env as never);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.ok).toBe(true);
      expect(data.role).toBe("user");
      expect(data.name).toBe("一般テストユーザー");
    });
  });

  describe("2. Client-side Auth Library: verifyPassword defensive guard", () => {
    function setupMockBrowserStorage() {
      const sessionMap = new Map<string, string>();
      const localMap = new Map<string, string>();
      const sessionStorageObj = {
        getItem: (k: string) => sessionMap.get(k) ?? null,
        setItem: (k: string, v: string) => sessionMap.set(k, v),
        removeItem: (k: string) => sessionMap.delete(k),
        clear: () => sessionMap.clear(),
      };
      const localStorageObj = {
        getItem: (k: string) => localMap.get(k) ?? null,
        setItem: (k: string, v: string) => localMap.set(k, v),
        removeItem: (k: string) => localMap.delete(k),
        clear: () => localMap.clear(),
      };
      vi.stubGlobal("sessionStorage", sessionStorageObj);
      vi.stubGlobal("localStorage", localStorageObj);
      return { sessionMap, localMap };
    }

    it("rejects when the server returns an admin role in verifyPassword and prevents session storage", async () => {
      const { sessionMap } = setupMockBrowserStorage();
      // Mock fetch simulating an older API or misconfigured endpoint returning admin.
      // A faithful Response keeps the shared readJsonBody contract (text/headers).
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            role: "admin",
            name: "マスター管理者",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const result = await verifyPassword(TEST_ADMIN_PASSWORD);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("管理者としてログインするには「管理者ログイン」から秘密の暗号およびTurnstile認証を行ってください");
      expect(result.session).toBeUndefined();

      // Ensure no auth session is persisted
      expect(sessionMap.size).toBe(0);
      expect(getStoredAuth()).toBeNull();
    });

    it("stores and returns general user session when verified as user", async () => {
      setupMockBrowserStorage();
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            role: "user",
            name: "一般ユーザー",
            maxStocks: 15,
            maxIndices: 3,
            id: "pwd-1234",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const result = await verifyPassword(TEST_USER_PASSWORD);
      expect(result.ok).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session?.role).toBe("user");
      expect(result.session?.name).toBe("一般ユーザー");

      const stored = getStoredAuth();
      expect(stored).toBeDefined();
      expect(stored?.role).toBe("user");
    });
  });

  describe("3. UI Component Contract: AuthModal & PortfolioManagerPage", () => {
    /**
     * The password field of a login surface.
     *
     * The general-user mode must never invite an administrator password: the
     * administrator logs in through the separate administrator flow, so a
     * field that mentions it would teach the user to hand the master
     * credential to the wrong endpoint.
     */
    function readPasswordField(inputId: string): {
      input: HTMLInputElement;
      label: string;
      placeholder: string;
    } {
      const input = document.querySelector(`#${inputId}`) as HTMLInputElement | null;
      if (!input) throw new Error(`missing password input #${inputId}`);
      const label =
        document.querySelector(`label[for="${inputId}"]`)?.textContent?.trim() ?? "";
      return { input, label, placeholder: input.getAttribute("placeholder") ?? "" };
    }

    function renderAuthModal(): void {
      render(createElement(AuthModal, { isOpen: true, onClose: () => {} }));
    }

    function renderPortfolioManagerPage(): void {
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
    }

    it("AuthModal asks for the administrator password in administrator mode", () => {
      renderAuthModal();

      const adminField = readPasswordField("auth-modal-password-input");
      expect(adminField.placeholder).toBe("管理者パスワード");
      expect(adminField.label).toContain("管理者パスワード");
    });

    it("AuthModal does not prompt users to enter admin passwords in general user mode", () => {
      renderAuthModal();

      // General-user mode: the very same field asks for the access password
      // only, and the administrator password is not mentioned anywhere in it.
      const group = screen.getByRole("group", { name: "認証モード切替" });
      fireEvent.click(within(group).getByRole("button", { name: /一般ユーザー/ }));

      const userField = readPasswordField("auth-modal-password-input");
      expect(userField.placeholder).toBe("ユーザー用アクセスパスワード");
      expect(userField.placeholder).not.toContain("管理者");
      expect(userField.label).toContain("アクセスパスワード");
      expect(userField.label).not.toContain("管理者");

      // The hint tells the general user which password belongs here and where
      // the administrator goes instead.
      const hint = screen.getByText(/管理者が発行したユーザーパスワード/);
      expect(hint.textContent).toContain("管理者が発行したユーザーパスワード");
      expect(hint.textContent).toContain("管理者の方は「管理者ログイン」タブをご利用ください");
    });

    it("PortfolioManagerPage asks for the administrator password in administrator mode", () => {
      renderPortfolioManagerPage();

      const adminField = readPasswordField("portfolio-auth-input");
      expect(adminField.placeholder).toBe("管理者パスワード");
      expect(adminField.label).toContain("管理者パスワード");
    });

    it("PortfolioManagerPage does not prompt users to enter admin passwords in general user mode", () => {
      renderPortfolioManagerPage();

      // General-user mode: the field asks for the access password only.
      fireEvent.click(screen.getByRole("tab", { name: /一般ユーザー/ }));

      const userField = readPasswordField("portfolio-auth-input");
      expect(userField.placeholder).toBe("ユーザー用アクセスパスワード");
      expect(userField.placeholder).not.toContain("管理者");
      expect(userField.label).toContain("アクセスパスワード");
      expect(userField.label).not.toContain("管理者");

      // The hint tells the general user which password belongs here and where
      // the administrator goes instead.
      const hint = screen.getByText(/管理者が発行したユーザーパスワード/);
      expect(hint.textContent).toContain("管理者が発行したユーザーパスワード");
      expect(hint.textContent).toContain("管理者の方は「管理者ログイン」タブをご利用ください");
    });
  });
});
