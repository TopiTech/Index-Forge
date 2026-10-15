import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { deserializeBasketFromCsv, deserializeIndexFromJson } from "./indexSerialization";
import { buildSaveIndexRequest } from "../hooks/useIndices";
import type { CustomIndex } from "../data/indices";
import {
  consumeSaveFailure,
  savePortfolioPositions,
  saveWatchlist,
} from "./portfolioStorage";
import {
  clearStockFundamentalsClientCache,
  fetchStockFundamentals,
} from "./marketDataService";

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(here, rel), "utf8");

const portfolioSrc = readSrc("../components/PortfolioManagerPage.tsx");
const toastSrc = readSrc("../components/Toast.tsx");
const workerSrc = readSrc("../../worker/internal-impl.ts");

describe("インポート境界とWorker契約の整合性 (再発防止)", () => {
  it("basket CSV keeps parsed weight fidelity (existing spec: '1,000' -> 1000)", () => {
    const csv =
      "コード,銘柄名,テーマ,比率(%)\n7203,トヨタ,自動車,\"1,000\"\n8035,東京エレクトロン,半導体,\"500\"";
    const res = deserializeBasketFromCsv(csv);
    expect(res.ok).toBe(true);
    expect(res.data?.[0].weight).toBe(1000);
    expect(res.data?.[1].weight).toBe(500);
    // 解析警告は重み列が解決できた場合は出ない
    expect(res.error).toBeUndefined();
  });

  it("buildSaveIndexRequest repairs out-of-contract baskets at the request boundary", () => {
    const index: CustomIndex = {
      id: "test-idx",
      name: "テスト指数",
      description: "",
      baseValue: 5_000_000,
      basket: [
        { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 1000 },
        { ticker: "8035", name: "東京エレクトロン", theme: "半導体", weight: 0 },
        { ticker: "7203", name: "重複行", theme: "自動車", weight: 50 },
        { ticker: "不正!ティッカー", name: "無効銘柄", theme: "x", weight: 50 },
      ],
    };
    const { body } = buildSaveIndexRequest(index, "tok_abc123", {});
    const parsed = JSON.parse(body) as {
      basket: { ticker: string; weight: number }[];
      baseValue: number;
      ownerToken: string;
    };

    // weight>100 はクランプ、weight<=0 と不正ティッカーと重複は除外され、
    // そのまま送ると 400 になるリクエストが送信されない。
    expect(parsed.basket).toHaveLength(1);
    expect(parsed.basket[0]).toMatchObject({ ticker: "7203", weight: 100 });
    expect(parsed.baseValue).toBe(1_000_000);
    expect(parsed.ownerToken).toBe("tok_abc123");
  });

  it("warns instead of silently defaulting every weight to 1 when the weight column is unresolvable", () => {
    const noWeightColumn = "コード,銘柄名,テーマ,割合\n7203,トヨタ,自動車,40\n8035,TEL,半導体,60";
    const warned = deserializeBasketFromCsv(noWeightColumn);
    expect(warned.ok).toBe(true);
    expect(warned.data?.length).toBe(2);
    expect(warned.data?.every((b) => b.weight === 1)).toBe(true);
    expect(warned.error).toContain("重み");

    const withWeightColumn =
      "コード,銘柄名,テーマ,比率(%)\n7203,トヨタ,自動車,40\n8035,TEL,半導体,60";
    const clean = deserializeBasketFromCsv(withWeightColumn);
    expect(clean.ok).toBe(true);
    expect(clean.data?.[0].weight).toBe(40);
    expect(clean.error).toBeUndefined();
  });

  it("JSON import falls back to a generated id when the id breaks the Worker contract", () => {
    const bad = deserializeIndexFromJson(
      JSON.stringify({
        id: "指数!!id",
        name: "テスト指数",
        basket: [{ ticker: "7203", name: "トヨタ", theme: "自動車", weight: 50 }],
      }),
    );
    expect(bad.ok).toBe(true);
    expect(bad.data?.id).toMatch(/^custom-\d+$/);

    const good = deserializeIndexFromJson(
      JSON.stringify({
        id: "my-index_1.2",
        name: "テスト指数",
        basket: [{ ticker: "7203", name: "トヨタ", theme: "自動車", weight: 50 }],
      }),
    );
    expect(good.ok).toBe(true);
    expect(good.data?.id).toBe("my-index_1.2");
  });
});

