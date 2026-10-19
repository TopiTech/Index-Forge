import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import worker from "../../worker/internal-impl";
import {
  clearAuthCache,
  resetPasswordTableEnsured,
  hashPassword,
  verifyPasswordHash,
} from "../../worker/internal";

describe("Comprehensive Code Review Resolution Round 4", () => {
  const rootDir = process.cwd();
  const modalBaseSource = readFileSync(
    resolve(rootDir, "src/components/ModalBase.tsx"),
    "utf-8",
  );
  const calendarTsx = readFileSync(
    resolve(rootDir, "src/components/CalendarPage.tsx"),
    "utf-8",
  );
  const adminTsx = readFileSync(
    resolve(rootDir, "src/components/AdminDashboard.tsx"),
    "utf-8",
  );
  const portfolioTsx = readFileSync(
    resolve(rootDir, "src/components/PortfolioManagerPage.tsx"),
    "utf-8",
  );
  const internalImplTs = readFileSync(
    resolve(rootDir, "worker/internal-impl.ts"),
    "utf-8",
  );

  beforeEach(() => {
    clearAuthCache();
    resetPasswordTableEnsured();
  });

  describe("1. ModalBase Dialog Accessibility & Accessible Names", () => {
    it("ensures resolvedLabelledBy connects to titleId whenever title is present and ariaLabel is omitted", () => {
      expect(modalBaseSource).toContain("resolvedLabelledBy =");
      expect(modalBaseSource).toContain("ariaLabelledBy ?? (ariaLabel ? undefined : (title ? titleId : undefined))");
    });

    it("wraps non-string title ReactNode in an element with id=titleId for screen reader accessibility", () => {
      expect(modalBaseSource).toContain('typeof title === "string" ?');
      expect(modalBaseSource).toContain('<h2 className="modal-title" id={titleId}>');
      expect(modalBaseSource).toContain('<div className="modal-title" id={titleId}>');
    });
  });

  describe("2. CalendarPage & AdminDashboard Accessible Controls", () => {
    it("provides explicit aria-label for calendar search input and clear button", () => {
      expect(calendarTsx).toContain('aria-label="イベント・銘柄名検索"');
      expect(calendarTsx).toContain('aria-label="検索キーワードを消去"');
    });

    it("specifies explicit ariaLabel on CalendarPage modals", () => {
      expect(calendarTsx).toContain('ariaLabel="イベント詳細"');
      expect(calendarTsx).toContain('ariaLabel={`${selectedDayOverview.fullDate || selectedDayOverview.dateStr} のイベント一覧 (${selectedDayOverview.events.length}件)`}');
    });

    it("specifies explicit ariaLabel on AdminDashboard create index modal", () => {
      expect(adminTsx).toContain('ariaLabel="新規カスタム指数の作成"');
    });
  });

  describe("3. PortfolioManagerPage Multi-Effect Auth Transition Safety", () => {
    it("guards both positions and watchlist auto-save effects without race condition", () => {
      // Both effects must check the transition ref without immediately clearing it
      const effectAround = (source: string, marker: string): string => {
        const index = source.indexOf(marker);
        expect(index).toBeGreaterThan(-1);
        const start = source.lastIndexOf("useEffect(", index);
        const end = source.indexOf("}, [", index);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(index);
        return source.slice(start, end);
      };

      const positionsEffect = effectAround(portfolioTsx, "savePortfolioPositions(positions);");
      expect(positionsEffect).toContain("if (isAuthTransitionRef.current) {");
      expect(positionsEffect).toContain("return;");
      // The save must stay behind the authentication and persistence gate.
      expect(positionsEffect).toContain("if (isAuthenticated && positionsPersistedRef.current) {");

      const watchlistEffect = effectAround(portfolioTsx, "saveWatchlist(watchlist);");
      expect(watchlistEffect).toContain("if (isAuthTransitionRef.current) {");
      expect(watchlistEffect).toContain("return;");
      expect(watchlistEffect).toContain("if (isAuthenticated && watchlistPersistedRef.current) {");

      // The ref is safely reset in a follow-up effect
      expect(portfolioTsx).toContain("if (isAuthTransitionRef.current) {\n      isAuthTransitionRef.current = false;\n      return;\n    }");
    });
  });

  describe("4. Worker Security: Admin Secret Code Provisioning", () => {
    it("does NOT contain hardcoded fallback password 'admin' in internal-impl.ts", () => {
      expect(internalImplTs).not.toContain('env.ADMIN_PASSWORD?.trim() || "admin"');
      expect(internalImplTs).not.toContain("defaultMasterPwd");
    });

    it("safely initializes master admin row using authenticated master password instead of default 'admin'", async () => {
      let insertedPasswordHash: string | null = null;
      const masterPassword = "MasterPasswordSecure789!";
      const dbMock = {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => {
            if (sql.includes("INSERT INTO access_passwords")) {
              insertedPasswordHash = args[0];
            }
            return dbMock.prepare(sql);
          },
          all: async () => {
            if (sql.includes("FROM access_passwords WHERE id = 'admin-master'")) {
              return { results: [] };
            }
            return { results: [] };
          },
          run: async () => ({ success: true }),
          first: async () => null,
        }),
      };

      const env: any = {
        DB: dbMock,
        ADMIN_PASSWORD: masterPassword,
      };

      const req = new Request("http://localhost/api/admin/admin-secret-code", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": masterPassword,
        },
        body: JSON.stringify({
          currentSecretCode: "indexforge-admin-secret-2026",
          newSecretCode: "NewSecretCode456!",
        }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      expect(insertedPasswordHash).not.toBeNull();
      // Ensure it hashed the explicit master password, NOT "admin"
      const adminHash = await hashPassword("admin");
      expect(insertedPasswordHash).not.toBe(adminHash);
      expect(await verifyPasswordHash(masterPassword, insertedPasswordHash!)).toBe(true);
    });
  });

  describe("5. Worker POST /api/sync-prices force sync with body.password", () => {
    it("supports body.password in POST /api/sync-prices for force=true", async () => {
      const validAdminPwd = "sync-admin-password-123";
      const validHash = await hashPassword(validAdminPwd);

      const dbMock = {
        prepare: (sql: string) => ({
          bind: () => dbMock.prepare(sql),
          all: async () => {
            if (sql.includes("FROM access_passwords")) {
              return {
                results: [
                  {
                    id: "admin-master",
                    name: "マスター管理者",
                    role: "admin",
                    is_active: 1,
                    password_hash: validHash,
                  },
                ],
              };
            }
            if (sql.includes("FROM sync_logs")) {
              return { results: [] };
            }
            return { results: [] };
          },
          run: async () => ({ success: true }),
          first: async () => null,
        }),
        batch: async () => [],
      };

      const env: any = {
        DB: dbMock,
        ADMIN_PASSWORD: validAdminPwd,
      };

      // 1. Force sync with invalid body.password -> 401
      const reqInvalid = new Request("http://localhost/api/sync-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers: ["7203"],
          force: true,
          password: "wrong-password",
        }),
      });
      const resInvalid = await worker.fetch(reqInvalid, env);
      expect(resInvalid.status).toBe(401);
      const jsonInvalid = await resInvalid.json();
      expect(jsonInvalid.error).toContain("強制同期にはパスワード認証が必要です");

      // 2. Force sync with valid body.password -> authenticated (does not reject with 401)
      const reqValid = new Request("http://localhost/api/sync-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers: ["7203"],
          force: true,
          password: validAdminPwd,
        }),
      });
      const resValid = await worker.fetch(reqValid, env);
      expect(resValid.status).not.toBe(401);
    });
  });
});
