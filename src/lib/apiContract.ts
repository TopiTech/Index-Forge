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
 * browser and Node specific dependencies.
 */

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
 * Whether a (already trimmed and upper-cased) ticker satisfies the contract.
 *
 * Callers normalize the value first — `normalizeTicker` in `indexEngine` does
 * the full-width to half-width conversion and the upper-casing — and this
 * predicate then only judges the character set and the length.
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

    if (typeof r.ticker !== "string" || !isValidTicker(r.ticker.trim())) {
      return { ok: false, error: "Invalid basket item: ticker" };
    }
    const ticker = r.ticker.trim().toUpperCase();
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
