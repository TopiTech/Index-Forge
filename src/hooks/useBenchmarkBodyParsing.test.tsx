// @vitest-environment jsdom
/**
 * N-6 回帰防止: 非 JSON 本文の規約を apiContract に一元化した後も、
 * useBenchmark のエラー文言・挙動が完全に不変であることを検証する。
 *
 * - 304 リトライ経路の空本文 → 「（空のレスポンス）」の専用エラー
 * - 非 JSON 本文 (HTML エラーページ) → 「形式が不正」
 * - 正常な JSON → 従来どおり publish される
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useBenchmark } from "./useBenchmark";
import type { BenchmarkSymbol } from "../types";

function snapshotResponse(symbol: string, current: number): Response {
  return new Response(
    JSON.stringify({
      snapshot: {
        symbol,
        label: symbol,
        current,
        change: 1,
        changePct: 0.5,
        updatedAt: "2026-01-01T00:00:00.000Z",
        description: "",
      },
      series: [{ date: "2026-01-01", close: current }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubFetchSequence(responses: Response[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (): Promise<Response> => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch");
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useBenchmark body parsing contract (N-6)", () => {
  it("keeps the dedicated empty-body error on the 304 refetch path", async () => {
    stubFetchSequence([
      new Response(null, { status: 304 }),
      new Response("", { status: 200 }),
    ]);

    const { result } = renderHook(() => useBenchmark("^N225" satisfies BenchmarkSymbol, true));

    await waitFor(() =>
      expect(result.current.error).toBe("^N225 データの取得に失敗しました（空のレスポンス）"),
    );
    expect(result.current.benchmarkData).toBeNull();
  });

  it("maps a non-JSON body on the 304 refetch path to the format error", async () => {
    stubFetchSequence([
      new Response(null, { status: 304 }),
      new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ]);

    const { result } = renderHook(() => useBenchmark("^GSPC" satisfies BenchmarkSymbol, true));

    await waitFor(() => expect(result.current.error).toBe("^GSPC データの形式が不正です"));
    expect(result.current.benchmarkData).toBeNull();
  });

  it("publishes a valid JSON refetch unchanged", async () => {
    stubFetchSequence([
      new Response(null, { status: 304 }),
      snapshotResponse("USDJPY=X", 150),
    ]);

    const { result } = renderHook(() => useBenchmark("USDJPY=X" satisfies BenchmarkSymbol, true));

    await waitFor(() => expect(result.current.benchmarkData).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.benchmarkData?.snapshot.symbol).toBe("USDJPY=X");
    expect(result.current.benchmarkData?.snapshot.current).toBe(150);
  });

  it("keeps the main-path format error for a non-JSON body", async () => {
    stubFetchSequence([
      new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ]);

    const { result } = renderHook(() => useBenchmark("BTC-USD" satisfies BenchmarkSymbol, true));

    await waitFor(() => expect(result.current.error).toBe("BTC-USD データの形式が不正です"));
    expect(result.current.benchmarkData).toBeNull();
  });
});
