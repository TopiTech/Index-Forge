import { searchStockUniverse, normalizeSearchQuery, getUniverseStockByTicker } from "./stockUniverse";
import {
  type PopularStock,
  POPULAR_STOCKS,
  PRESET_STOCKS,
} from "./popularStocksData";

export type { PopularStock };
export { POPULAR_STOCKS, PRESET_STOCKS };

export function searchPopularStocks(query: string, limit = 8): PopularStock[] {
  if (!query || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const normQ = normalizeSearchQuery(query);
  const normQUpper = normQ.toUpperCase();

  // Curated popular stocks first
  const popularMatches = POPULAR_STOCKS.filter((s) => {
    const sNormName = normalizeSearchQuery(s.name);
    const sTicker = s.ticker.toUpperCase();
    const sNameLower = s.name.toLowerCase();
    const sThemeLower = s.theme.toLowerCase();
    const uStock = getUniverseStockByTicker(s.ticker);
    return (
      sTicker === normQUpper ||
      sTicker.includes(normQUpper) ||
      sTicker.toLowerCase().includes(q) ||
      sNormName.startsWith(normQ) ||
      sNormName.includes(normQ) ||
      sNameLower.includes(q) ||
      sNameLower.includes(normQ) ||
      sThemeLower.includes(q) ||
      sThemeLower.includes(normQ) ||
      (uStock?.normAliases && uStock.normAliases.includes(normQ)) ||
      (uStock?.aliases && uStock.aliases.toLowerCase().includes(q))
    );
  });

  const seen = new Set<string>();
  const results: PopularStock[] = [];

  for (const s of popularMatches) {
    const tUpper = s.ticker.toUpperCase();
    if (!seen.has(tUpper)) {
      seen.add(tUpper);
      results.push(s);
      if (results.length >= limit) return results;
    }
  }

  // Supplement with 4,500+ stock universe
  const universeMatches = searchStockUniverse(query, { limit: limit * 2 });
  for (const u of universeMatches) {
    const tUpper = u.ticker.toUpperCase();
    if (!seen.has(tUpper)) {
      seen.add(tUpper);
      results.push({
        ticker: u.ticker,
        name: u.name,
        theme: u.sector || u.market,
      });
      if (results.length >= limit) break;
    }
  }

  return results;
}