describe("自動保存失敗の可視化 (再発防止)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("consumeSaveFailure reports the outcome of the immediately preceding save, once", () => {
    const okStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => undefined),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    vi.stubGlobal("localStorage", okStorage);
    expect(
      savePortfolioPositions([
        { id: "p1", ticker: "7203", name: "トヨタ", shares: 100, averageCost: 2500 },
      ]),
    ).toBe(true);
    expect(consumeSaveFailure()).toBe(false);
    vi.unstubAllGlobals();

    const quotaStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("QuotaExceededError: storage is full");
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    vi.stubGlobal("localStorage", quotaStorage);
    expect(
      savePortfolioPositions([
        { id: "p2", ticker: "9984", name: "SBG", shares: 50, averageCost: 8000 },
      ]),
    ).toBe(false);
    expect(consumeSaveFailure()).toBe(true);
    // 通知は1回消費される (連打防止は呼び出し側の責務)
    expect(consumeSaveFailure()).toBe(false);

    expect(saveWatchlist(["7203"])).toBe(false);
    expect(consumeSaveFailure()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("PortfolioManagerPage consumes the save result and surfaces failures with a toast", () => {
    // 既存の文言テストが固定する「if (...) { saveXXX(...);」の形を維持しつつ、
    // 直後で成否を受け取り notifySaveError で通知していること。
    const positionsCall = portfolioSrc.indexOf("savePortfolioPositions(positions);");
    expect(positionsCall).toBeGreaterThan(-1);
    expect(portfolioSrc.indexOf("consumeSaveFailure()", positionsCall)).toBeGreaterThan(
      positionsCall,
    );
    expect(portfolioSrc.indexOf("notifySaveError(", positionsCall)).toBeGreaterThan(
      positionsCall,
    );

    const watchlistCall = portfolioSrc.indexOf("saveWatchlist(watchlist);");
    expect(watchlistCall).toBeGreaterThan(-1);
    expect(portfolioSrc.indexOf("consumeSaveFailure()", watchlistCall)).toBeGreaterThan(
      watchlistCall,
    );
    expect(portfolioSrc.indexOf("notifySaveError(", watchlistCall)).toBeGreaterThan(
      watchlistCall,
    );
  });

  it("ToastProvider memoizes the context value so consumers' effect deps stay stable", () => {
    expect(toastSrc).toContain("const contextValue = useMemo(");
    expect(toastSrc).toContain("[showToast, success, error, warning, info, removeToast]");
  });
});

describe("fundamentals 取得失敗のキャッシュ分離 (再発防止)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearStockFundamentalsClientCache();
  });

  it("does not persist failures as successes and applies a retry cooldown", async () => {
    clearStockFundamentalsClientCache();
    vi.stubGlobal("window", globalThis);
    const failingFetch = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", failingFetch);

    // 1回目: 失敗 → ベースラインを返すが成功キャッシュには書かない
    const first = await fetchStockFundamentals("FAILTEST");
    expect(first.price).toBeGreaterThan(0);
    expect(failingFetch).toHaveBeenCalledTimes(1);

    // 2回目: クールダウン中は再試行せず同一フォールバックを返す (扇出抑制)
    const second = await fetchStockFundamentals("FAILTEST");
    expect(second).toBe(first);
    expect(failingFetch).toHaveBeenCalledTimes(1);

    // forceRefresh はクールダウンを迂回して必ず再試行する
    await fetchStockFundamentals("FAILTEST", true);
    expect(failingFetch).toHaveBeenCalledTimes(2);

    // 復帰後 (キャッシュクリア) は成功データが取得・キャッシュされる
    clearStockFundamentalsClientCache();
    const successFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticker: "FAILTEST", price: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", successFetch);
    const recovered = await fetchStockFundamentals("FAILTEST");
    expect(recovered.price).toBe(42);
    expect(successFetch).toHaveBeenCalledTimes(1);
    const cached = await fetchStockFundamentals("FAILTEST");
    expect(cached).toBe(recovered);
    expect(successFetch).toHaveBeenCalledTimes(1);
  });
});

describe("/api/indices 一覧の決定的な並び順 (再発防止)", () => {
  it("orders by a unique tiebreaker (sort_order, name, id, ticker) in both query paths", () => {
    const sortPath = workerSrc.match(
      /ORDER BY\s+COALESCE\(i\.sort_order, 99\),\s+i\.name,\s+i\.id,\s+b\.ticker/g,
    );
    expect(sortPath?.length).toBe(2);
    const fallbackPath = workerSrc.match(/ORDER BY\s+i\.name,\s+i\.id,\s+b\.ticker/g);
    expect(fallbackPath?.length).toBe(2);

    // ページ境界 (LIMIT/OFFSET) で行の欠落・重複を招く旧パターンは残っていない
    expect(workerSrc).not.toMatch(/ORDER BY\s+COALESCE\(i\.sort_order, 99\),\s+i\.name,\s+b\.ticker/);
    expect(workerSrc).not.toMatch(/ORDER BY\s+i\.name,\s+b\.ticker/);
  });
});
