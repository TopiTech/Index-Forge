import { useState, useEffect, useCallback, useRef } from "react";
import type { CustomIndex } from "../data/indices";
import { DEFAULT_INDICES } from "../data/indices";
import type { BasketItem } from "../types";
import {
  getIndexOwnerToken,
  persistConfirmedOwnerToken,
  removeIndexOwnerToken,
  isIndexOwner,
  serverIssuedAtToMs,
} from "../lib/ownership";
import { getAuthHeaders } from "../lib/auth";
import {
  LEGACY_REPAIRED_WEIGHT,
  fetchWithNetworkMark,
  isFetchTimeoutError,
  readJsonBody,
  readResponseErrorMessage,
  releaseResponse,
} from "../lib/apiContract";
import {
  sanitizeBasketForRequest,
  normalizeTicker,
  type BasketSanitizationOptions,
} from "../lib/indexEngine";
import { safeRandomId } from "../lib/randomId";

const API_BASE = "/api";
const INDICES_CACHE_KEY = "osi_indices_cache";
const INDICES_ETAG_KEY = "osi_indices_etag";
const INDICES_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Validate one index received from the API or read back from browser storage.
 *
 * Both payloads are untrusted: the cached copy can be hand-edited or written
 * by an older build, and the API response is assembled from D1 rows. Casting
 * either to `CustomIndex` without checking the shape made
 * `selectedIndex.basket` undefined for a malformed entry, and the dashboard
 * then threw while rendering `selectedIndex.basket.length`.
 *
 * The validator preserves the Worker's own semantics: a legacy row with a
 * NULL weight is reported as `0` (the Worker emits `COALESCE(weight, 0)`) and
 * the save path repairs it, so the displayed values do not change.
 */
export function sanitizeIndex(raw: unknown): CustomIndex | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return null;

  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : id;
  const description = typeof record.description === "string" ? record.description : "";

  const baseValue =
    typeof record.baseValue === "number" && Number.isFinite(record.baseValue) && record.baseValue > 0
      ? record.baseValue
      : 1000;

  const rawBasket = Array.isArray(record.basket) ? record.basket : [];
  const basket: BasketItem[] = [];
  const seen = new Set<string>();
  for (const item of rawBasket) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const ticker = typeof entry.ticker === "string" ? entry.ticker.trim().toUpperCase() : "";
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    // Non-positive weights are legacy (NULL/zero/negative) rows: the Worker
    // reader repairs them to LEGACY_REPAIRED_WEIGHT, so the client applies
    // the same rule instead of keeping 0. Displaying 0 while the save path
    // silently rebalanced it made the displayed basket differ from the saved
    // one (DATA-09/DATA-17).
    const weight =
      typeof entry.weight === "number" && Number.isFinite(entry.weight) && entry.weight > 0
        ? Math.min(entry.weight, 100)
        : LEGACY_REPAIRED_WEIGHT;
    basket.push({
      ticker,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : ticker,
      theme: typeof entry.theme === "string" ? entry.theme : "カスタム",
      weight,
    });
  }

  const index: CustomIndex = { id, name, description, baseValue, basket };
  if (typeof record.sortOrder === "number" && Number.isFinite(record.sortOrder)) {
    index.sortOrder = Math.min(9999, Math.max(0, Math.floor(record.sortOrder)));
  }
  return index;
}

/** Validate a whole index list; returns null when nothing usable remains. */
export function sanitizeIndexList(raw: unknown): CustomIndex[] | null {
  if (!Array.isArray(raw)) return null;
  const indices = raw
    .map(sanitizeIndex)
    .filter((index): index is CustomIndex => index !== null);
  return indices.length > 0 ? indices : null;
}

/**
 * Keep the current selection while it still exists, otherwise fall back to
 * the first entry of the list.
 *
 * A deleted index must not stay selected (the dashboard would keep rendering
 * an index that no longer exists), and a selection that never existed has to
 * start at the head of the list.
 */
export function resolveSelectedIndex(
  prev: CustomIndex | null,
  list: CustomIndex[],
): CustomIndex | null {
  if (!prev) return list[0];
  const found = list.find((d) => d.id === prev.id);
  return found || list[0];
}

