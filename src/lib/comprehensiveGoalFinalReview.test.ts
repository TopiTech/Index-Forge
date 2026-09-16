import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, { clearAuthCache, resetPasswordTableEnsured } from "../../worker/index";
import { calculateStockDetails } from "./analytics";
import type { BasketItem, StockSeries } from "../types";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

describe("Comprehensive Goal Final Review Tests", () => {
  describe("CORS Allow and Expose Headers", () => {
    it("includes cache-control and if-none-match in CORS allow headers for preflight OPTIONS", async () => {
      const request = new Request("http://127.0.0.1:8787/api/calculate", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "cache-control,content-type,if-none-match",
        },
      });

      const env = {
        DB: { prepare: vi.fn(), batch: vi.fn() },
        ASSETS: { fetch: vi.fn() },
      } as any;

      const response = await worker.fetch(request, env);
      expect(response.status).toBe(200);

      const allowHeaders = response.headers.get("access-control-allow-headers") || "";
      expect(allowHeaders).toContain("cache-control");
      expect(allowHeaders).toContain("if-none-match");
      expect(allowHeaders).toContain("content-type");
      expect(allowHeaders).toContain("x-auth-password");

      const exposeHeaders = response.headers.get("access-control-expose-headers") || "";
      expect(exposeHeaders).toContain("etag");
      expect(exposeHeaders).toContain("x-data-stale");
      expect(exposeHeaders).toContain("x-cache");
    });

    it("includes CORS expose headers on standard JSON API responses", async () => {
      const request = new Request("http://127.0.0.1:8787/api/health", {
        method: "GET",
        headers: {
          Origin: "http://localhost:5173",
        },
      });

      const env = {
        DB: { prepare: vi.fn(), batch: vi.fn() },
        ASSETS: { fetch: vi.fn() },
      } as any;

      const response = await worker.fetch(request, env);
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      expect(response.headers.get("access-control-expose-headers")).toContain("etag");
      expect(response.headers.get("access-control-expose-headers")).toContain("x-data-stale");
      expect(response.headers.get("access-control-expose-headers")).toContain("x-cache");
    });
  });

  describe("Analytics Negative Zero (-0) Normalization", () => {
    it("normalizes tiny negative contribution percentages to positive 0", () => {
      const basket: BasketItem[] = [
        { ticker: "7203.T", name: "トヨタ自動車", weight: 0.01, theme: "自動車" },
      ];
      const stockUniverse: StockSeries[] = [
        {
          ticker: "7203.T",
          name: "トヨタ自動車",
          data: [
            { date: "2026-03-01", close: 1000 },
            { date: "2026-03-02", close: 999.9 },
          ],
        },
      ];
      const customSeries = [
        { date: "2026-03-01", close: 100000, value: 100000 },
        { date: "2026-03-02", close: 99999.9, value: 99999.9 },
      ];
      const details = calculateStockDetails(basket, stockUniverse, 1000, customSeries);

      expect(details).toHaveLength(1);
      const stock = details[0];
      expect(Object.is(stock.contributionPt, -0)).toBe(false);
      expect(Object.is(stock.contributionPct, -0)).toBe(false);
      expect(stock.contributionPt).toBeGreaterThanOrEqual(0);
      expect(stock.contributionPct).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Header Accessible Names and Tooltips", () => {
    const headerSource = readFileSync(
      new URL("../components/Header.tsx", import.meta.url),
      "utf8",
    );

    it("defines title and aria-label for desktop navigation dropdown buttons", () => {
      expect(headerSource).toContain('title="ダッシュボード"');
      expect(headerSource).toContain('aria-label="ダッシュボードへ移動"');
      expect(headerSource).toContain('title="指数ビルダー"');
      expect(headerSource).toContain('aria-label="指数ビルダーへ移動"');
      expect(headerSource).toContain('title="開発者ポートフォリオ・自己紹介"');
      expect(headerSource).toContain('aria-label="開発者ポートフォリオ・自己紹介へ移動"');
      expect(headerSource).toContain('title="免責事項・利用規約"');
      expect(headerSource).toContain('aria-label="免責事項へ移動"');
      expect(headerSource).toContain('title="管理者ページ"');
      expect(headerSource).toContain('aria-label="管理者ページへ移動"');
    });

    it("defines title and aria-label for mobile navigation links", () => {
      expect(headerSource).toContain('title="指数ビルダー＆シミュレーター"');
      expect(headerSource).toContain('aria-label="指数ビルダー＆シミュレーターへ移動"');
    });
  });

  describe("Modal Drag Dismissal Protection", () => {
    const modalBaseSource = readFileSync(
      new URL("../components/ModalBase.tsx", import.meta.url),
      "utf8",
    );
    const indexBuilderModalSource = readFileSync(
      new URL("../components/IndexBuilderModal.tsx", import.meta.url),
      "utf8",
    );

    it("ModalBase tracks mousedown origin and stops propagation on dialog", () => {
      expect(modalBaseSource).toContain("isBackdropMouseDownRef");
      expect(modalBaseSource).toContain("handleBackdropMouseDown");
      expect(modalBaseSource).toContain("handleBackdropClick");
      expect(modalBaseSource).toContain("onMouseDown={(e) => e.stopPropagation()}");
    });

    it("IndexBuilderModal tracks mousedown origin and stops propagation on dialog", () => {
      expect(indexBuilderModalSource).toContain("isBackdropMouseDownRef");
      expect(indexBuilderModalSource).toContain("handleBackdropMouseDown");
      expect(indexBuilderModalSource).toContain("handleBackdropClick");
      expect(indexBuilderModalSource).toContain("onMouseDown={(e) => e.stopPropagation()}");
    });
  });

  describe("useIndices addStockToIndex Auth Header", () => {
    const useIndicesSource = readFileSync(
      new URL("../hooks/useIndices.ts", import.meta.url),
      "utf8",
    );

    it("attaches x-auth-password header when password is provided in addStockToIndex", () => {
      expect(useIndicesSource).toMatch(
        /addStockToIndex[\s\S]{1,1000}headers\["x-auth-password"\]\s*=\s*password;\s*\}/,
      );
    });
  });
});
