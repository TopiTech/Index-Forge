/**
 * The single definition of the client <-> Worker API contract.
 *
 * Every rule the Worker enforces on a request body used to be re-implemented
 * in the client (and in a second, slightly different spelling in the Worker
 * itself). The duplication was not harmless: the client accepted a `baseValue`
 * that the Worker rejects with HTTP 400, so an imported index could never be
 * calculated or saved again, and two spellings of the ticker rule meant a
 * ticker could be accepted by one form and refused by another.
 *
 * This module is the only place the boundary is described. It has no imports
 * on purpose: the Worker bundles it through `src/lib`, so it must stay free of
 * browser and Node specific dependencies. The single exception is
 * `./yahooSymbol`, which is itself dependency-free pure string handling and
 * therefore equally safe to bundle into the Worker.
 */

import { normalizeTicker } from "./yahooSymbol";

/** Maximum length of a ticker symbol. */
export const MAX_TICKER_LENGTH = 20;

/**
 * Characters a ticker may consist of.
 *
 * The set covers plain equity tickers (`AAPL`, `7203`), exchange suffixes
 * (`7203.T`, `BRK_A`), index symbols (`^N225`), currency pairs (`USDJPY=X`)
 * and crypto pairs (`BTC-USD`).
 */
export const TICKER_PATTERN = /^[A-Za-z0-9.^=_-]+$/;

/** Maximum length of a user-supplied index id. */
export const MAX_INDEX_ID_LENGTH = 100;

/** Characters an index id may consist of. */
export const INDEX_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Maximum number of constituents a single index may hold. */
export const MAX_BASKET_ITEMS = 500;

/** Maximum length of a constituent name. */
export const MAX_STOCK_NAME_LENGTH = 100;

/** Maximum length of a constituent theme / sector label. */
export const MAX_THEME_LENGTH = 100;

/** Maximum length of an index description. */
export const MAX_DESCRIPTION_LENGTH = 500;

/** Exclusive lower bound of a constituent weight. */
export const MIN_WEIGHT = 0;

/** Inclusive upper bound of a constituent weight (percent). */
export const MAX_WEIGHT = 100;

/**
 * Exclusive lower bound of the base value an index is scaled to.
 *
 * The contract check is `baseValue > MIN_BASE_VALUE` (a base value of 0 would
 * make every calculated point 0/0), so the bound itself is rejected.
 */
export const MIN_BASE_VALUE = 0;

/** Inclusive upper bound of the base value an index is scaled to. */
export const MAX_BASE_VALUE = 1_000_000;

/** Inclusive lower bound of an index sort order. */
export const MIN_SORT_ORDER = 0;

/** Inclusive upper bound of an index sort order. */
export const MAX_SORT_ORDER = 9999;

/** Maximum length of an owner token. */
export const MAX_OWNER_TOKEN_LENGTH = 256;

/**
 * Whether a (already normalized) ticker satisfies the contract.
 *
 * Callers normalize the value first — `normalizeTicker` in `./yahooSymbol`
 * does the trimming, the full-width to half-width conversion and the
 * upper-casing — and this predicate then only judges the character set and
 * the length.
 */
export function isValidTicker(ticker: string): boolean {
  return (
    ticker.length > 0 && ticker.length <= MAX_TICKER_LENGTH && TICKER_PATTERN.test(ticker)
  );
}

/** Whether an index id satisfies the contract. */
export function isValidIndexId(indexId: string): boolean {
  return (
    indexId.length > 0 &&
    indexId.length <= MAX_INDEX_ID_LENGTH &&
    INDEX_ID_PATTERN.test(indexId)
  );
}

/** Whether a constituent weight satisfies the contract. */
export function isValidWeight(weight: unknown): weight is number {
  return (
    typeof weight === "number" &&
    Number.isFinite(weight) &&
    weight > MIN_WEIGHT &&
    weight <= MAX_WEIGHT
  );
}

/** Whether a base value satisfies the contract. */
export function isValidBaseValue(baseValue: unknown): baseValue is number {
  return (
    typeof baseValue === "number" &&
    Number.isFinite(baseValue) &&
    baseValue > MIN_BASE_VALUE &&
    baseValue <= MAX_BASE_VALUE
  );
}

/** Whether a sort order satisfies the contract. */
export function isValidSortOrder(sortOrder: unknown): sortOrder is number {
  return (
    typeof sortOrder === "number" &&
    Number.isFinite(sortOrder) &&
    sortOrder >= MIN_SORT_ORDER &&
    sortOrder <= MAX_SORT_ORDER
  );
}

/**
 * Clamp a base value into the range the Worker accepts.
 *
 * Used when importing an index: an out-of-range value is repaired instead of
 * being carried over, because the Worker would reject the whole request and
 * leave the imported index permanently unsaveable.
 */
export function clampBaseValue(baseValue: number, fallback = 1000): number {
  if (!Number.isFinite(baseValue)) return fallback;
  if (baseValue <= MIN_BASE_VALUE) return fallback;
  return Math.min(baseValue, MAX_BASE_VALUE);
}

