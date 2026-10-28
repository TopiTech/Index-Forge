import { afterEach, describe, expect, it, vi } from "vitest";
import { installAbortableHangingFetch, installFailingFetch } from "../test-helpers/networkFailure";
import {
  FetchNetworkError,
  REQUEST_TIMEOUT_MESSAGE,
  LEGACY_REPAIRED_WEIGHT,
  NETWORK_UNREACHABLE_MESSAGE,
  fetchWithNetworkMark,
  MAX_BASE_VALUE,
  MAX_BASKET_ITEMS,
  MAX_INDEX_ID_LENGTH,
  MAX_OWNER_TOKEN_LENGTH,
  MAX_TICKER_LENGTH,
  clampBaseValue,
  extractApiErrorMessage,
  isApiErrorBody,
  isFetchTimeoutError,
  isRecord,
  isValidBaseValue,
  isValidIndexId,
  isValidSortOrder,
  isValidTicker,
  isValidWeight,
  parseJsonText,
  readJsonBody,
  readResponseErrorMessage,
  releaseResponse,
  validateBasketItems,
  validateSingleStockItem,
} from "./apiContract";
import { normalizeTicker as canonicalNormalizeTicker } from "./yahooSymbol";
import { normalizeTicker as engineNormalizeTicker } from "./indexEngine";
import { deserializeIndexFromJson } from "./indexSerialization";

describe("apiContract: ticker rule", () => {
  it("accepts every ticker shape the Worker supports", () => {
    for (const ticker of ["AAPL", "7203", "^N225", "USDJPY=X", "BRK_A", "7203.T", "BTC-USD"]) {
      expect(isValidTicker(ticker)).toBe(true);
    }
  });

  it("rejects empty, over-long and out-of-charset tickers", () => {
    expect(isValidTicker("")).toBe(false);
    expect(isValidTicker("A".repeat(MAX_TICKER_LENGTH + 1))).toBe(false);
    expect(isValidTicker("A".repeat(MAX_TICKER_LENGTH))).toBe(true);
    expect(isValidTicker("TICKER@SYM")).toBe(false);
    expect(isValidTicker("TICKER!SYM")).toBe(false);
    expect(isValidTicker("TICKER#SYM")).toBe(false);
    expect(isValidTicker("TICKER$SYM")).toBe(false);
    expect(isValidTicker("AAPL; DROP TABLE indices;")).toBe(false);
    expect(isValidTicker("<script>alert(1)</script>")).toBe(false);
  });
});

describe("apiContract: index id rule", () => {
  it("accepts the ids the Worker allows, including the prototype names", () => {
    // `constructor` and `prototype` are legal index ids under the Worker's
    // rule, so the ownership store has to be able to round-trip them.
    expect(isValidIndexId("constructor")).toBe(true);
    expect(isValidIndexId("prototype")).toBe(true);
    expect(isValidIndexId("custom-1")).toBe(true);
  });

  it("rejects ids outside the charset or the length limit", () => {
    expect(isValidIndexId("")).toBe(false);
    expect(isValidIndexId("a".repeat(MAX_INDEX_ID_LENGTH + 1))).toBe(false);
    expect(isValidIndexId("a".repeat(MAX_INDEX_ID_LENGTH))).toBe(true);
    expect(isValidIndexId("has space")).toBe(false);
    expect(isValidIndexId("has/slash")).toBe(false);
  });
});

describe("apiContract: numeric rules", () => {
  it("bounds the base value exactly like the Worker", () => {
    expect(isValidBaseValue(1000)).toBe(true);
    expect(isValidBaseValue(MAX_BASE_VALUE)).toBe(true);
    expect(isValidBaseValue(MAX_BASE_VALUE + 1)).toBe(false);
    expect(isValidBaseValue(0)).toBe(false);
    expect(isValidBaseValue(-1)).toBe(false);
    expect(isValidBaseValue(Number.NaN)).toBe(false);
    expect(isValidBaseValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidBaseValue("1000")).toBe(false);
  });

  it("clamps an out-of-range base value into the contract instead of failing", () => {
    expect(clampBaseValue(5_000_000)).toBe(MAX_BASE_VALUE);
    expect(clampBaseValue(500)).toBe(500);
    expect(clampBaseValue(0)).toBe(1000);
    expect(clampBaseValue(Number.NaN)).toBe(1000);
  });

  it("bounds the weight and the sort order", () => {
    expect(isValidWeight(0.01)).toBe(true);
    expect(isValidWeight(100)).toBe(true);
    expect(isValidWeight(0)).toBe(false);
    expect(isValidWeight(101)).toBe(false);
    expect(isValidWeight(Number.NaN)).toBe(false);
    expect(isValidWeight("50")).toBe(false);

    expect(isValidSortOrder(0)).toBe(true);
    expect(isValidSortOrder(9999)).toBe(true);
    expect(isValidSortOrder(10000)).toBe(false);
    expect(isValidSortOrder(-1)).toBe(false);
    expect(isValidSortOrder(null)).toBe(false);
  });
});

