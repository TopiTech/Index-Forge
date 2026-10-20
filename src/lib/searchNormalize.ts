/**
 * Search-query normalizer shared by the search screens and the data service.
 *
 * This lives in its own module (instead of `src/data/stockUniverse`) so that the
 * eager `marketDataService` graph does not pull the 4,800-line stock universe
 * (≈300KB / 64KB gzip) into the first paint just to call a pure string helper.
 * `src/data/stockUniverse` re-exports it, so existing imports keep working and
 * the behavior stays identical.
 */

/**
 * Normalizes user queries for Japanese financial search:
 * 1. Unicode NFKC (Half-width Katakana -> Full-width, Full-width alphanumeric -> Half-width, Ideographic space -> ASCII space)
 * 2. Hiragana -> Katakana (とよた -> トヨタ)
 * 3. Lowercase English
 */
export function normalizeSearchQuery(query: string): string {
  if (typeof query !== "string" || !query) return "";
  const nfkc = query.normalize("NFKC").trim();
  return nfkc
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .toLowerCase();
}
