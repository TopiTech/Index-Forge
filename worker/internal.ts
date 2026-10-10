/**
 * Test-facing surface for the Worker implementation.
 *
 * The Workers runtime treats every named export of the *entry* module
 * (`worker/index.ts`) as an `ExportedHandler` map entry and refuses to start
 * when a name is not a handler:
 *
 *   Uncaught TypeError: Incorrect type for map entry 'NAME':
 *   the provided value is not of type 'function or ExportedHandler'.
 *
 * The implementation therefore lives in `./internal-impl` and the entry point
 * exports a default handler only. This module re-exports the helpers the unit
 * tests need from that non-entry module; importing it has no effect on the
 * deployed Worker.
 */
export {
  // Schema-introspection helpers
  isMissingColumnError,
  isMissingTableError,
  // Index metadata
  SYSTEM_INDICES,
  TICKER_MAPPINGS,
  // Password hashing / authentication
  hashPassword,
  hashToken,
  timingSafeEqual,
  verifyPasswordHash,
  authenticatePassword,
  findPasswordCollision,
  ensurePasswordTable,
  resetPasswordTableEnsured,
  clearAuthCache,
  // In-memory caches
  setAllowMemoryCacheInTest,
  getMemoryCache,
  getMemoryCacheEntry,
  setMemoryCache,
  clearMemoryCache,
  // Cache / ETag helpers
  getMarketAwareCacheDuration,
  isPriceCacheFresh,
  generateETag,
  matchesIfNoneMatch,
  // Ticker formatting and fetching
  formatTickerChange,
  formatTickerChangePercent,
  formatTickerPrice,
  fetchYahooQuote,
  fetchAllTickerQuotes,
  resetLastKnownTickerQuotes,
  // In-memory rate limiting and client IP
  MAX_MEMORY_RATE_LIMIT_ENTRIES,
  checkMemoryRateLimit,
  clearMemoryRateLimits,
  getClientIp,
} from "./internal-impl";

export type {
  AuthResult,
  MemoryCacheLookup,
  PasswordCollisionCheckResult,
  TickerMappingItem,
  TickerPriceQuote,
  YahooQuoteSummary,
} from "./internal-impl";

// toYahooSymbol historically lived in the worker entry module; the canonical
// implementation is in src/lib/yahooSymbol and the Worker imports it there.
export { toYahooSymbol } from "../src/lib/yahooSymbol";
