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
  isModernPasswordHash,
  upgradeLegacyPasswordHash,
  authenticatePassword,
  findPasswordCollision,
  MAX_PASSWORD_COLLISION_VERIFICATIONS,
  MAX_AUTH_ROW_VERIFICATIONS,
  ensurePasswordTable,
  resetPasswordTableEnsured,
  clearAuthCache,
  // Admin login security & Turnstile
  ADMIN_LOGIN_MAX_ATTEMPTS,
  ADMIN_LOGIN_LOCKOUT_SECONDS,
  TURNSTILE_DEFAULT_SITE_KEY,
  TURNSTILE_DEFAULT_SECRET_KEY,
  DEFAULT_DEV_ADMIN_SECRET_CODE,
  isLocalHostname,
  isLocalOrTestHost,
  verifyTurnstileToken,
  verifyAdminSecretCode,
  checkAdminLoginLockout,
  recordAdminLoginFailure,
  resetAdminLoginAttempts,
  // In-memory caches
  setAllowMemoryCacheInTest,
  getMemoryCache,
  getMemoryCacheEntry,
  setMemoryCache,
  clearMemoryCache,
  getMemoryCacheStats,
  approxMemoryCacheBytes,
  MAX_CALC_CACHE_BYTES,
  MAX_GENERAL_CACHE_BYTES,
  MAX_MEMORY_CACHE_ENTRY_BYTES,
  MAX_CALC_CACHE_SIZE,
  MAX_GENERAL_CACHE_SIZE,
  cacheHits,
  cacheMisses,
  resetCacheMetrics,
  // Cache / ETag helpers
  getMarketAwareCacheDuration,
  isPriceCacheFresh,
  generateETag,
  matchesIfNoneMatch,
  requestsFreshCalculation,
  // Ticker formatting and fetching
  formatTickerChange,
  formatTickerChangePercent,
  formatTickerPrice,
  fetchYahooQuote,
  fetchAllTickerQuotes,
  resetLastKnownTickerQuotes,
  // Live market overview and stock fundamentals
  fetchLiveMarketOverview,
  fetchLiveStockFundamentals,
  fetchLiveScreenerUniverse,
  fetchLiveMarketCalendar,
  fetchLiveMarketCalendarAsync,
  lastKnownCalendarEvents,
  getLastKnownCalendarEvents,
  resetLastKnownCalendarEvents,
  resetLastKnownScreenerUniverse,
  getYahooCrumb,
  resetYahooCrumbCache,
  resetLastKnownMarketOverview,
  lastKnownMarketOverview,
  OVERVIEW_ASSET_DEFS,
  SECTOR_SAMPLE_DEFINITIONS,
  // In-memory rate limiting and client IP
  HIGH_FREQUENCY_RATE_LIMIT_ENDPOINTS,
  MAX_MEMORY_RATE_LIMIT_ENTRIES,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
  checkMemoryRateLimit,
  checkRateLimit,
  clearMemoryRateLimits,
  memoryCache,
  memoryRateLimits,
  json,
  notModified,
  getClientIp,
  fetchSecEdgarFinancials,
  US_CIK_LOOKUP,
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
