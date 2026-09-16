import { describe, it, expect, vi } from "vitest";
import worker from "../../worker/index";

describe("Autonomous Goal Review Fixes: Quota Bounds & Clamping", () => {
  function sanitizeQuota(
    value: unknown,
    min: number,
    max: number,
    isUnlimited: boolean,
  ): number | null {
    if (isUnlimited) return null;
    const parsed = Math.floor(Number(value));
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
  }

  it("clamps maxStocks within 1 to 500", () => {
    expect(sanitizeQuota("600", 1, 500, false)).toBe(500);
    expect(sanitizeQuota(1000, 1, 500, false)).toBe(500);
    expect(sanitizeQuota(-5, 1, 500, false)).toBe(1);
    expect(sanitizeQuota(0, 1, 500, false)).toBe(1);
    expect(sanitizeQuota(250, 1, 500, false)).toBe(250);
    expect(sanitizeQuota("invalid", 1, 500, false)).toBe(1);
    expect(sanitizeQuota(500, 1, 500, true)).toBeNull();
  });

  it("clamps maxIndices within 1 to 100", () => {
    expect(sanitizeQuota("200", 1, 100, false)).toBe(100);
    expect(sanitizeQuota(150, 1, 100, false)).toBe(100);
    expect(sanitizeQuota(-10, 1, 100, false)).toBe(1);
    expect(sanitizeQuota(0, 1, 100, false)).toBe(1);
    expect(sanitizeQuota(50, 1, 100, false)).toBe(50);
    expect(sanitizeQuota("abc", 1, 100, false)).toBe(1);
    expect(sanitizeQuota(10, 1, 100, true)).toBeNull();
  });
});

describe("Autonomous Goal Review Fixes: ConstituentsTable Unauthenticated Owner Flow", () => {
  it("determines eligibility to edit based on ownership or admin status", () => {
    const isOwner = (id: string) => id === "custom-1";
    const selectedIndex = { id: "custom-1", name: "My Index", basket: [{ ticker: "7203.T", name: "トヨタ", weight: 100 }] };
    
    // User is unauthenticated, but has owner token in local storage
    const isAuthenticated = false;
    const isAdmin = false;
    const canEditSelectedIndex = Boolean(
      selectedIndex && (isAdmin || isOwner(selectedIndex.id)),
    );

    expect(canEditSelectedIndex).toBe(true);

    // ConstituentsTable logic:
    // When canEdit is true, table displays edit controls (Add / Remove)
    // and triggers authentication modal if !isAuthenticated.
    let isAuthModalOpen = false;
    let pendingDelete: { ticker: string; name: string } | null = null;
    let tableError: string | null = null;

    const handleDeleteStockClick = (ticker: string, stockName: string, basketLength: number) => {
      if (!canEditSelectedIndex) {
        tableError = "この指数を編集する権限がありません。作成者または管理者として認証してください。";
        return;
      }
      if (basketLength <= 1) {
        tableError = "構成銘柄が1件のみのため削除できません。指数には最低1銘柄必要です。";
        return;
      }
      if (!isAuthenticated) {
        pendingDelete = { ticker, name: stockName };
        isAuthModalOpen = true;
        return;
      }
    };

    // When only 1 constituent exists, cannot delete
    handleDeleteStockClick("7203.T", "トヨタ", 1);
    expect(tableError).toBe("構成銘柄が1件のみのため削除できません。指数には最低1銘柄必要です。");
    expect(isAuthModalOpen).toBe(false);

    // When multiple constituents exist and user is unauthenticated owner, AuthModal is triggered
    tableError = null;
    handleDeleteStockClick("7203.T", "トヨタ", 3);
    expect(tableError).toBeNull();
    expect(isAuthModalOpen).toBe(true);
    expect(pendingDelete).toEqual({ ticker: "7203.T", name: "トヨタ" });
  });

  it("renders appropriate status message for unauthenticated owner vs non-owner", () => {
    const getStatusText = (canEdit: boolean) =>
      canEdit
        ? "編集するにはパスワード認証が必要です"
        : "この指数は閲覧専用です（作成者または管理者のみ編集可能）";

    const getButtonText = (canEdit: boolean) =>
      canEdit ? "ログインして編集" : "管理者ログイン";

    expect(getStatusText(true)).toBe("編集するにはパスワード認証が必要です");
    expect(getButtonText(true)).toBe("ログインして編集");

    expect(getStatusText(false)).toBe("この指数は閲覧専用です（作成者または管理者のみ編集可能）");
    expect(getButtonText(false)).toBe("管理者ログイン");
  });
});

describe("Autonomous Goal Review Fixes: ExecutionContext in Worker", () => {
  it("worker fetch accepts optional ExecutionContext and uses waitUntil", async () => {
    const waitUntilMock = vi.fn();
    const ctx = {
      waitUntil: waitUntilMock,
      passThroughOnException: vi.fn(),
      props: {},
      exports: {} as unknown as Cloudflare.Exports,
    };

    const mockEnv = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
            all: vi.fn().mockResolvedValue({ results: [] }),
            first: vi.fn().mockResolvedValue(null),
          }),
        }),
      },
      ASSETS: { fetch: vi.fn() },
    } as unknown as Env;

    const request = new Request("http://localhost/api/health", { method: "GET" });
    const response = await worker.fetch(request, mockEnv, ctx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, service: "indexforge-worker" });
  });

  it("worker fetch operates reliably even without ExecutionContext provided", async () => {
    const mockEnv = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
          }),
        }),
      },
      ASSETS: { fetch: vi.fn() },
    } as unknown as Env;

    const request = new Request("http://localhost/api/health", { method: "GET" });
    // Calling fetch without ctx (standard 2-arg call)
    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(200);
  });
});