describe("apiContract: basket validation", () => {
  const validItem = { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 40 };

  it("accepts a well-formed basket and normalises the ticker", () => {
    const result = validateBasketItems([{ ...validItem, ticker: " 7203.t " }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basket).toEqual([
      { ticker: "7203.T", name: "トヨタ", theme: "自動車", weight: 40 },
    ]);
  });

  it("rejects an invalid ticker with the Worker's message", () => {
    const result = validateBasketItems([{ ...validItem, ticker: "TICKER@SYM" }]);
    expect(result).toEqual({ ok: false, error: "Invalid basket item: ticker" });
  });

  it("rejects a duplicate ticker", () => {
    const result = validateBasketItems([validItem, { ...validItem, ticker: "7203" }]);
    expect(result).toEqual({ ok: false, error: "Duplicate ticker in basket: 7203" });
  });

  it("rejects a missing or over-long name", () => {
    expect(validateBasketItems([{ ...validItem, name: "" }])).toEqual({
      ok: false,
      error: "Invalid basket item: name",
    });
    expect(validateBasketItems([{ ...validItem, name: "x".repeat(101) }])).toEqual({
      ok: false,
      error: "Invalid basket item: name",
    });
  });

  it("rejects an out-of-range weight", () => {
    expect(validateBasketItems([{ ...validItem, weight: 0 }])).toEqual({
      ok: false,
      error: "Invalid basket item: weight must be > 0 and <= 100",
    });
    expect(validateBasketItems([{ ...validItem, weight: 101 }])).toEqual({
      ok: false,
      error: "Invalid basket item: weight must be > 0 and <= 100",
    });
  });

  it("requires a theme only when the caller asks for it", () => {
    const withoutTheme = { ticker: "7203", name: "トヨタ", weight: 40 };

    const lenient = validateBasketItems([withoutTheme]);
    expect(lenient.ok).toBe(true);
    if (lenient.ok) expect(lenient.basket[0].theme).toBe("カスタム");

    const strict = validateBasketItems([withoutTheme], { requireTheme: true });
    expect(strict).toEqual({ ok: false, error: "Invalid basket item: theme" });
  });

  it("rejects a non-object entry", () => {
    expect(validateBasketItems(["7203"])).toEqual({ ok: false, error: "Invalid basket item" });
    expect(validateBasketItems([null])).toEqual({ ok: false, error: "Invalid basket item" });
  });
});

describe("apiContract: the imported index stays inside the Worker's contract", () => {
  const buildJson = (baseValue: number, basketSize = 1) =>
    JSON.stringify({
      version: 1,
      name: "Import Test",
      baseValue,
      basket: Array.from({ length: basketSize }, (_, i) => ({
        ticker: `T${i}`,
        name: `Stock ${i}`,
        theme: "Tech",
        weight: 100 / basketSize,
      })),
    });

  it("clamps a base value the Worker would reject", () => {
    const result = deserializeIndexFromJson(buildJson(5_000_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The Worker answers 400 for anything above 1,000,000, so an imported
    // index that kept the raw value could never be calculated or saved again.
    expect(result.data.baseValue).toBe(MAX_BASE_VALUE);
    expect(isValidBaseValue(result.data.baseValue)).toBe(true);
  });

  it("keeps a base value inside the contract untouched", () => {
    const result = deserializeIndexFromJson(buildJson(2500));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.baseValue).toBe(2500);
  });

  it("truncates a basket that is larger than the Worker accepts", () => {
    const result = deserializeIndexFromJson(buildJson(1000, MAX_BASKET_ITEMS + 25));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.basket.length).toBe(MAX_BASKET_ITEMS);
  });
});

describe("apiContract: the owner token length is stated once", () => {
  it("matches the length the Worker accepts", () => {
    expect(MAX_OWNER_TOKEN_LENGTH).toBe(256);
  });
});

describe("apiContract: ticker normalization is single-sourced (M-2)", () => {
  it("exposes one normalization shared by indexEngine and yahooSymbol", () => {
    // The re-export must be the same function object, not a second spelling.
    expect(engineNormalizeTicker).toBe(canonicalNormalizeTicker);
  });

  it("normalizes full-width tickers before the contract judges them", () => {
    expect(canonicalNormalizeTicker("７２０３")).toBe("7203");
    expect(canonicalNormalizeTicker("  aapl ")).toBe("AAPL");
    expect(canonicalNormalizeTicker(null)).toBe("");
    expect(canonicalNormalizeTicker(undefined)).toBe("");
    expect(isValidTicker(canonicalNormalizeTicker("７２０３"))).toBe(true);
  });

  it("accepts a full-width ticker in validateBasketItems via normalization", () => {
    const result = validateBasketItems([
      { ticker: "７２０３", name: "トヨタ", theme: "自動車", weight: 40 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basket[0].ticker).toBe("7203");
  });

  it("detects duplicates after normalization, not before", () => {
    const result = validateBasketItems([
      { ticker: "７２０３", name: "トヨタ", theme: "自動車", weight: 40 },
      { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 40 },
    ]);
    expect(result).toEqual({ ok: false, error: "Duplicate ticker in basket: 7203" });
  });

  it("emits byte-identical baskets for superficially different spellings (M-6)", () => {
    // The Worker ETag-fingerprints `JSON.stringify({ baseValue, basket })`.
    // Key order and whitespace differences must not produce a second ETag
    // for the same response-affecting content, or the cache hit rate drops.
    const messy = validateBasketItems([
      { ticker: " 7203 ", name: " トヨタ ", theme: " 自動車 ", weight: 40 },
      { ticker: "ａａｐｌ", name: "Apple", theme: "Tech", weight: 60 },
    ]);
    const clean = validateBasketItems([
      { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 40 },
      { ticker: "AAPL", name: "Apple", theme: "Tech", weight: 60 },
    ]);
    expect(messy.ok).toBe(true);
    expect(clean.ok).toBe(true);
    if (!messy.ok || !clean.ok) return;
    expect(messy.basket).toEqual(clean.basket);
    expect(JSON.stringify({ baseValue: 1000, basket: messy.basket })).toBe(
      JSON.stringify({ baseValue: 1000, basket: clean.basket }),
    );
  });

  it("still rejects tickers that are invalid after normalization", () => {
    expect(
      validateBasketItems([{ ticker: "ＴＩＣＫＥＲ＠ＳＹＭ", name: "x", theme: "t", weight: 1 }]),
    ).toEqual({ ok: false, error: "Invalid basket item: ticker" });
    expect(validateBasketItems([{ ticker: "   ", name: "x", theme: "t", weight: 1 }])).toEqual({
      ok: false,
      error: "Invalid basket item: ticker",
    });
  });
});

describe("apiContract: single-stock validation is single-sourced (M-1)", () => {
  it("accepts a well-formed constituent and normalizes the ticker", () => {
    const result = validateSingleStockItem({
      ticker: " 7203 ",
      name: " トヨタ ",
      theme: " 自動車 ",
      weight: 20,
    });
    expect(result).toEqual({
      ok: true,
      item: { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 20 },
    });
  });

  it("accepts a full-width ticker exactly like the bulk validator", () => {
    const result = validateSingleStockItem({ ticker: "７２０３", name: "トヨタ", weight: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.ticker).toBe("7203");
  });

  it("defaults a missing theme to カスタム for backward compatibility", () => {
    for (const stock of [
      { ticker: "7203", name: "トヨタ", weight: 10 },
      { ticker: "7203", name: "トヨタ", theme: undefined, weight: 10 },
    ]) {
      const result = validateSingleStockItem(stock);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.item.theme).toBe("カスタム");
    }
  });

  it("defaults a missing or empty weight to 10", () => {
    for (const weight of [undefined, null, ""]) {
      const result = validateSingleStockItem({ ticker: "7203", name: "トヨタ", weight });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.item.weight).toBe(10);
    }
  });

  it("coerces numeric strings the way the endpoint always did", () => {
    const result = validateSingleStockItem({ ticker: "7203", name: "トヨタ", weight: "50" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.weight).toBe(50);
  });

  it("reports the endpoint's Japanese messages for each invalid field", () => {
    expect(validateSingleStockItem({ ticker: "BAD@T", name: "トヨタ", weight: 10 })).toEqual({
      ok: false,
      error: "無効な銘柄コードです",
    });
    expect(validateSingleStockItem({ ticker: "7203", name: "", weight: 10 })).toEqual({
      ok: false,
      error: "銘柄名は1〜100文字で入力してください",
    });
    expect(validateSingleStockItem({ ticker: "7203", name: "x".repeat(101), weight: 10 })).toEqual({
      ok: false,
      error: "銘柄名は1〜100文字で入力してください",
    });
    expect(
      validateSingleStockItem({ ticker: "7203", name: "トヨタ", theme: "x".repeat(101), weight: 10 }),
    ).toEqual({ ok: false, error: "テーマは100文字以内で入力してください" });
    for (const weight of [0, -1, 101, "abc", Number.NaN]) {
      expect(validateSingleStockItem({ ticker: "7203", name: "トヨタ", weight })).toEqual({
        ok: false,
        error: "銘柄の構成比率 (weight) は0超100以下の数値を指定してください",
      });
    }
  });

  it("rejects non-object payloads with the endpoint's message", () => {
    for (const stock of [null, undefined, "7203", 42, [{ ticker: "7203" }]]) {
      expect(validateSingleStockItem(stock)).toEqual({
        ok: false,
        error: "銘柄情報 (stock) は必須です",
      });
    }
  });
});

describe("apiContract: legacy weight repair is single-sourced (M-5)", () => {
  it("states the repair value the Worker reader applies", () => {
    expect(LEGACY_REPAIRED_WEIGHT).toBe(1);
  });
});

describe("apiContract: error pipeline is single-sourced (M-8)", () => {
  it("isRecord narrows only plain objects", () => {
    expect(isRecord({ error: "x" })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([{ error: "x" }])).toBe(false);
    expect(isRecord("error")).toBe(false);
    expect(isRecord(42)).toBe(false);
  });

  it("isApiErrorBody accepts any object with a string error", () => {
    expect(isApiErrorBody({ error: "bad" })).toBe(true);
    expect(isApiErrorBody({ ok: false, error: "bad", locked: true })).toBe(true);
    expect(isApiErrorBody({ error: 42 })).toBe(false);
    expect(isApiErrorBody({})).toBe(false);
    expect(isApiErrorBody(null)).toBe(false);
    expect(isApiErrorBody("<html>error</html>")).toBe(false);
  });

  it("extractApiErrorMessage trims, and falls back otherwise", () => {
    expect(extractApiErrorMessage({ error: "  bad  " }, "fallback")).toBe("bad");
    expect(extractApiErrorMessage({ error: "" }, "fallback")).toBe("fallback");
    expect(extractApiErrorMessage({ error: 42 }, "fallback")).toBe("fallback");
    expect(extractApiErrorMessage(null, "fallback")).toBe("fallback");
    expect(extractApiErrorMessage("text", "fallback")).toBe("fallback");
  });

  it("readResponseErrorMessage reads the Worker message", async () => {
    const res = new Response(JSON.stringify({ ok: false, error: "銘柄名は1〜100文字で入力してください" }), {
      headers: { "content-type": "application/json" },
    });
    await expect(readResponseErrorMessage(res, "fallback")).resolves.toBe(
      "銘柄名は1〜100文字で入力してください",
    );
  });

  it("FetchNetworkError carries the connection-check hint and the original cause", () => {
    const cause = new TypeError("Failed to fetch");
    const err = new FetchNetworkError({ cause });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("FetchNetworkError");
    expect(err.message).toBe(NETWORK_UNREACHABLE_MESSAGE);
    expect(err.message).toBe(
      "サーバーに接続できませんでした。ネットワーク接続を確認して再試行してください。",
    );
    expect(err.cause).toBe(cause);
  });

  it("FetchNetworkError works without a cause", () => {
    const err = new FetchNetworkError();
    expect(err.message).toBe(NETWORK_UNREACHABLE_MESSAGE);
    expect(err.cause).toBeUndefined();
  });

  describe("fetchWithNetworkMark", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("passes a successful response through untouched", async () => {
      const ok = new Response(JSON.stringify({ ok: true }), { status: 200 });
      vi.stubGlobal("fetch", vi.fn(async () => ok));
      await expect(fetchWithNetworkMark("http://localhost/api/indices")).resolves.toBe(ok);
    });

    it("marks a TypeError rejection with the connection hint and cause", async () => {
      const cause = new TypeError("Failed to fetch");
      installFailingFetch(cause);
      const failure = await fetchWithNetworkMark("http://localhost/api/indices").catch(
        (err: unknown) => err,
      );
      expect(failure).toBeInstanceOf(FetchNetworkError);
      expect((failure as Error).message).toBe(NETWORK_UNREACHABLE_MESSAGE);
      expect((failure as FetchNetworkError).cause).toBe(cause);
    });

    it("marks even a non-Error rejection: the transport never reached the server", async () => {
      installFailingFetch("boom");
      const failure = await fetchWithNetworkMark("http://localhost/api/indices").catch(
        (err: unknown) => err,
      );
      expect(failure).toBeInstanceOf(FetchNetworkError);
    });

    it("rethrows untouched when the request signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const cause = new TypeError("Failed to fetch");
      installFailingFetch(cause);
      const failure = await fetchWithNetworkMark("http://localhost/api/indices", {
        signal: controller.signal,
      }).catch((err: unknown) => err);
      expect(failure).toBe(cause);
    });

    it("rethrows an AbortError rejection even without a signal", async () => {
      const abortErr = new DOMException("The operation was aborted.", "AbortError");
      installFailingFetch(abortErr);
      const failure = await fetchWithNetworkMark("http://localhost/api/indices").catch(
        (err: unknown) => err,
      );
      expect(failure).toBe(abortErr);
    });

    it("owns the deadline: a pending request fails as FetchTimeoutError, not as a network error", async () => {
      const fetchMock = installAbortableHangingFetch();
      const failure = await fetchWithNetworkMark("http://localhost/api/indices", {
        timeoutMs: 10,
      }).catch((err: unknown) => err);

      expect(isFetchTimeoutError(failure)).toBe(true);
      expect((failure as Error).message).toBe(REQUEST_TIMEOUT_MESSAGE);
      expect((failure as Error).cause).toBeInstanceOf(DOMException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rethrows a caller abort untouched instead of reporting the deadline", async () => {
      installAbortableHangingFetch();
      const controller = new AbortController();
      const request = fetchWithNetworkMark("http://localhost/api/indices", {
        signal: controller.signal,
        timeoutMs: 10_000,
      });

      controller.abort();
      const failure = await request.catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(DOMException);
      expect((failure as DOMException).name).toBe("AbortError");
      expect(isFetchTimeoutError(failure)).toBe(false);
    });

    it("keeps the deadline alive through a body that never settles", async () => {
      // Headers resolve immediately; only the body stays pending. The old
      // helper cleared its timer at this point, so readJsonBody waited forever.
      const body = new ReadableStream<Uint8Array>({ start() {} });
      const response = new Response(body, { status: 200 });
      vi.stubGlobal("fetch", vi.fn(async () => response));

      const wrapped = await fetchWithNetworkMark("http://localhost/api/indices", {
        timeoutMs: 20,
      });
      const failure = await readJsonBody(wrapped).catch((err: unknown) => err);

      expect(isFetchTimeoutError(failure)).toBe(true);
      expect((failure as Error).message).toBe(REQUEST_TIMEOUT_MESSAGE);
    });

    it("releases the deadline and caller listener after a normal body read", async () => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
        vi.stubGlobal("fetch", vi.fn(async () => response));

        const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
        const wrapped = await fetchWithNetworkMark("http://localhost/api/indices", {
          signal: controller.signal,
          timeoutMs: 10_000,
        });
        // Headers are in, but the body has not been consumed: the deadline is
        // still installed. The old helper had already cleared it here.
        expect(vi.getTimerCount()).toBe(1);
        await expect(wrapped.text()).resolves.toBe(JSON.stringify({ ok: true }));

        // The timer must not survive the body read.
        expect(vi.getTimerCount()).toBe(0);
        // And the caller listener must be removed, not left installed until
        // the caller happens to abort later.
        expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
      } finally {
        vi.useRealTimers();
      }
    });

    it("releases the deadline and caller listener when the body is not JSON", async () => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        const response = new Response("<html>proxy error</html>", { status: 200 });
        vi.stubGlobal("fetch", vi.fn(async () => response));

        const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
        const wrapped = await fetchWithNetworkMark("http://localhost/api/indices", {
          signal: controller.signal,
          timeoutMs: 10_000,
        });
        await expect(readJsonBody(wrapped)).resolves.toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
      } finally {
        vi.useRealTimers();
      }
    });

    it("releases a stalled body when the caller aborts", async () => {
      vi.useFakeTimers();
      try {
        const body = new ReadableStream<Uint8Array>({ start() {} });
        const response = new Response(body, { status: 200 });
        vi.stubGlobal("fetch", vi.fn(async () => response));
        const controller = new AbortController();
        const wrapped = await fetchWithNetworkMark("http://localhost/api/indices", {
          signal: controller.signal,
          timeoutMs: 10_000,
        });

        const read = readJsonBody(wrapped);
        controller.abort();
        await expect(read).resolves.toBeNull();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("releases a discarded response without reading its body", async () => {
      vi.useFakeTimers();
      try {
        const body = new ReadableStream<Uint8Array>({ start() {} });
        const response = new Response(body, { status: 200 });
        vi.stubGlobal("fetch", vi.fn(async () => response));
        const controller = new AbortController();
        const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

        const wrapped = await fetchWithNetworkMark("http://localhost/api/indices", {
          signal: controller.signal,
          timeoutMs: 10_000,
        });
        releaseResponse(wrapped);
        expect(vi.getTimerCount()).toBe(0);
        expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("readResponseErrorMessage falls back for HTML, empty and error-less bodies", async () => {
    const html = new Response("<html><body>502 Bad Gateway</body></html>", {
      headers: { "content-type": "text/html" },
    });
    await expect(readResponseErrorMessage(html, "fallback")).resolves.toBe("fallback");
    await expect(readResponseErrorMessage(new Response(""), "fallback")).resolves.toBe("fallback");
    const noError = new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
    await expect(readResponseErrorMessage(noError, "fallback")).resolves.toBe("fallback");
  });
});

describe("apiContract: readJsonBody", () => {
  it("returns the parsed JSON for a well-formed body", async () => {
    const res = new Response(JSON.stringify({ ok: true, series: [1, 2, 3] }), {
      headers: { "content-type": "application/json" },
    });
    const data = await readJsonBody<{ ok?: boolean; series?: unknown }>(res);
    expect(data).toEqual({ ok: true, series: [1, 2, 3] });
  });

  it("returns null for an HTML error page served with HTTP 200", async () => {
    const res = new Response("<html><body>502 Bad Gateway</body></html>", {
      headers: { "content-type": "text/html" },
    });
    expect(await readJsonBody(res)).toBeNull();
  });

  it("returns null for an empty body", async () => {
    expect(await readJsonBody(new Response(""))).toBeNull();
  });
});

describe("apiContract: parseJsonText (非 JSON 本文規約の一元化, N-6)", () => {
  it("parses well-formed JSON including primitives", () => {
    expect(parseJsonText('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonText("[1,2]")).toEqual([1, 2]);
    expect(parseJsonText("42")).toBe(42);
    expect(parseJsonText("null")).toBeNull();
  });

  it("maps every non-JSON body to null without throwing", () => {
    expect(parseJsonText("")).toBeNull();
    expect(parseJsonText("<html><body>502 Bad Gateway</body></html>")).toBeNull();
    expect(parseJsonText("{broken")).toBeNull();
    expect(parseJsonText('"unterminated')).toBeNull();
  });

  it("keeps readJsonBody and the text-level parser on the same convention", async () => {
    // 同一の非 JSON 本文が Response 経由でもテキスト経由でも同じく null になる
    // こと (旧 useBenchmark のローカル実装との差分が無いこと)。
    const bodies = ["", "<html>err</html>", "{broken"];
    for (const body of bodies) {
      expect(parseJsonText(body)).toBeNull();
      expect(await readJsonBody(new Response(body))).toBeNull();
    }
    const ok = '{"a":[1,2]}';
    expect(parseJsonText(ok)).toEqual({ a: [1, 2] });
    expect(await readJsonBody(new Response(ok))).toEqual({ a: [1, 2] });
  });
});