/** A constituent of an index, in the shape the Worker stores and returns. */
export interface BasketItemInput {
  ticker: string;
  name: string;
  theme: string;
  weight: number;
}

/**
 * Weight assigned when a legacy D1 row carries a NULL, zero or negative
 * weight.
 *
 * Pre-contract rows predate the `weight > 0` rule, and `GET /api/indices`
 * must still return a basket that `POST /api/indices` accepts. The single
 * repair value is stated here so the Worker reader and the client sanitizer
 * cannot drift apart again (one repairing to 1 while the other keeps 0).
 */
export const LEGACY_REPAIRED_WEIGHT = 1;

/** A single constituent in the shape `POST /api/indices/stock` accepts. */
export interface SingleStockItemInput {
  ticker: string;
  name: string;
  theme: string;
  weight: number;
}

/** Outcome of {@link validateSingleStockItem}. */
export type SingleStockValidationResult =
  | { ok: true; item: SingleStockItemInput }
  | { ok: false; error: string };

/**
 * Validate one constituent exactly the way `POST /api/indices/stock` does.
 *
 * The endpoint used to hand-roll this loop (ticker/name/theme/weight checks
 * with Japanese messages) while `validateBasketItems` described the same
 * rules for the bulk endpoints, so a change to one spelling silently produced
 * two boundaries. This is the single spelling; the Worker delegates to it.
 *
 * The intentional differences from the bulk contract are preserved: a missing
 * theme defaults to `"カスタム"` (the single-item form predates the theme
 * requirement) and a missing/empty weight defaults to 10.
 */
export function validateSingleStockItem(stock: unknown): SingleStockValidationResult {
  if (!stock || typeof stock !== "object" || Array.isArray(stock)) {
    return { ok: false, error: "銘柄情報 (stock) は必須です" };
  }
  const raw = stock as Record<string, unknown>;

  const ticker = typeof raw.ticker === "string" ? normalizeTicker(raw.ticker) : "";
  if (!isValidTicker(ticker)) {
    return { ok: false, error: "無効な銘柄コードです" };
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > MAX_STOCK_NAME_LENGTH) {
    return { ok: false, error: "銘柄名は1〜100文字で入力してください" };
  }

  const theme = typeof raw.theme === "string" ? raw.theme.trim() : "カスタム";
  if (theme.length > MAX_THEME_LENGTH) {
    return { ok: false, error: "テーマは100文字以内で入力してください" };
  }

  const rawWeight =
    raw.weight === undefined || raw.weight === null || raw.weight === ""
      ? 10
      : Number(raw.weight);
  if (!isValidWeight(rawWeight)) {
    return { ok: false, error: "銘柄の構成比率 (weight) は0超100以下の数値を指定してください" };
  }

  return { ok: true, item: { ticker, name, theme, weight: rawWeight } };
}

/** Outcome of {@link validateBasketItems}. */
export type BasketValidationResult =
  | { ok: true; basket: BasketItemInput[] }
  | { ok: false; error: string };

/**
 * Validate a basket exactly the way the Worker does.
 *
 * Both `POST /api/indices` and `POST /api/calculate` used to carry their own
 * copy of this loop. The two copies accepted exactly the same payloads and
 * answered with exactly the same messages, so every future change to the
 * contract had to be made twice — and a change made in only one of them
 * silently produced two different boundaries.
 *
 * `requireTheme` encodes the one intentional difference between the two
 * endpoints: `POST /api/calculate` requires a theme, while the single-item
 * stock endpoint predates that rule and defaults an absent theme for
 * backwards compatibility.
 */
export function validateBasketItems(
  items: readonly unknown[],
  options: { requireTheme?: boolean } = {},
): BasketValidationResult {
  const basket: BasketItemInput[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Invalid basket item" };
    }
    const r = item as Record<string, unknown>;

    // Normalize here (not only at the callers): direct API callers send raw
    // full-width tickers that the UI path had already normalized, so judging
    // the raw text produced a second, stricter boundary (HTTP 400) for the
    // same value the UI accepted.
    const ticker = typeof r.ticker === "string" ? normalizeTicker(r.ticker) : "";
    if (!isValidTicker(ticker)) {
      return { ok: false, error: "Invalid basket item: ticker" };
    }
    if (seen.has(ticker)) {
      return { ok: false, error: `Duplicate ticker in basket: ${ticker}` };
    }
    seen.add(ticker);

    if (
      typeof r.name !== "string" ||
      r.name.trim().length === 0 ||
      r.name.trim().length > MAX_STOCK_NAME_LENGTH
    ) {
      return { ok: false, error: "Invalid basket item: name" };
    }

    if (options.requireTheme) {
      if (typeof r.theme !== "string" || r.theme.trim().length > MAX_THEME_LENGTH) {
        return { ok: false, error: "Invalid basket item: theme" };
      }
    } else if (
      r.theme !== undefined &&
      (typeof r.theme !== "string" || r.theme.trim().length > MAX_THEME_LENGTH)
    ) {
      return { ok: false, error: "Invalid basket item: theme" };
    }

    if (!isValidWeight(r.weight)) {
      return { ok: false, error: "Invalid basket item: weight must be > 0 and <= 100" };
    }

    basket.push({
      ticker,
      name: r.name.trim(),
      theme: typeof r.theme === "string" ? r.theme.trim() : "カスタム",
      weight: r.weight,
    });
  }

  return { ok: true, basket };
}

