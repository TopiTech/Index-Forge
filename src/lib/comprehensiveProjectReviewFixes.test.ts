import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Comprehensive Project Review & Fixes Verification", () => {
  const indexCss = readFileSync(resolve(__dirname, "../index.css"), "utf8");
  const useSimTs = readFileSync(resolve(__dirname, "../hooks/useSimulation.ts"), "utf8");
  const canvasTsx = readFileSync(resolve(__dirname, "../components/Tutorial3DCanvas.tsx"), "utf8");
  const mobileTestTs = readFileSync(resolve(__dirname, "./mobileAndVisualEnhancements.test.ts"), "utf8");
  const tutorialTsx = readFileSync(resolve(__dirname, "../components/TutorialPage.tsx"), "utf8");
  const addStockModalTsx = readFileSync(resolve(__dirname, "../components/AddStockModal.tsx"), "utf8");

  describe("1. ESLint Integrity & Clean Imports", () => {
    it("ensures mobileAndVisualEnhancements.test.ts contains no unused imports", () => {
      expect(mobileTestTs).not.toContain("beforeEach");
      expect(mobileTestTs).not.toContain("afterEach");
      expect(mobileTestTs).not.toContain(", vi");
      expect(mobileTestTs).toContain('import { describe, it, expect } from "vitest";');
    });
  });

  describe("2. useSimulation Unmount Cleanup & Resource Safety", () => {
    it("registers an unmount effect to abort inflight simulation fetch requests", () => {
      expect(useSimTs).toContain("// Cancel inflight simulation requests when component unmounts");
      // The cleanup delegates to the shared abort helper, which both cancels
      // the request and invalidates any response that is still in flight.
      expect(useSimTs).toMatch(
        /useEffect\(\(\)\s*=>\s*\{\s*return\s*\(\)\s*=>\s*\{\s*abortInFlight\(\);\s*\};\s*\}, \[abortInFlight\]\);/,
      );
      expect(useSimTs).toMatch(
        /const abortInFlight = useCallback\(\(\) => \{[\s\S]*?abortRef\.current\.abort\(\)/,
      );
    });
  });

  describe("3. Tutorial3DCanvas Wheel Zoom & Non-Hijacking Scroll", () => {
    it("guards wheel zoom so normal page scroll is not intercepted without Ctrl/Meta", () => {
      expect(canvasTsx).toContain("if (e.ctrlKey || e.metaKey)");
      expect(canvasTsx).toContain("e.preventDefault();");
      expect(canvasTsx).toContain("sceneRef.current.zoomCamera(e.deltaY * zoomSpeed);");
    });

    it("announces Ctrl+scroll zoom option in aria-label and hint text", () => {
      expect(canvasTsx).toContain("Ctrl+スクロールでズーム");
    });
  });

  describe("4. Mobile Responsive Risk Metrics Grid Symmetry", () => {
    it("spans the last odd item across 2 columns on mobile viewports", () => {
      expect(indexCss).toMatch(/\.risk-metrics-grid\s*>\s*:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*span 2;/);
    });

    it("resets span to 1 column on extra small single-column viewports", () => {
      expect(indexCss).toMatch(/@media\s*\(max-width:\s*350px\)\s*\{[\s\S]*?\.risk-metrics-grid\s*>\s*:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*span 1;/);
    });
  });

  describe("5. TutorialPage Keyboard Navigation & Hook Dependencies", () => {
    it("includes isFirstStep in the keydown listener dependency array to prevent stale closure", () => {
      expect(tutorialTsx).toContain("[goToNextStep, goToPrevStep, handleSkip, isShortcutsModalOpen, isFirstStep]");
    });

    it("handles ArrowLeft with isFirstStep guard", () => {
      expect(tutorialTsx).toContain('case "ArrowLeft":');
      expect(tutorialTsx).toContain("if (!isFirstStep");
    });
  });

  describe("6. AddStockModal Accessibility & Dialog Labeling", () => {
    it("links ModalBase ariaDescribedBy to add-stock-modal-description", () => {
      expect(addStockModalTsx).toContain('ariaDescribedBy="add-stock-modal-description"');
      expect(addStockModalTsx).toContain('id="add-stock-modal-description"');
    });
  });

  describe("7. Worker Mutation Responses Cache-Control Hardening", () => {
    it("ensures mutation responses default to Cache-Control: no-store", async () => {
      const { default: workerInstance } = await import("../../worker/index");
      const req = new Request("http://localhost/api/indices/stock?indexId=test-index&ticker=7203", {
        method: "DELETE",
      });
      const res = await workerInstance.fetch(req, {
        ADMIN_PASSWORD: "test",
        DB: {
          prepare: () => ({
            bind: () => ({
              run: async () => ({ meta: { changes: 1 } }),
              all: async () => ({ results: [] }),
              first: async () => null,
            }),
            run: async () => ({ meta: { changes: 1 } }),
            all: async () => ({ results: [] }),
            first: async () => null,
          }),
          batch: async () => [],
        },
      } as any);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  describe("8. Worker DELETE Endpoints Reject ownerToken Query Parameters", () => {
    // SEC-03: an owner token is a bearer credential. Accepting it from the
    // query string wrote the secret into every access/proxy log for the URL,
    // so the token is only read from the `x-owner-token` header now.
    const OWNER_TOKEN = "owner-token-for-delete-endpoints-0123456789";
    const USER_PASSWORD = "test-user-pass-123";
    const ISSUED_AT = Math.floor(Date.now() / 1000);

    /**
     * D1 double for an owner-token protected custom index.
     *
     * `owner_token_issued_at` belongs to the ownership row: the Worker reads
     * the hash and its issuance time together and refuses a token that is
     * older than 90 days (SEC-08), so the fixture has to carry a valid issue
     * time for the token to authorize the request.
     */
    async function createOwnerTokenEnv() {
      const { hashToken, hashPassword } = await import("../../worker/internal");
      return {
        ownerTokenHash: await hashToken(OWNER_TOKEN),
        userPasswordHash: await hashPassword(USER_PASSWORD),
      };
    }

    function createOwnerTokenDb(fixtures: {
      ownerTokenHash: string;
      userPasswordHash: string;
    }) {
      // The Worker reads some rows with a bound statement and others with a
      // plain `.all()` (the access_passwords lookups), so both share one
      // handler.
      const handleAll = async (query: string) => {
        if (query.includes("FROM access_passwords")) {
          return {
            results: [
              {
                id: "user-1",
                name: "User",
                password_hash: fixtures.userPasswordHash,
                role: "user",
                is_active: 1,
              },
            ],
          };
        }
        if (query.includes("FROM indices WHERE id = ?")) {
          return {
            results: [
              {
                id: "custom-idx",
                owner_token_hash: fixtures.ownerTokenHash,
                owner_token_issued_at: ISSUED_AT,
              },
            ],
          };
        }
        if (query.includes("FROM basket_items WHERE index_id = ?")) {
          return { results: [{ cnt: 3 }] };
        }
        return { results: [] };
      };

      return {
        prepare: (query: string) => ({
          bind: () => ({
            all: async () => handleAll(query),
            run: async () => ({ meta: { changes: 1 } }),
            first: async () => null,
          }),
          all: async () => handleAll(query),
          run: async () => ({ meta: { changes: 1 } }),
          first: async () => null,
        }),
        batch: async () => [{ meta: { changes: 1 } }, { meta: { changes: 1 } }],
      };
    }

    it("rejects DELETE /api/indices/stock when the ownerToken is only in the query string", async () => {
      const { default: workerInstance } = await import("../../worker/index");
      const { clearAuthCache } = await import("../../worker/internal");
      clearAuthCache();
      const fixtures = await createOwnerTokenEnv();

      const req = new Request(
        `http://localhost/api/indices/stock?indexId=custom-idx&ticker=7203&ownerToken=${OWNER_TOKEN}`,
        {
          method: "DELETE",
          headers: {
            "x-auth-password": USER_PASSWORD,
          },
        },
      );
      const res = await workerInstance.fetch(req, {
        ASSETS: { fetch: vi.fn() },
        ADMIN_PASSWORD: "admin-secret-pass",
        DB: createOwnerTokenDb(fixtures),
      } as any);
      // The correct token in the URL must not authorize anything.
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("作成者トークンが必要です");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("rejects DELETE /api/indices when the ownerToken is only in the query string", async () => {
      const { default: workerInstance } = await import("../../worker/index");
      const { clearAuthCache } = await import("../../worker/internal");
      clearAuthCache();
      const fixtures = await createOwnerTokenEnv();

      const req = new Request(
        `http://localhost/api/indices?id=custom-idx&ownerToken=${OWNER_TOKEN}`,
        {
          method: "DELETE",
          headers: {
            "x-auth-password": USER_PASSWORD,
          },
        },
      );
      const res = await workerInstance.fetch(req, {
        ASSETS: { fetch: vi.fn() },
        ADMIN_PASSWORD: "admin-secret-pass",
        DB: createOwnerTokenDb(fixtures),
      } as any);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("作成者トークンが必要です");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("authorizes DELETE /api/indices/stock with the x-owner-token header", async () => {
      const { default: workerInstance } = await import("../../worker/index");
      const { clearAuthCache } = await import("../../worker/internal");
      clearAuthCache();
      const fixtures = await createOwnerTokenEnv();

      const req = new Request(
        `http://localhost/api/indices/stock?indexId=custom-idx&ticker=7203`,
        {
          method: "DELETE",
          headers: {
            "x-auth-password": USER_PASSWORD,
            "x-owner-token": OWNER_TOKEN,
          },
        },
      );
      const res = await workerInstance.fetch(req, {
        ASSETS: { fetch: vi.fn() },
        ADMIN_PASSWORD: "admin-secret-pass",
        DB: createOwnerTokenDb(fixtures),
      } as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("authorizes DELETE /api/indices with the x-owner-token header", async () => {
      const { default: workerInstance } = await import("../../worker/index");
      const { clearAuthCache } = await import("../../worker/internal");
      clearAuthCache();
      const fixtures = await createOwnerTokenEnv();

      const req = new Request(`http://localhost/api/indices?id=custom-idx`, {
        method: "DELETE",
        headers: {
          "x-auth-password": USER_PASSWORD,
          "x-owner-token": OWNER_TOKEN,
        },
      });
      const res = await workerInstance.fetch(req, {
        ASSETS: { fetch: vi.fn() },
        ADMIN_PASSWORD: "admin-secret-pass",
        DB: createOwnerTokenDb(fixtures),
      } as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("rejects DELETE /api/indices/stock when the header ownerToken is mismatched", async () => {
      const { default: workerInstance } = await import("../../worker/index");
      const { clearAuthCache } = await import("../../worker/internal");
      clearAuthCache();
      const fixtures = await createOwnerTokenEnv();

      const req = new Request(
        `http://localhost/api/indices/stock?indexId=custom-idx&ticker=7203`,
        {
          method: "DELETE",
          headers: {
            "x-auth-password": USER_PASSWORD,
            "x-owner-token": "wrong-token",
          },
        },
      );
      const res = await workerInstance.fetch(req, {
        ASSETS: { fetch: vi.fn() },
        ADMIN_PASSWORD: "admin-secret-pass",
        DB: createOwnerTokenDb(fixtures),
      } as any);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("作成者トークンが一致しません");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("rejects DELETE /api/indices when the header ownerToken is mismatched", async () => {
      const { default: workerInstance } = await import("../../worker/index");
      const { clearAuthCache } = await import("../../worker/internal");
      clearAuthCache();
      const fixtures = await createOwnerTokenEnv();

      const req = new Request(`http://localhost/api/indices?id=custom-idx`, {
        method: "DELETE",
        headers: {
          "x-auth-password": USER_PASSWORD,
          "x-owner-token": "wrong-token",
        },
      });
      const res = await workerInstance.fetch(req, {
        ASSETS: { fetch: vi.fn() },
        ADMIN_PASSWORD: "admin-secret-pass",
        DB: createOwnerTokenDb(fixtures),
      } as any);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("作成者トークンが一致しません");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });
});
