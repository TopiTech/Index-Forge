/**
 * Single owner of the client-side "sync prices → calculate" contract (DATA-25).
 *
 * Two screens need fresh daily prices before they calculate an index: the
 * dashboard (`useCalculation`) and the builder preview (`useSimulation`). They
 * used to carry their own copy of the contract, which drifted:
 *
 * - the batch size was 30 in one path (the Worker now caps a request at 12
 *   tickers and rejects the rest);
 * - only the dashboard sent auth headers, so an authenticated refresh behaved
 *   differently depending on the screen;
 * - the warning strings, the failed-row handling and the abort policy were
 *   duplicated and slightly different.
 *
 * Everything below is the one implementation both hooks call. It is pure
 * fetch/JSON logic (no DOM, no storage) so the Worker typecheck can compile it.
 */

/** Worker API prefix shared by every client request. */
const API_BASE = "/api";

/**
 * Maximum tickers accepted per `/api/sync-prices` request.
 *
 * The Worker rejects a larger request instead of truncating it, so callers must
 * batch themselves. 12 is the documented cap (SEC-11/DATA-07); a 13+ ticker
 * index now takes two requests instead of one rejected one.
 */
export const SYNC_BATCH_SIZE = 12;

/** Warning shown when the server's daily sync quota rejects a batch (HTTP 429). */
export const SYNC_RATE_LIMIT_WARNING =
  "価格同期が本日の上限に達しました。取得済みのデータで計算を続行します";

/** Warning shown when the sync request itself could not be sent. */
export const SYNC_NETWORK_ERROR_WARNING = "価格同期で通信エラーが発生しました";

/** Warning shown when a sync batch is answered with a non-2xx status. */
export function formatSyncBatchFailureWarning(batchNumber: number): string {
  return `価格同期バッチ ${batchNumber} が失敗しました`;
}

/** Warning listing the tickers the Worker could not refresh. */
export function formatSyncFailedTickersWarning(failed: readonly string[]): string {
  return `一部銘柄の価格取得に失敗: ${failed.join(", ")}`;
}

/** Split tickers into sync batches no larger than the Worker's request limit. */
export function buildSyncBatches(
  tickers: readonly string[],
  maxBatch = SYNC_BATCH_SIZE,
): string[][] {
  const batches: string[][] = [];
  const size = Number.isFinite(maxBatch) && maxBatch >= 1 ? Math.floor(maxBatch) : SYNC_BATCH_SIZE;
  for (let i = 0; i < tickers.length; i += size) {
    batches.push(tickers.slice(i, i + size));
  }
  return batches;
}

/**
 * Determine whether a price sync request should force-refresh prices.
 *
 * `force` means "re-fetch even cache-fresh rows", and the Worker requires
 * authentication for it. This decision used to live only in `useCalculation`;
 * `useSimulation` sent the raw `Boolean(force)` instead, so an unauthenticated
 * builder preview refresh produced an HTTP 401 for every batch and a wall of
 * sync warnings — the exact drift this module exists to prevent (DATA-25).
 * The policy is therefore defined here, next to the request it guards, and
 * both hooks call it before constructing their sync request.
 */
export function determineSyncForce(
  force: boolean,
  session: { password?: string } | null | undefined,
): boolean {
  return force && Boolean(session?.password);
}

export interface PriceSyncEntry {
  ticker: string;
  lastSynced: number;
}

export interface PriceSyncResult {
  /** Rows the Worker reported as synced or already cached. */
  synced: PriceSyncEntry[];
  /** Non-fatal problems, already de-duplicated and ready for display. */
  warnings: string[];
  /** True when at least one batch was rejected by the daily quota (HTTP 429). */
  rateLimited: boolean;
  /** True when the request was aborted; the caller must not publish state. */
  aborted: boolean;
}

export interface PriceSyncOptions {
  tickers: readonly string[];
  signal: AbortSignal;
  /** Ask the Worker to refresh cache-fresh rows too (requires authentication). */
  force?: boolean;
  /**
   * Authentication headers for this request. Both screens use the same policy:
   * whatever `getAuthHeaders(...)` returns (an empty object for guests).
   */
  authHeaders?: Record<string, string>;
  /** Optional caller-owned "this request was superseded" predicate. */
  isSuperseded?: () => boolean;
  /** Progress callback with the number of tickers already handled. */
  onProgress?: (completed: number, total: number) => void;
}

/** Normalize a Worker `lastSynced` value (seconds or milliseconds) to ms. */
export function toSyncTimestamp(value: unknown, fallback: number = Date.now()): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value < 1e11
      ? Math.round(value * 1000)
      : Math.round(value)
    : fallback;
}

interface SyncResponseRow {
  ticker?: unknown;
  status?: unknown;
  lastSynced?: unknown;
}

/**
 * Sync the given tickers in Worker-sized batches.
 *
 * The function never throws: a failure is reported through `warnings` so the
 * caller can continue to the calculation step (a sync problem must not hide the
 * prices that are already stored). An abort (unmount or a superseded request)
 * is reported through `aborted` so the caller can return before touching state.
 */
export async function syncPricesInBatches(options: PriceSyncOptions): Promise<PriceSyncResult> {
  const { tickers, signal, force = false, authHeaders, isSuperseded, onProgress } = options;
  const warnings: string[] = [];
  const synced: PriceSyncEntry[] = [];
  const abortedResult = (): PriceSyncResult => ({
    synced,
    warnings,
    rateLimited: false,
    aborted: true,
  });
  const wasAborted = () => signal.aborted || (isSuperseded ? isSuperseded() : false);

  if (tickers.length === 0) {
    return { synced, warnings, rateLimited: false, aborted: false };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authHeaders ?? {}),
  };

  let rateLimited = false;
  let completed = 0;
  const batches = buildSyncBatches(tickers);

  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    if (wasAborted()) return abortedResult();

    try {
      const res = await fetch(`${API_BASE}/sync-prices`, {
        method: "POST",
        headers,
        body: JSON.stringify({ tickers: batch, force }),
        signal,
      });
      if (wasAborted()) return abortedResult();

      if (res.status === 429) {
        // The daily quota is exhausted: keep calculating with what is already
        // stored instead of hammering the endpoint (and surfacing a hard error).
        warnings.push(SYNC_RATE_LIMIT_WARNING);
        rateLimited = true;
        break;
      }

      if (!res.ok) {
        warnings.push(formatSyncBatchFailureWarning(index + 1));
      } else {
        const data = (await res.json().catch(() => ({}))) as { results?: SyncResponseRow[] };
        if (wasAborted()) return abortedResult();
        if (Array.isArray(data.results)) {
          const failed: string[] = [];
          for (const row of data.results) {
            const ticker = typeof row?.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
            if (!ticker) continue;
            if (row.status === "synced" || row.status === "cached") {
              synced.push({ ticker, lastSynced: toSyncTimestamp(row.lastSynced) });
            } else if (row.status === "failed") {
              failed.push(ticker);
            }
          }
          if (failed.length > 0) {
            warnings.push(formatSyncFailedTickersWarning(failed));
          }
        }
      }
    } catch (err) {
      if (wasAborted() || (err instanceof DOMException && err.name === "AbortError")) {
        return abortedResult();
      }
      warnings.push(SYNC_NETWORK_ERROR_WARNING);
    }

    if (wasAborted()) return abortedResult();
    completed += batch.length;
    onProgress?.(completed, tickers.length);
  }

  return {
    synced,
    warnings: Array.from(new Set(warnings)),
    rateLimited,
    aborted: false,
  };
}