/**
 * Read a JSON body from a fetch Response, returning `null` when the body is
 * not valid JSON.
 *
 * Several callers await `res.json()` on the success path without guarding it
 * (`useCalculation`, `useSimulation`, `useIndices`). When a proxy or an error
 * page answers HTTP 200 with HTML, that threw a raw `SyntaxError` whose
 * message ("Unexpected token '<' …") reached the user or, worse, skipped the
 * graceful fallback the surrounding code had prepared. This helper is the one
 * place that decision is made: a non-JSON body is a failed response, not an
 * exception.
 *
 * Like the rest of this module it must stay free of browser/Node specific
 * imports: the Worker typecheck compiles this file too, and `Response` exists
 * in both runtime type worlds.
 */
export async function readJsonBody<T = unknown>(res: Response): Promise<T | null> {
  try {
    const value = (await res.json()) as T;
    return value;
  } catch {
    return null;
  }
}

/**
 * Whether a parsed JSON value is a plain object record.
 *
 * Response bodies are untrusted (proxies and error pages answer 200 with
 * HTML, which `readJsonBody` already maps to `null`, but a JSON array or
 * primitive is still valid JSON). Narrowing through this predicate keeps
 * callers from casting `res.json()` straight to `Record<string, unknown>`.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Whether a parsed response body carries a usable string `error` field.
 *
 * The Worker answers failures as `{ error: string, ... }` (sometimes with
 * extra fields such as `ok`, `locked` or `remainingSeconds`), while proxies
 * and error pages answer with HTML or empty bodies. Narrowing the parsed body
 * through this predicate keeps every caller from casting `res.json()` straight
 * to `Record<string, unknown>` and reading `.error` off whatever came back.
 */
export function isApiErrorBody(value: unknown): value is { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string";
}

/**
 * Extract the displayable `error` message from an already-parsed body.
 *
 * The pure, synchronous half of the error pipeline: a body that carries no
 * usable string `error` yields `fallback`. The status-suffixed variant for
 * privileged calls lives in `src/lib/auth.ts` (`readApiErrorMessage`) and
 * delegates to this predicate, so the "what counts as an error body" rule is
 * stated once.
 */
export function extractApiErrorMessage(body: unknown, fallback: string): string {
  if (isApiErrorBody(body)) {
    const message = body.error.trim();
    if (message) return message;
  }
  return fallback;
}

/**
 * Read the `error` message of a failed API response, single-sourced.
 *
 * Every failure path used to do `(await res.json().catch(() => ({})))` and
 * then read `.error` off an unchecked cast, so a non-JSON body produced an
 * empty object and the real fallback message handling was duplicated at each
 * call site. A body that is not JSON, or that carries no string `error`,
 * yields `fallback` — the caller states its context message once.
 */
export async function readResponseErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await readJsonBody<unknown>(res);
  return extractApiErrorMessage(body, fallback);
}

/**
 * Shown when the request never reached the server (DNS, offline, refused,
 * or an opaque CORS rejection such as LAN testing against a loopback-only
 * origin). `fetch()` reports all of these as a `TypeError` with no status,
 * so without a marker they were indistinguishable from a server failure and
 * the raw English browser text ("Failed to fetch") reached the UI.
 */
export const NETWORK_UNREACHABLE_MESSAGE =
  "サーバーに接続できませんでした。ネットワーク接続を確認して再試行してください。";

/**
 * Marker for a `fetch()` rejection, thrown only around the `fetch()` call.
 *
 * Scoping matters: a `TypeError` raised later (a genuine bug in response
 * handling) must keep its own message instead of being mislabeled as a
 * network failure, so callers wrap just the transport, never the parsing.
 * The original rejection rides along as `cause` for diagnostics.
 */
export class FetchNetworkError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(NETWORK_UNREACHABLE_MESSAGE, options);
    this.name = "FetchNetworkError";
  }
}

/**
 * `fetch()` with transport failures marked as `FetchNetworkError`.
 *
 * The single place that decides "the server was never reached": a rejection
 * from `fetch()` (DNS, offline, refused, opaque CORS) carries no status, so
 * callers must not sniff `err.message` (browser-locale English, brittle).
 * An aborted request rethrows untouched so unmount/timeout paths keep their
 * silence; everything after the transport (status checks, JSON parsing) runs
 * outside this helper so a real bug there keeps its own message.
 */
export async function fetchWithNetworkMark(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (fetchErr) {
    if (init?.signal?.aborted) throw fetchErr;
    if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") throw fetchErr;
    throw new FetchNetworkError({ cause: fetchErr });
  }
}