function getLocalIndicesCache(): CustomIndex[] | null {
  try {
    const raw = localStorage.getItem(INDICES_CACHE_KEY);
    if (!raw) return null;
    return sanitizeIndexList(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * A conditional request is only useful when this tab still has the matching
 * response body. Sending an old ETag after localStorage was cleared makes a
 * valid 304 response leave the UI stuck on the built-in fallback indices.
 */
export function getIndicesRequestHeaders(
  cachedIndices: CustomIndex[] | null,
): Record<string, string> {
  if (!cachedIndices) return {};
  try {
    const etag = localStorage.getItem(INDICES_ETAG_KEY);
    return etag ? { "If-None-Match": etag } : {};
  } catch {
    return {};
  }
}

/**
 * Owner tokens are secrets. They travel in the `x-owner-token` header only —
 * never in the URL (which would leak them into server access logs, browser
 * history, and analytics). The Worker accepts the header on every
 * owner-protected endpoint. These pure builders encode that policy so it can
 * be unit-tested without React or the network.
 */
export function withOwnerTokenHeader(
  authHeaders: Record<string, string>,
  ownerToken: string | null,
): Record<string, string> {
  if (!ownerToken) return { ...authHeaders };
  return { ...authHeaders, "x-owner-token": ownerToken };
}

export function buildDeleteIndexRequest(
  id: string,
  ownerToken: string | null,
  authHeaders: Record<string, string> = {},
): { url: string; headers: Record<string, string> } {
  const queryParams = new URLSearchParams({ id });
  return {
    url: `${API_BASE}/indices?${queryParams.toString()}`,
    headers: withOwnerTokenHeader(authHeaders, ownerToken),
  };
}

export function buildDeleteStockRequest(
  indexId: string,
  ticker: string,
  ownerToken: string | null,
  authHeaders: Record<string, string> = {},
): { url: string; headers: Record<string, string> } {
  const params = new URLSearchParams({ indexId, ticker });
  return {
    url: `${API_BASE}/indices/stock?${params.toString()}`,
    headers: withOwnerTokenHeader(authHeaders, ownerToken),
  };
}

export function buildSaveIndexRequest(
  newIndex: CustomIndex,
  ownerToken: string,
  authHeaders: Record<string, string> = {},
  options?: BasketSanitizationOptions,
): { headers: Record<string, string>; body: string } {
  // Worker 契約 (POST /api/indices) は weight 0< w <=100・ティッカー文字種・
  // 重複なし・name/theme 100 字以内を要求する。インポート由来の壊れた値の
  // ままだと 400 になり「保存できない」理由が分からないままデータが失われる
  // ため、リクエスト境界で補正する (計算系と同じ sanitizeBasketForRequest)。
  const { basket: requestBasket } = sanitizeBasketForRequest(newIndex.basket, options);
  const baseValue =
    typeof newIndex.baseValue === "number" &&
    Number.isFinite(newIndex.baseValue) &&
    newIndex.baseValue > 0
      ? Math.min(newIndex.baseValue, 1_000_000)
      : 1000;
  return {
    headers: {
      "Content-Type": "application/json",
      ...withOwnerTokenHeader(authHeaders, ownerToken),
    },
    body: JSON.stringify({ ...newIndex, basket: requestBasket, baseValue, ownerToken }),
  };
}

/**
 * Decide which owner token (if any) this browser persists after a save.
 * Only a server-confirmed token (the Worker echoes `ownerToken` back when
 * the write actually persisted its hash, i.e. new index creation) or the
 * already-stored token for this id may be saved. A caller-supplied token
 * that the server did not echo back must never be persisted: that happens
 * when an administrator edits another user's index, or when the write went
 * to a legacy schema without the owner column, and saving it would falsely
 * label the index as "My index". The signature deliberately has no
 * caller-token parameter so the unsafe value cannot flow in by accident.
 */
/**
 * Extract the owner token the Worker echoed back for this index id.
 *
 * Only an echoed token counts as server-confirmed: it proves the write
 * actually persisted the token hash. Anything else (a caller-supplied token,
 * or the previously stored one) must never be written to the store on the
 * strength of this response. Returns `null` when the server confirmed
 * nothing — the caller must then leave the store untouched.
 */
export function getEchoedOwnerToken(responseData: unknown): string | null {
  if (responseData === null || typeof responseData !== "object" || Array.isArray(responseData)) {
    return null;
  }
  const ownerToken = (responseData as Record<string, unknown>).ownerToken;
  return typeof ownerToken === "string" && ownerToken.length > 0 ? ownerToken : null;
}

export function resolvePersistedOwnerToken(
  responseData: unknown,
  storedToken: string | null,
): string | null {
  return getEchoedOwnerToken(responseData) || storedToken;
}

export function useIndices() {
  const [indices, setIndices] = useState<CustomIndex[]>(() => {
    const cached = getLocalIndicesCache();
    return cached || DEFAULT_INDICES;
  });
  const [selectedIndex, setSelectedIndex] = useState<CustomIndex | null>(() => {
    const cached = getLocalIndicesCache();
    return (cached && cached[0]) || DEFAULT_INDICES[0] || null;
  });
  const [loading, setLoading] = useState(() => !getLocalIndicesCache());
  const [error, setError] = useState<string | null>(null);
  // Mutations refetch the list immediately; without a generation guard a
  // slower earlier response could overwrite a newer one (e.g. a just-added
  // stock disappearing from the selected index until the next mutation).
  const requestIdRef = useRef(0);
  /**
   * Controller of the in-flight list request.
   *
   * The request must be cancelled when the consumer unmounts: otherwise it
   * keeps running and then writes to state that no longer has a consumer.
   */
  const abortRef = useRef<AbortController | null>(null);
  /**
   * True while the consumer is mounted.
   *
   * The request generation alone cannot detect an unmount: the generation is
   * only bumped by a newer request, so the aborted request of an unmounted
   * component still looked "current" and its catch block published an error
   * and a fallback list into state that nobody reads any more.
   */
  const mountedRef = useRef(true);
  /**
   * Mirror of the in-memory index list.
   *
   * The storage listener compares the list another tab wrote with the list
   * this tab shows. Keeping the mirror in a ref lets the listener stay
   * subscribed (it must not re-subscribe on every list change).
   */
  const indicesRef = useRef<CustomIndex[]>(indices);
  useEffect(() => {
    indicesRef.current = indices;
  }, [indices]);

  const fetchIndices = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const isCurrentRequest = () => requestId === requestIdRef.current && mountedRef.current;
    const cachedIndices = getLocalIndicesCache();
    // The controller is created before the try block so the catch can tell an
    // aborted request (unmount or timeout) from a real server failure.
    const controller = new AbortController();
    try {
      if (!cachedIndices) {
        setLoading(true);
      }
      setError(null);

      abortRef.current = controller;
      let res: Response;
      try {
        // Transport failures are marked inside the helper; the outer catch
        // reports the connection hint while the fallback below is unchanged.
        res = await fetchWithNetworkMark(`${API_BASE}/indices`, {
          headers: getIndicesRequestHeaders(cachedIndices),
          signal: controller.signal,
          timeoutMs: INDICES_REQUEST_TIMEOUT_MS,
        });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }

      if (res.status === 304) {
        // Not Modified: local cached indices are completely up-to-date!
        // This should be unreachable without a matching local cache because
        // getIndicesRequestHeaders omits the ETag in that situation.
        releaseResponse(res);
        return;
      }

      if (!res.ok) {
        releaseResponse(res);
        throw new Error("指数一覧の取得に失敗しました");
      }

      // HTTP 200 でも JSON でない本文(プロキシのHTMLエラー画面や204の空
      // 本文)は、生の SyntaxError ではなく取得失敗として扱う。catch 節の
      // キャッシュ/デフォルトへのフォールバックはそのまま機能する。
      const data = await readJsonBody<unknown>(res);
      if (data === null) throw new Error("指数一覧の応答を解析できませんでした");
      // The ETag and the body form one conditional-request pair: writing the
      // ETag before the body was validated (or by a superseded request) left
      // the stored ETag paired with a different body, so the next request
      // answered 304 and the UI silently kept the stale list.
      if (!isCurrentRequest()) {
        return sanitizeIndexList(data);
      }

      const newEtag = res.headers.get("etag");
      const indices = sanitizeIndexList(data);

      if (indices) {
        try {
          localStorage.setItem(INDICES_CACHE_KEY, JSON.stringify(indices));
        } catch {
          // Ignore storage failures; the in-memory state remains usable.
        }
        if (newEtag) {
          try {
            localStorage.setItem(INDICES_ETAG_KEY, newEtag);
          } catch {
            // Ignore storage failures; the in-memory state remains usable.
          }
        }
        setIndices(indices);
        setSelectedIndex((prev) => resolveSelectedIndex(prev, indices));
        return indices;
      } else {
        // The server's empty list supersedes any prior local response. Keep
        // neither its body nor its ETag paired with a stale local body; a
        // subsequent 304 must never resurrect deleted indices after reload.
        try {
          localStorage.removeItem(INDICES_CACHE_KEY);
          localStorage.removeItem(INDICES_ETAG_KEY);
        } catch {
          // Ignore storage failures; the in-memory fallback remains usable.
        }
        setIndices(DEFAULT_INDICES);
        setSelectedIndex((prev) => resolveSelectedIndex(prev, DEFAULT_INDICES));
        return DEFAULT_INDICES;
      }
    } catch (err) {
      if (controller.signal.aborted || isFetchTimeoutError(err) || !isCurrentRequest()) {
        // The request was aborted (the consumer unmounted or the request
        // timed out) or a newer request superseded it. An aborted request
        // must not publish an error, a fallback list or a selection: the
        // in-memory state stays as it is and the user can retry explicitly.
        return getLocalIndicesCache() ?? DEFAULT_INDICES;
      }
      const message =
        err instanceof Error && err.message
          ? err.message
          : "指数一覧の取得に失敗しました";
      setError(message);
      console.warn("API server unavailable, using cached/default indices:", err);
      // Fallback to local cached or built-in default indices so UI renders without failure
      const cached = getLocalIndicesCache();
      if (!cached) {
        setIndices(DEFAULT_INDICES);
        setSelectedIndex((prev) => resolveSelectedIndex(prev, DEFAULT_INDICES));
        return DEFAULT_INDICES;
      }
      return cached;
    } finally {
      if (isCurrentRequest()) {
        // The loading flag is released here (and not in the catch) so an
        // aborted request cannot leave the screen in the skeleton state. It is
        // not written at all once the consumer unmounted.
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchIndices();
  }, [fetchIndices]);

  // Track the mounted state so a request that settles after the consumer
  // unmounted cannot publish anything into state that nobody reads any more.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Cancel the in-flight list request when the consumer unmounts, so it cannot
  // keep running and then write to state that no longer has a consumer.
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // Keep this tab in sync with the other tabs that changed the shared index
  // cache. Without this listener a tab keeps showing the pre-change list
  // (and editing it would overwrite the other tab's change) until it is
  // reloaded.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      // A `null` key means the whole storage was cleared.
      if (
        event.key !== null &&
        event.key !== INDICES_CACHE_KEY &&
        event.key !== INDICES_ETAG_KEY
      ) {
        return;
      }
      const cached = getLocalIndicesCache();
      // The other tab may have written exactly the list this tab already
      // shows. Re-fetching then would only write the same payload back and
      // could start a cross-tab request loop, so nothing is done.
      const changed =
        !cached || JSON.stringify(cached) !== JSON.stringify(indicesRef.current);
      if (!changed) return;
      if (cached) {
        setIndices(cached);
        setSelectedIndex((prev) => resolveSelectedIndex(prev, cached));
      }
      // Re-validate with the server: the other tab may have written a newer
      // list (or removed entries) that this tab has not seen yet. The request
      // generation guard keeps a slower in-flight response from undoing it.
      void fetchIndices();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [fetchIndices]);

  const selectIndex = useCallback((index: CustomIndex) => {
    setSelectedIndex(index);
  }, []);

  const saveCustomIndex = useCallback(
    async (
      newIndex: CustomIndex,
      ownerToken?: string,
    ): Promise<{ ok: boolean; error?: string; ownerToken?: string; id?: string }> => {
      try {
        const storedToken = getIndexOwnerToken(newIndex.id);
        const token = ownerToken || storedToken || safeRandomId(24);
        const { headers, body } = buildSaveIndexRequest(newIndex, token, getAuthHeaders());
        const res = await fetchWithNetworkMark(`${API_BASE}/indices`, {
          method: "POST",
          headers,
          body,
        });
        if (!res.ok) {
          throw new Error(await readResponseErrorMessage(res, "指数の保存に失敗しました"));
        }
        const data = await readJsonBody<{
          id?: unknown;
          ownerToken?: unknown;
          ownerTokenIssuedAt?: unknown;
        }>(res);
        const savedId = (typeof data?.id === "string" && data.id.trim()) || newIndex.id;
        // resolvePersistedOwnerToken accepts only the server echo and the
        // stored value — the caller-supplied `token` cannot flow into
        // storage, so an admin editing another user's index (or a legacy
        // schema write) never falsely labels the index as "My index".
        const finalToken = resolvePersistedOwnerToken(data, storedToken);
        // Persist only what the server confirmed. When there is no echo the
        // stored entry (with its original issuance time) is left untouched:
        // rewriting it with "now" would slide the client-side expiry while
        // the Worker enforces the original absolute age. Likewise, an echo
        // without an issuance time keeps the stored age for the same token.
        const echoedToken = getEchoedOwnerToken(data);
        if (echoedToken && savedId) {
          persistConfirmedOwnerToken(
            savedId,
            echoedToken,
            serverIssuedAtToMs(data?.ownerTokenIssuedAt),
          );
        }
        try {
          localStorage.removeItem(INDICES_ETAG_KEY);
        } catch {
          // Ignore storage failures; the in-memory state remains usable.
        }

        const refreshedList = await fetchIndices();
        const found = refreshedList?.find((d) => d.id === savedId);
        const savedIndex = found || { ...newIndex, id: savedId };
        setSelectedIndex(savedIndex);
        return { ok: true, ownerToken: finalToken || undefined, id: savedId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "指数の保存に失敗しました";
        return { ok: false, error: msg };
      }
    },
    [fetchIndices],
  );

  const deleteCustomIndex = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const { url, headers } = buildDeleteIndexRequest(
          id,
          getIndexOwnerToken(id),
          getAuthHeaders(),
        );

        const res = await fetchWithNetworkMark(url, {
          method: "DELETE",
          headers,
        });
        if (!res.ok) {
          throw new Error(await readResponseErrorMessage(res, "指数の削除に失敗しました"));
        }

        removeIndexOwnerToken(id);
        try {
          localStorage.removeItem(INDICES_ETAG_KEY);
        } catch {
          // Ignore storage failures; the in-memory state remains usable.
        }
        await fetchIndices();
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "指数の削除に失敗しました";
        return { ok: false, error: msg };
      }
    },
    [fetchIndices],
  );

  const addStockToIndex = useCallback(
    async (
      indexId: string,
      stock: BasketItem,
      password?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const token = getIndexOwnerToken(indexId);
        const authHeaders = getAuthHeaders();
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...authHeaders,
        };
        if (password) {
          headers["x-auth-password"] = password;
        }
        if (token) {
          headers["x-owner-token"] = token;
        }
        const cleanTicker = normalizeTicker(stock.ticker);
        const cleanWeight =
          typeof stock.weight === "number" && Number.isFinite(stock.weight) && stock.weight > 0
            ? Math.min(stock.weight, 100)
            : 10;
        const sanitizedStock: BasketItem = {
          ticker: cleanTicker,
          name: (typeof stock.name === "string" && stock.name.trim() ? stock.name.trim() : cleanTicker).slice(0, 100),
          theme: (typeof stock.theme === "string" && stock.theme.trim() ? stock.theme.trim() : "カスタム").slice(0, 100),
          weight: cleanWeight,
        };
        const res = await fetchWithNetworkMark(`${API_BASE}/indices/stock`, {
          method: "POST",
          headers,
          body: JSON.stringify({ indexId, stock: sanitizedStock, password }),
        });
        if (!res.ok) {
          throw new Error(await readResponseErrorMessage(res, "銘柄の追加に失敗しました"));
        }
        try {
          localStorage.removeItem(INDICES_ETAG_KEY);
        } catch {
          // Ignore storage failures; the in-memory state remains usable.
        }
        await fetchIndices();
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "銘柄の追加に失敗しました";
        return { ok: false, error: msg };
      }
    },
    [fetchIndices],
  );

  const removeStockFromIndex = useCallback(
    async (
      indexId: string,
      ticker: string,
      password?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const authHeaders = getAuthHeaders();
        const headers: Record<string, string> = {
          ...authHeaders,
        };
        if (password) {
          headers["x-auth-password"] = password;
        }
        const { url, headers: deleteHeaders } = buildDeleteStockRequest(
          indexId,
          ticker,
          getIndexOwnerToken(indexId),
          headers,
        );
        const res = await fetchWithNetworkMark(url, {
          method: "DELETE",
          headers: deleteHeaders,
        });
        if (!res.ok) {
          throw new Error(await readResponseErrorMessage(res, "銘柄の削除に失敗しました"));
        }
        try {
          localStorage.removeItem(INDICES_ETAG_KEY);
        } catch {
          // Ignore storage failures; the in-memory state remains usable.
        }
        await fetchIndices();
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "銘柄の削除に失敗しました";
        return { ok: false, error: msg };
      }
    },
    [fetchIndices],
  );

  const refreshIndices = useCallback(async (): Promise<void> => {
    await fetchIndices();
  }, [fetchIndices]);

  return {
    indices,
    selectedIndex,
    selectIndex,
    loading,
    error,
    saveCustomIndex,
    deleteCustomIndex,
    addStockToIndex,
    removeStockFromIndex,
    refreshIndices,
    isOwner: isIndexOwner,
  };
}
