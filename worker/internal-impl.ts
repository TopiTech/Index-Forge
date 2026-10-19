// Per-attempt budget for PBKDF2 password verifications during login. This is a
// CPU safety valve, NOT an account limit: it must stay far above any realistic
// number of active accounts. A previous value of 15 silently rejected the
// correct password of every account past the 15th row (they were told the
// password was wrong, which is undiagnosable). At ~10-20ms per PBKDF2
// verification the full budget still fits comfortably inside the Workers CPU
// limit, and login attempts are separately rate limited per IP.
export const MAX_AUTH_ROW_VERIFICATIONS = 200;
import { calculateCustomIndex } from "../src/lib/indexEngine";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { SYSTEM_INDICES as SHARED_SYSTEM_INDICES } from "../src/data/indices";
import { POPULAR_STOCKS } from "../src/data/popularStocks";
import { BASELINE_ASSET_QUOTES } from "../src/data/marketConstants";
import {
  getStockFundamentals,
  type MarketOverviewData,
  type MarketAssetQuote,
  type SectorPerformance,
  type StockQuoteFundamentals,
  type CalendarEvent,
} from "../src/lib/marketDataService";
import {
  getMarketAwareCacheDuration as getMarketAwareCacheDurationShared,
  isPriceCacheFresh as isPriceCacheFreshShared,
} from "../src/lib/marketCache";
import { toYahooSymbol } from "../src/lib/yahooSymbol";
import type { BasketItem, PricePoint, StockSeries } from "../src/types";

/**
 * The static-assets binding.
 *
 * Modelled locally instead of importing the runtime `Fetcher` type: that type
 * ties the request to the Workers `Request` shape (which carries a `fetcher`
 * property), which conflicts with the DOM `Request` that the browser-facing
 * code and the tests use. The Worker only needs `fetch`.
 */
export interface AssetsBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/**
 * The subset of the Workers execution context the Worker actually uses.
 *
 * Declared locally for the same reason as `AssetsBinding`: the runtime type
 * carries `tracing`/`abort` members that are irrelevant here.
 */
export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface Env {
  ASSETS: AssetsBinding;
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  ADMIN_SECRET_CODE?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface AuthResult {
  authenticated: boolean;
  role?: "admin" | "user";
  name?: string;
  maxStocks?: number | null;
  maxIndices?: number | null;
  id?: string;
  error?: string;
}

export interface YahooChartResponse {
  chart?: {
    result?: {
      meta?: {
        regularMarketPrice?: number;
        regularMarketChange?: number;
        regularMarketChangePercent?: number;
        chartPreviousClose?: number;
        regularMarketVolume?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
      };
      timestamp: number[];
      indicators: {
        quote: { close: (number | null)[]; volume?: (number | null)[] }[];
      };
    }[];
  };
}

export interface D1Row {
  [key: string]: unknown;
}

export const PRICE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isPricePoint(value: unknown): value is PricePoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.date === "string" &&
    PRICE_DATE_PATTERN.test(point.date) &&
    typeof point.close === "number" &&
    Number.isFinite(point.close) &&
    point.close > 0 &&
    (point.volume === undefined ||
      (typeof point.volume === "number" && Number.isFinite(point.volume) && point.volume >= 0))
  );
}

export function sanitizePriceSeries(value: unknown): PricePoint[] {
  if (!Array.isArray(value)) return [];
  const byDate = new Map<string, PricePoint>();
  for (const point of value) {
    if (!isPricePoint(point)) continue;
    byDate.set(point.date, {
      date: point.date,
      close: point.close,
      ...(typeof point.volume === "number" ? { volume: point.volume } : {}),
    });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export interface SnapshotResponseData {
  snapshot: {
    symbol: string;
    label: string;
    current: number;
    change: number;
    changePct: number;
    updatedAt: string;
    description: string;
  };
  series: PricePoint[];
}

export function parseSnapshotResponseData(
  value: unknown,
  symbol: string,
  benchmark: { label: string; desc: string },
): SnapshotResponseData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!raw.snapshot || typeof raw.snapshot !== "object" || Array.isArray(raw.snapshot)) return null;

  const snapshot = raw.snapshot as Record<string, unknown>;
  const current = snapshot.current;
  const change = snapshot.change;
  const changePct = snapshot.changePct;
  const series = sanitizePriceSeries(raw.series);
  if (
    typeof current !== "number" ||
    !Number.isFinite(current) ||
    current <= 0 ||
    typeof change !== "number" ||
    !Number.isFinite(change) ||
    typeof changePct !== "number" ||
    !Number.isFinite(changePct) ||
    series.length === 0
  ) {
    return null;
  }

  return {
    snapshot: {
      symbol:
        typeof snapshot.symbol === "string" && snapshot.symbol.length > 0
          ? snapshot.symbol
          : symbol,
      label: typeof snapshot.label === "string" ? snapshot.label : benchmark.label,
      current,
      change,
      changePct,
      updatedAt: typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : "",
      description: typeof snapshot.description === "string" ? snapshot.description : benchmark.desc,
    },
    series,
  };
}

export function isMissingColumnError(error: unknown, column: string): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.toLowerCase().includes(column.toLowerCase()) &&
    /no column|no such column|does not exist/i.test(message)
  );
}

export function isMissingTableError(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.toLowerCase().includes(table.toLowerCase()) &&
    /no such table|no table|does not exist/i.test(message)
  );
}

export interface BasketItemInput {
  ticker: string;
  name: string;
  theme: string;
  weight: number;
}

export interface IndexWriteColumns {
  ownerTokenHash: boolean;
  creatorId: boolean;
  createdAt: boolean;
  sortOrder?: boolean;
}

export interface IndexWriteValues {
  id: string;
  name: string;
  description: string;
  baseValue: number;
  ownerTokenHash: string | null;
  creatorId: string | null;
  createdAt: number;
  sortOrder: number | null;
  /** Use REPLACE only for an existing row or a legacy schema without ownership metadata. */
  useReplace: boolean;
  /** When set, insert only while this creator is below the quota. */
  creationLimit?: number;
}

/**
 * Build the index upsert for the columns available on the deployed schema.
 *
 * D1 deployments can briefly be on different migration revisions. Keeping
 * optional columns out of the statement is safe only when the columns are
 * explicitly known to be unavailable; when they are present, the subqueries
 * preserve existing ownership/creation metadata during an admin edit.
 */
export function prepareIndexUpsert(
  env: Env,
  values: IndexWriteValues,
  columns: IndexWriteColumns,
): D1PreparedStatement {
  const columnNames = ["id", "name", "description", "base_value"];
  const valueExpressions = ["?", "?", "?", "?"];
  const params: (string | number | null)[] = [
    values.id,
    values.name,
    values.description,
    values.baseValue,
  ];

  if (columns.ownerTokenHash) {
    columnNames.push("owner_token_hash");
    valueExpressions.push("?");
    params.push(values.ownerTokenHash);
  }
  if (columns.creatorId) {
    columnNames.push("creator_id");
    valueExpressions.push("COALESCE((SELECT creator_id FROM indices WHERE id = ?), ?)");
    params.push(values.id, values.creatorId);
  }
  if (columns.createdAt) {
    columnNames.push("created_at");
    valueExpressions.push("COALESCE((SELECT created_at FROM indices WHERE id = ?), ?)");
    params.push(values.id, values.createdAt);
  }

  if (columns.sortOrder !== false) {
    columnNames.push("sort_order");
    valueExpressions.push("COALESCE(?, (SELECT sort_order FROM indices WHERE id = ?), 99)");
    params.push(values.sortOrder, values.id);
  }

  const insertPrefix = values.useReplace ? "INSERT OR REPLACE" : "INSERT";
  const insertSource =
    values.creationLimit !== undefined
      ? `SELECT ${valueExpressions.join(", ")} WHERE (SELECT COUNT(*) FROM indices WHERE creator_id = ?) < ?`
      : `VALUES (${valueExpressions.join(", ")})`;
  if (values.creationLimit !== undefined) {
    params.push(values.creatorId, values.creationLimit);
  }

  return env.DB.prepare(
    `${insertPrefix} INTO indices (${columnNames.join(", ")}) ${insertSource}`,
  ).bind(...params);
}

// D1 allows at most 100 bound parameters per SQL statement. A basket row has
// five values, and quota-guarded writes reserve two additional bindings for
// the creator check. Chunking also keeps a 500-item save below the Workers
// Free plan's per-invocation D1 query limit.
export const D1_MAX_BOUND_PARAMETERS = 100;
export const BASKET_ITEM_BINDINGS = 5;

export function prepareBasketItemWrites(
  env: Env,
  items: BasketItemInput[],
  indexId: string,
  quotaGuarded: boolean,
  creatorId: string | null,
): D1PreparedStatement[] {
  const needsGuard = quotaGuarded && creatorId !== null;
  const rowsPerStatement = Math.floor(
    (D1_MAX_BOUND_PARAMETERS - (needsGuard ? 2 : 0)) / BASKET_ITEM_BINDINGS,
  );

  const prepareSingleWrite = (item: BasketItemInput): D1PreparedStatement => {
    if (!needsGuard) {
      return env.DB.prepare(
        "INSERT OR REPLACE INTO basket_items (index_id, ticker, name, weight, theme) VALUES (?, ?, ?, ?, ?)",
      ).bind(indexId, item.ticker, item.name, item.weight, item.theme);
    }

    return env.DB.prepare(
      "INSERT OR REPLACE INTO basket_items (index_id, ticker, name, weight, theme) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM indices WHERE id = ? AND creator_id = ?)",
    ).bind(indexId, item.ticker, item.name, item.weight, item.theme, indexId, creatorId);
  };

  // Preserve the simple statement shape for normal small baskets while
  // switching larger writes to multi-row statements before they can exhaust
  // the Worker/D1 query budget.
  if (items.length <= rowsPerStatement) {
    return items.map(prepareSingleWrite);
  }

  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < items.length; offset += rowsPerStatement) {
    const chunk = items.slice(offset, offset + rowsPerStatement);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
    const params: (string | number)[] = [];
    for (const item of chunk) {
      params.push(indexId, item.ticker, item.name, item.weight, item.theme);
    }

    if (!needsGuard) {
      statements.push(
        env.DB.prepare(
          `INSERT OR REPLACE INTO basket_items (index_id, ticker, name, weight, theme) VALUES ${placeholders}`,
        ).bind(...params),
      );
      continue;
    }

    statements.push(
      env.DB.prepare(
        `WITH incoming(index_id, ticker, name, weight, theme) AS (VALUES ${placeholders})
         INSERT OR REPLACE INTO basket_items (index_id, ticker, name, weight, theme)
         SELECT index_id, ticker, name, weight, theme FROM incoming
         WHERE EXISTS (SELECT 1 FROM indices WHERE id = ? AND creator_id = ?)`,
      ).bind(...params, indexId, creatorId),
    );
  }

  return statements;
}

// Built-in system index IDs live in src/data/indices (single source of truth).
// Re-exported here so existing worker consumers and tests keep importing from
// the worker without drifting into a duplicate definition.
export const SYSTEM_INDICES = SHARED_SYSTEM_INDICES;

export const BENCHMARK_MAP: Record<string, { label: string; desc: string }> = {
  "^N225": { label: "日経225", desc: "日経平均株価 (日足)" },
  "^GSPC": { label: "S&P 500", desc: "S&P 500 米国株価指数" },
  "USDJPY=X": { label: "米ドル/円", desc: "USD/JPY 為替レート" },
  "BTC-USD": { label: "ビットコイン", desc: "Bitcoin / USD (日足)" },
};

export interface TickerPriceQuote {
  proName: string;
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  formattedPrice: string;
  formattedChange: string;
  formattedChangePercent: string;
  isPositive: boolean;
  updatedAt?: string;
  /** True when the quote is a static/previous fallback, not a fresh Yahoo fetch. */
  stale?: boolean;
}

export interface TickerMappingItem {
  proName: string;
  symbol: string;
  defaultPrice: number;
  defaultChange: number;
  defaultChangePercent: number;
}

export const TICKER_MAPPINGS: TickerMappingItem[] = [
  {
    proName: "INDEX:NKY",
    symbol: "^N225",
    defaultPrice: 38980.5,
    defaultChange: 145.2,
    defaultChangePercent: 0.37,
  },
  {
    proName: "FOREXCOM:DJI",
    symbol: "^DJI",
    defaultPrice: 43825.1,
    defaultChange: 210.4,
    defaultChangePercent: 0.48,
  },
  {
    proName: "FOREXCOM:SPXUSD",
    symbol: "^GSPC",
    defaultPrice: 5860.25,
    defaultChange: 18.9,
    defaultChangePercent: 0.32,
  },
  {
    proName: "FOREXCOM:NSXUSD",
    symbol: "^NDX",
    defaultPrice: 20410.8,
    defaultChange: 95.3,
    defaultChangePercent: 0.47,
  },
  {
    proName: "FX_IDC:USDJPY",
    symbol: "USDJPY=X",
    defaultPrice: 155.2,
    defaultChange: 0.15,
    defaultChangePercent: 0.1,
  },
  {
    proName: "FX_IDC:XAUUSD",
    symbol: "GC=F",
    defaultPrice: 2680.5,
    defaultChange: -8.4,
    defaultChangePercent: -0.31,
  },
  {
    proName: "TVC:USOIL",
    symbol: "CL=F",
    defaultPrice: 71.45,
    defaultChange: -0.65,
    defaultChangePercent: -0.9,
  },
  {
    proName: "BITSTAMP:BTCUSD",
    symbol: "BTC-USD",
    defaultPrice: 91240.0,
    defaultChange: 1250.0,
    defaultChangePercent: 1.39,
  },
  {
    proName: "BITSTAMP:ETHUSD",
    symbol: "ETH-USD",
    defaultPrice: 3340.5,
    defaultChange: 45.2,
    defaultChangePercent: 1.37,
  },
];

// Upper bound for a single index basket. The save path chunks basket writes so
// this remains below D1 statement-parameter and Worker invocation limits while
// comfortably accommodating the largest built-in index (175 stocks).
export const MAX_BASKET_ITEMS = 500;
// `sync_logs.last_synced_at` is positive for a successful synchronization.
// A negative value records a transient Yahoo failure at its absolute timestamp.
// This lets us apply a short retry backoff without ever treating failed data
// retrieval as fresh price data.
export const SYNC_FAILURE_RETRY_SECONDS = 5 * 60;
export const PASSWORD_HASH_PREFIX = "pbkdf2-sha256";
export const PASSWORD_HASH_ITERATIONS = 100_000;
export const AUTH_RATE_LIMIT_MAX = 10;

// Hash an owner token or password for secure storage
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token.trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string comparison to prevent timing attacks.
// Unlike a naive implementation that early-returns on length mismatch, this
// always iterates over the longer input so that differing lengths do not leak
// information through timing differences.
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0xff;
    const cb = i < b.length ? b.charCodeAt(i) : 0xff;
    result |= ca ^ cb;
  }
  return result === 0;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Password hashes use a per-password salt and PBKDF2. The legacy SHA-256
 * format remains verifiable so existing accounts can be upgraded on login.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PASSWORD_HASH_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(derivedBits))}`;
}

export function parsePasswordHash(storedHash: string): {
  iterations: number;
  salt: Uint8Array;
  digest: string;
} | null {
  const [prefix, iterationsText, saltHex, digest] = storedHash.split("$");
  const iterations = Number(iterationsText);
  const salt = saltHex ? hexToBytes(saltHex) : null;
  if (
    prefix !== PASSWORD_HASH_PREFIX ||
    !Number.isSafeInteger(iterations) ||
    iterations < 10_000 ||
    iterations > 2_000_000 ||
    !salt ||
    salt.length < 16 ||
    !/^[0-9a-f]{64}$/i.test(digest || "")
  ) {
    return null;
  }
  return { iterations, salt, digest: digest.toLowerCase() };
}

export async function verifyPasswordHash(password: string, storedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) {
    // Legacy hashes were unsalted SHA-256 digests. Keep this path only for
    // migration compatibility; new writes always use PBKDF2.
    return timingSafeEqual(await hashToken(password), storedHash);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      // Cloudflare's runtime accepts Uint8Array salts; the cast bridges the
      // DOM lib's stricter ArrayBuffer generic in the application compiler.
      salt: parsed.salt as unknown as BufferSource,
      iterations: parsed.iterations,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return timingSafeEqual(bytesToHex(new Uint8Array(derivedBits)), parsed.digest);
}

export function isModernPasswordHash(storedHash: string): boolean {
  return storedHash.startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

export let isPasswordTableEnsured = false;
export function resetPasswordTableEnsured(): void {
  isPasswordTableEnsured = false;
}

export async function runStatement(env: Env, sql: string): Promise<void> {
  const stmt = env.DB.prepare(sql);
  if (typeof stmt.run === "function") {
    await stmt.run();
  } else if (typeof stmt.bind === "function") {
    const bound = stmt.bind();
    if (typeof bound.run === "function") {
      await bound.run();
    }
  }
}

export async function ensurePasswordTable(env: Env): Promise<void> {
  if (isPasswordTableEnsured) return;
  try {
    await runStatement(
      env,
      `
    CREATE TABLE IF NOT EXISTS access_passwords (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        max_stocks INTEGER DEFAULT 10,
        max_indices INTEGER DEFAULT NULL,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      )
    `,
    );
    try {
      await runStatement(
        env,
        "ALTER TABLE access_passwords ADD COLUMN max_indices INTEGER DEFAULT NULL",
      );
    } catch {
      // The column already exists on current schemas.
    }
    try {
      await runStatement(
        env,
        "ALTER TABLE access_passwords ADD COLUMN secret_code_hash TEXT",
      );
    } catch {
      // The column already exists on current schemas.
    }
    try {
      await runStatement(
        env,
        `
        CREATE TABLE IF NOT EXISTS admin_login_attempts (
          ip TEXT PRIMARY KEY,
          failed_count INTEGER NOT NULL DEFAULT 0,
          last_failed_at INTEGER NOT NULL,
          locked_until INTEGER NOT NULL DEFAULT 0
        )
      `,
      );
    } catch {
      // The table may already exist on an upgraded database.
    }
    // Ensure all columns on indices exist for unmigrated databases
    try {
      await runStatement(env, "ALTER TABLE indices ADD COLUMN owner_token_hash TEXT");
    } catch {
      // The column may already exist on an upgraded database.
    }
    try {
      await runStatement(env, "ALTER TABLE indices ADD COLUMN created_at INTEGER");
    } catch {
      // The column may already exist on an upgraded database.
    }
    try {
      await runStatement(env, "ALTER TABLE indices ADD COLUMN creator_id TEXT");
    } catch {
      // The column may already exist on an upgraded database.
    }
    try {
      await runStatement(env, "ALTER TABLE indices ADD COLUMN sort_order INTEGER DEFAULT 99");
    } catch {
      // The column may already exist on an upgraded database.
    }
    // Ensure benchmark_cache table if not exists
    try {
      await runStatement(
        env,
        `
        CREATE TABLE IF NOT EXISTS benchmark_cache (
          symbol TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        )
      `,
      );
    } catch {
      // The table may already exist on an upgraded database.
    }
    // Ensure creator_id index on indices
    try {
      await runStatement(
        env,
        "CREATE INDEX IF NOT EXISTS idx_indices_creator_id ON indices(creator_id)",
      );
    } catch {
      // The index may already exist or column not yet added
    }
    // Ensure rate_limits table if not exists
    try {
      await runStatement(
        env,
        `
        CREATE TABLE IF NOT EXISTS rate_limits (
          ip TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          request_count INTEGER DEFAULT 1,
          window_start INTEGER NOT NULL,
          PRIMARY KEY (ip, endpoint)
        )
      `,
      );
    } catch {
      // The table may already exist on an upgraded database.
    }
    // The expired-window purge filters on window_start, which is not covered
    // by the primary key. Without this index the purge is a full table scan.
    try {
      await runStatement(
        env,
        "CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start)",
      );
    } catch {
      // The index may already exist.
    }
    // Ensure sync_logs table if not exists
    try {
      await runStatement(
        env,
        `
        CREATE TABLE IF NOT EXISTS sync_logs (
          ticker TEXT PRIMARY KEY,
          last_synced_at INTEGER NOT NULL
        )
      `,
      );
    } catch {
      // The table may already exist on an upgraded database.
    }
    // Ensure snapshot_cache table if not exists
    try {
      await runStatement(
        env,
        `
        CREATE TABLE IF NOT EXISTS snapshot_cache (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          data TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        )
      `,
      );
    } catch {
      // The table may already exist on an upgraded database.
    }
    // Ensure stock_series table if not exists
    try {
      await runStatement(
        env,
        `
        CREATE TABLE IF NOT EXISTS stock_series (
          ticker TEXT PRIMARY KEY,
          prices TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `,
      );
    } catch {
      // The table may already exist on an upgraded database.
    }
    isPasswordTableEnsured = true;
  } catch (err) {
    // Schema initialization is best-effort; log the failure so operators can
    // spot persistent D1 connectivity or permission issues in production logs.
    console.warn(
      "ensurePasswordTable: schema initialisation failed (will retry on next request):",
      err,
    );
  }
}

export const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
export const ADMIN_LOGIN_LOCKOUT_SECONDS = 15 * 60; // 900 seconds (15 minutes)
export const TURNSTILE_DEFAULT_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_DEFAULT_SECRET_KEY = "1x0000000000000000000000000000000AA";
export const DEFAULT_DEV_ADMIN_SECRET_CODE = "indexforge-admin-secret-2026";

/**
 * True only for local development hostnames. Purely host-based (no runtime
 * detection) so the rule can be asserted directly.
 */
export function isLocalHostname(hostname: string): boolean {
  const raw = (hostname || "").trim().toLowerCase();
  // IPv6 literals arrive bracketed ("[::1]:8787") — splitting on ":" first
  // would destroy them.
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    const inside = end > 0 ? raw.slice(1, end) : raw.slice(1);
    return inside === "::1" || inside === "0:0:0:0:0:0:0:1";
  }
  const host = raw.split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
}

/**
 * True for the contexts where the repository's built-in development
 * credentials (the default Turnstile test keys and `DEFAULT_DEV_ADMIN_SECRET_CODE`)
 * may be used: local development and the unit-test runtime.
 *
 * On any other host those defaults would make the admin second factor a
 * publicly known constant, so the handlers fail closed instead and tell the
 * operator which Worker Secret to configure.
 */
export function isLocalOrTestHost(hostname: string): boolean {
  return isTestRuntime() || isLocalHostname(hostname);
}

/**
 * Verify Cloudflare Turnstile token via Cloudflare siteverify endpoint.
 *
 * `allowTestKeys` gates the two development conveniences that would otherwise
 * silently disable CAPTCHA in production: the official always-passing test
 * secret and the offline/mock-token fallbacks. Callers pass `false` for
 * non-local hosts, where a missing `TURNSTILE_SECRET_KEY` must be reported
 * instead of treated as success.
 */
export async function verifyTurnstileToken(
  secretKey: string | undefined,
  token: string | undefined,
  remoteIp?: string,
  allowTestKeys: boolean = isTestRuntime(),
): Promise<{ success: boolean; error?: string }> {
  const configuredSecret = secretKey?.trim();
  const effectiveSecret = configuredSecret || TURNSTILE_DEFAULT_SECRET_KEY;
  const trimmedToken = token?.trim();

  if (!trimmedToken) {
    return { success: false, error: "Turnstile認証トークンが指定されていません" };
  }

  const isTestSecret =
    !configuredSecret || configuredSecret === TURNSTILE_DEFAULT_SECRET_KEY;
  if (isTestSecret && !allowTestKeys) {
    return {
      success: false,
      error:
        "Turnstileが未設定です。CloudflareのTurnstileシークレットキーをWorker Secret「TURNSTILE_SECRET_KEY」(と公開用の「TURNSTILE_SITE_KEY」)に設定してください。",
    };
  }
  const isMockToken =
    trimmedToken === "dummy-turnstile-token" ||
    trimmedToken === "test-token" ||
    trimmedToken.startsWith("XXXX.");

  try {
    const formData = new URLSearchParams();
    formData.append("secret", effectiveSecret);
    formData.append("response", trimmedToken);
    if (remoteIp) formData.append("remoteip", remoteIp);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // siteverify is the only external call without a deadline otherwise; a
      // hung connection would hold the admin-login request open indefinitely.
      signal: AbortSignal.timeout(5000),
    });

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (data.success) {
      return { success: true };
    }

    // In unit test or development environment using the official test secret key,
    // allow mock tokens to pass even if live siteverify returns false
    if (allowTestKeys && isTestSecret && isMockToken) {
      return { success: true };
    }

    return {
      success: false,
      error: "Turnstile認証に失敗しました。もう一度お試しください",
    };
  } catch (err) {
    console.error("Turnstile verification network error:", err);
    if (allowTestKeys && isTestSecret) {
      return { success: true };
    }
    return {
      success: false,
      error: "Turnstile認証通信エラーが発生しました",
    };
  }
}

/**
 * Verify secret code for admin login. Checks D1 admin-master hash first,
 * then falls back to env.ADMIN_SECRET_CODE (and, only in local/test contexts,
 * to the built-in development code).
 */
export async function verifyAdminSecretCode(
  env: Env,
  inputCode: string,
  allowDevDefault: boolean = isTestRuntime(),
): Promise<boolean> {
  const trimmed = typeof inputCode === "string" ? inputCode.normalize("NFC").trim() : "";
  if (!trimmed) return false;

  await ensurePasswordTable(env);

  try {
    const { results } = await env.DB.prepare(
      "SELECT secret_code_hash FROM access_passwords WHERE id = 'admin-master'",
    ).all();
    const row = results?.[0] as { secret_code_hash?: string | null } | undefined;
    if (row && typeof row.secret_code_hash === "string" && row.secret_code_hash.length > 0) {
      return await verifyPasswordHash(trimmed, row.secret_code_hash);
    }
  } catch (err) {
    // A lookup failure must never fall back to a public default: the hash may
    // exist and simply be unreadable right now, in which case accepting the
    // development code would bypass the customized second factor.
    if (!isMissingColumnError(err, "secret_code_hash") && !isMissingTableError(err, "access_passwords")) {
      console.error("Failed to query secret_code_hash from D1:", err);
      return false;
    }
  }

  // Explicitly configured environment secret: valid on every host.
  const envSecret = env.ADMIN_SECRET_CODE?.trim();
  if (envSecret) {
    const inputHash = await hashToken(trimmed);
    const configuredHash = await hashToken(envSecret.normalize("NFC"));
    if (timingSafeEqual(inputHash, configuredHash)) return true;
    return false;
  }

  // No secret configured at all: the committed development default is only
  // acceptable where the deployment cannot be a public one.
  if (!allowDevDefault) return false;
  const inputHash = await hashToken(trimmed);
  const defaultHash = await hashToken(DEFAULT_DEV_ADMIN_SECRET_CODE.normalize("NFC"));
  return timingSafeEqual(inputHash, defaultHash);
}

/**
 * Check whether the given IP is currently locked out from admin logins.
 */
export async function checkAdminLoginLockout(
  env: Env,
  ip: string,
): Promise<{ locked: boolean; remainingSeconds: number; remainingAttempts: number; failedCount: number }> {
  await ensurePasswordTable(env);
  const now = Math.floor(Date.now() / 1000);
  try {
    const { results } = await env.DB.prepare(
      "SELECT failed_count, last_failed_at, locked_until FROM admin_login_attempts WHERE ip = ?",
    )
      .bind(ip)
      .all();
    const row = results?.[0] as
      | { failed_count?: number; last_failed_at?: number; locked_until?: number }
      | undefined;
    if (!row) {
      return { locked: false, remainingSeconds: 0, remainingAttempts: ADMIN_LOGIN_MAX_ATTEMPTS, failedCount: 0 };
    }

    const lockedUntil = Number(row.locked_until) || 0;
    if (lockedUntil > now) {
      const remainingSeconds = lockedUntil - now;
      return {
        locked: true,
        remainingSeconds,
        remainingAttempts: 0,
        failedCount: Number(row.failed_count) || ADMIN_LOGIN_MAX_ATTEMPTS,
      };
    }

    if (lockedUntil > 0 && lockedUntil <= now) {
      return { locked: false, remainingSeconds: 0, remainingAttempts: ADMIN_LOGIN_MAX_ATTEMPTS, failedCount: 0 };
    }

    const lastFailedAt = Number(row.last_failed_at) || 0;
    if (now - lastFailedAt > ADMIN_LOGIN_LOCKOUT_SECONDS) {
      return { locked: false, remainingSeconds: 0, remainingAttempts: ADMIN_LOGIN_MAX_ATTEMPTS, failedCount: 0 };
    }

    const count = Number(row.failed_count) || 0;
    const remainingAttempts = Math.max(0, ADMIN_LOGIN_MAX_ATTEMPTS - count);
    return { locked: false, remainingSeconds: 0, remainingAttempts, failedCount: count };
  } catch (err) {
    console.error("Failed to check admin login lockout:", err);
    return { locked: false, remainingSeconds: 0, remainingAttempts: ADMIN_LOGIN_MAX_ATTEMPTS, failedCount: 0 };
  }
}

/**
 * Record a failed admin login attempt for the given IP and apply lockout if max reached.
 *
 * The increment happens inside the statement: the previous SELECT-then-write
 * sequence computed `failed_count` in JavaScript, so N concurrent wrong
 * guesses all read the same value and wrote the same `+1` result — a batch of
 * parallel attempts counted as a single failure and crossed the advertised
 * 5-attempt threshold far more often than 5 guesses. The response values are
 * read back afterwards (best-effort reporting; the authoritative gate is
 * `checkAdminLoginLockout`, which runs before every attempt).
 */
export async function recordAdminLoginFailure(
  env: Env,
  ip: string,
): Promise<{ locked: boolean; remainingSeconds: number; remainingAttempts: number; failedCount: number }> {
  await ensurePasswordTable(env);
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(
      `INSERT INTO admin_login_attempts (ip, failed_count, last_failed_at, locked_until)
       VALUES (?, 1, ?, 0)
       ON CONFLICT(ip) DO UPDATE SET
         failed_count = CASE WHEN admin_login_attempts.last_failed_at >= ? THEN admin_login_attempts.failed_count + 1 ELSE 1 END,
         last_failed_at = excluded.last_failed_at,
         locked_until = CASE
           WHEN (CASE WHEN admin_login_attempts.last_failed_at >= ? THEN admin_login_attempts.failed_count + 1 ELSE 1 END) >= ? THEN ?
           ELSE 0
         END`,
    )
      .bind(ip, now, now - ADMIN_LOGIN_LOCKOUT_SECONDS, now - ADMIN_LOGIN_LOCKOUT_SECONDS, ADMIN_LOGIN_MAX_ATTEMPTS, now + ADMIN_LOGIN_LOCKOUT_SECONDS)
      .run();

    const { results } = await env.DB.prepare(
      "SELECT failed_count, last_failed_at, locked_until FROM admin_login_attempts WHERE ip = ?",
    )
      .bind(ip)
      .all();
    const row = results?.[0] as
      | { failed_count?: number; last_failed_at?: number; locked_until?: number }
      | undefined;

    const failedCount = Number(row?.failed_count) || 1;
    const lockedUntil = Number(row?.locked_until) || 0;
    const locked = lockedUntil > now;
    const remainingAttempts = Math.max(0, ADMIN_LOGIN_MAX_ATTEMPTS - failedCount);
    return {
      locked,
      remainingSeconds: locked ? lockedUntil - now : 0,
      remainingAttempts,
      failedCount,
    };
  } catch (err) {
    console.error("Failed to record admin login failure:", err);
    return { locked: false, remainingSeconds: 0, remainingAttempts: ADMIN_LOGIN_MAX_ATTEMPTS - 1, failedCount: 1 };
  }
}

/**
 * Reset failed admin login attempts upon successful login.
 */
export async function resetAdminLoginAttempts(env: Env, ip: string): Promise<void> {
  await ensurePasswordTable(env);
  try {
    await env.DB.prepare("DELETE FROM admin_login_attempts WHERE ip = ?")
      .bind(ip)
      .run();
  } catch (err) {
    console.error("Failed to reset admin login attempts:", err);
  }
}


export interface AuthCacheEntry {
  result: AuthResult;
  expiresAt: number;
}
export const authCache = new Map<string, AuthCacheEntry>();
export const MAX_AUTH_CACHE_SIZE = 200;
// Incremented whenever the cache is cleared so a verification that started
// before a password change cannot re-populate the cache with the previous
// password's result afterwards (that would keep the old password valid for
// the full cache TTL).
let authCacheGeneration = 0;

export function setAuthCache(key: string, entry: AuthCacheEntry): void {
  if (authCache.size >= MAX_AUTH_CACHE_SIZE) {
    const oldestKey = authCache.keys().next().value;
    if (oldestKey) authCache.delete(oldestKey);
  }
  authCache.set(key, entry);
}

export function clearAuthCache(): void {
  authCache.clear();
  authCacheGeneration += 1;
}

export async function upgradeLegacyPasswordHash(
  env: Env,
  id: string,
  password: string,
  storedHash: string,
): Promise<void> {
  if (isModernPasswordHash(storedHash)) return;
  try {
    const upgradedHash = await hashPassword(password);
    // Guard the write with the verified hash: if the password was rotated
    // concurrently, this upgrade must not overwrite the new hash with one
    // derived from the previous password (which would silently revert the
    // rotation).
    await env.DB.prepare(
      "UPDATE access_passwords SET password_hash = ?, updated_at = ? WHERE id = ? AND password_hash = ?",
    )
      .bind(upgradedHash, Math.floor(Date.now() / 1000), id, storedHash)
      .run();
    // Migration visibility (P3): legacy unsalted SHA-256 hashes are upgraded
    // lazily on successful login. Emitting one log line per upgrade lets
    // operators watch the migration progress in Worker logs; once no more
    // "upgraded legacy password hash" lines appear, every active account has
    // been migrated to PBKDF2 and the legacy verification path is dormant.
    console.info(`Upgraded legacy password hash to PBKDF2 for account: ${id}`);
  } catch (err) {
    // A successful login must not fail just because a best-effort migration
    // could not be persisted. The next login can retry the upgrade.
    console.error("Failed to upgrade legacy password hash:", err);
  }
}

/**
 * Upper bound on full PBKDF2 verifications performed by a single
 * findPasswordCollision call. Each verification runs ~100k SHA-256 iterations,
 * so this cap keeps admin operations (password create/update) well inside the
 * Workers CPU limit even when the access_passwords table grows large.
 *
 * The cap must stay far above any realistic account count: it is a CPU guard,
 * and reaching it degrades collision detection (a collision beyond the cap is
 * reported as "no collision"). At ~10-20ms per verification, 200 checks still
 * complete in a few seconds.
 */
export const MAX_PASSWORD_COLLISION_VERIFICATIONS = 200;

export interface PasswordCollisionCheckResult {
  hasCollision: boolean;
  isMasterAdminCollision?: boolean;
  isAdminCollision?: boolean;
  collidingId?: string;
  collidingName?: string;
  collidingRole?: "admin" | "user";
}

export async function findPasswordCollision(
  env: Env,
  candidatePassword: string,
  excludeId?: string | null,
): Promise<PasswordCollisionCheckResult> {
  // 1. Check against admin-master if excludeId is not admin-master
  if (excludeId !== "admin-master") {
    let masterRow: { id: string; name: string; password_hash: string } | undefined;
    try {
      const adminMasterRows = await env.DB.prepare(
        "SELECT id, name, password_hash FROM access_passwords WHERE id = 'admin-master'",
      ).all();
      masterRow = (adminMasterRows.results || []).find((r: D1Row) => r.id === "admin-master") as
        { id: string; name: string; password_hash: string } | undefined;
    } catch {
      // Table may not exist or query error; fallback to env check below
    }

    if (masterRow && masterRow.password_hash) {
      if (await verifyPasswordHash(candidatePassword, masterRow.password_hash)) {
        return {
          hasCollision: true,
          isMasterAdminCollision: true,
          isAdminCollision: true,
          collidingId: "admin-master",
          collidingName: masterRow.name || "マスター管理者",
          collidingRole: "admin",
        };
      }
    } else if (env.ADMIN_PASSWORD) {
      const trimmedEnvAdmin = env.ADMIN_PASSWORD.trim();
      if (
        trimmedEnvAdmin &&
        timingSafeEqual(await hashToken(trimmedEnvAdmin), await hashToken(candidatePassword))
      ) {
        return {
          hasCollision: true,
          isMasterAdminCollision: true,
          isAdminCollision: true,
          collidingId: "admin-master",
          collidingName: "管理者",
          collidingRole: "admin",
        };
      }
    }
  }

  // 2. Check against other accounts in access_passwords
  try {
    const query = excludeId
      ? "SELECT id, name, role, password_hash FROM access_passwords WHERE id != ? AND id != 'admin-master'"
      : "SELECT id, name, role, password_hash FROM access_passwords WHERE id != 'admin-master'";
    const stmt = excludeId ? env.DB.prepare(query).bind(excludeId) : env.DB.prepare(query);
    const { results } = await stmt.all();

    // Each PBKDF2 verification costs ~100k SHA-256 iterations. Verifying every
    // row unbounded would push admin operations past the Workers CPU limit as
    // the user count grows, so cap the number of full verifications per call.
    let verified = 0;
    for (const row of results || []) {
      const r = row as { id: string; name: string; role?: "admin" | "user"; password_hash: string };
      if (!r.password_hash) continue;
      if (verified >= MAX_PASSWORD_COLLISION_VERIFICATIONS) {
        console.warn(
          `findPasswordCollision: verification cap (${MAX_PASSWORD_COLLISION_VERIFICATIONS}) reached; ` +
            "remaining rows were not checked for password collisions",
        );
        break;
      }
      verified += 1;
      if (await verifyPasswordHash(candidatePassword, r.password_hash)) {
        const isAdmin = r.role === "admin";
        return {
          hasCollision: true,
          isMasterAdminCollision: false,
          isAdminCollision: isAdmin,
          collidingId: r.id,
          collidingName: r.name,
          collidingRole: r.role || "user",
        };
      }
    }
  } catch (err) {
    console.error("findPasswordCollision DB error:", err);
  }

  return { hasCollision: false };
}

// Maximum password length accepted at authentication. This bounds the CPU
// cost of SHA-256 hashing and PBKDF2 verification per request, preventing a
// single attacker from forcing the Worker to hash multi-megabyte payloads.
// This matches the maximum length enforced when creating passwords.
export const MAX_AUTH_PASSWORD_LENGTH = 100;

export async function authenticatePassword(
  request: Request,
  env: Env,
  explicitPassword?: string | null,
  rateLimitEndpoint = "auth-api",
  ctx?: WorkerExecutionContext,
): Promise<AuthResult> {
  const pwd =
    explicitPassword !== undefined && explicitPassword !== null
      ? typeof explicitPassword === "string"
        ? explicitPassword.trim()
        : ""
      : request.headers.get("x-auth-password")?.trim() ||
        request.headers.get("x-admin-key")?.trim() ||
        (request.headers.get("authorization")?.startsWith("Bearer ")
          ? request.headers.get("authorization")!.slice(7).trim()
          : null) ||
        "";

  if (!pwd) {
    return { authenticated: false, error: "パスワードが指定されていません" };
  }

  // Reject oversized passwords before hashing to prevent CPU exhaustion.
  // The rate limit alone is not sufficient: a bounded number of long-password
  // requests can still consume a disproportionate share of Worker CPU.
  if (pwd.length > MAX_AUTH_PASSWORD_LENGTH) {
    return { authenticated: false, error: "パスワードが長すぎます" };
  }

  const pwdHash = await hashToken(pwd);
  // Cache only the master admin result. The cache is keyed by the SHA-256 of
  // the raw password, so caching regular users here would be unsafe: two
  // accounts that share the same password would collide and the first
  // account's role/limits would be served to the second. There is exactly one
  // admin-master row, so its result is unambiguous and it is also the hottest
  // authenticated path (every admin request). Regular users always scan D1,
  // which also makes deactivation and limit changes take effect immediately.
  const cachedAuth = authCache.get(pwdHash);
  if (cachedAuth && Date.now() < cachedAuth.expiresAt && cachedAuth.result.id === "admin-master") {
    return cachedAuth.result;
  }
  // Snapshot the generation before verifying: if a password change clears the
  // cache while this verification is in flight, the result must not be cached
  // (the old password would otherwise keep authenticating for the TTL).
  const cacheGenerationAtStart = authCacheGeneration;

  // Schema bootstrap must happen BEFORE the fail-closed rate-limit check. On a
  // fresh, unmigrated database the rate_limits INSERT inside checkRateLimit
  // would fail, fail closed, and report a misleading "rate limit exceeded"
  // error on every login attempt, because the best-effort ensurePasswordTable()
  // call inside the try block below would never be reached.
  await ensurePasswordTable(env);

  const ip = getClientIp(request);
  // Keep login verification separate from authenticated API traffic. Otherwise
  // routine administration can exhaust the stricter login-attempt budget.
  const limitMax = rateLimitEndpoint === "auth-login" ? AUTH_RATE_LIMIT_MAX : RATE_LIMIT_MAX;
  if (!(await checkRateLimit(env, ip, rateLimitEndpoint, limitMax, true, ctx))) {
    return {
      authenticated: false,
      error: "認証試行回数が上限に達しました。しばらくしてから再試行してください",
    };
  }

  try {
    // Schema bootstrap already ran above (before the fail-closed rate-limit
    // check); go straight to the credential lookup.

    // 1. Check if customized master admin password exists in D1
    const { results: adminMasterRows } = await env.DB.prepare(
      "SELECT id, name, password_hash, role, max_stocks, is_active FROM access_passwords WHERE id = 'admin-master'",
    ).all();

    const masterRow = (adminMasterRows || []).find((r: D1Row) => r.id === "admin-master") as
      | {
          id: string;
          name: string;
          password_hash: string;
          role: "admin";
          max_stocks: number | null;
          is_active: number;
        }
      | undefined;

    if (masterRow) {
      // Once a master row exists, only that row may authenticate the master
      // account. In particular, an unavailable D1 must never re-enable a
      // fallback password.
      if (
        masterRow.is_active === 1 &&
        typeof masterRow.password_hash === "string" &&
        (await verifyPasswordHash(pwd, masterRow.password_hash))
      ) {
        await upgradeLegacyPasswordHash(env, masterRow.id, pwd, masterRow.password_hash);
        const res: AuthResult = {
          authenticated: true,
          role: "admin",
          name: masterRow.name || "管理者",
          maxStocks: null,
          maxIndices: null,
          id: "admin-master",
        };
        if (cacheGenerationAtStart === authCacheGeneration) {
          setAuthCache(pwdHash, { result: res, expiresAt: Date.now() + 60 * 1000 });
        }
        return res;
      }
    } else {
      // A first deployment may use the secret configured in the Worker
      // environment. There is deliberately no built-in/default password.
      const masterAdminPassword = env.ADMIN_PASSWORD?.trim();
      if (masterAdminPassword && timingSafeEqual(await hashToken(masterAdminPassword), pwdHash)) {
        const res: AuthResult = {
          authenticated: true,
          role: "admin",
          name: "管理者",
          maxStocks: null,
          maxIndices: null,
          id: "admin-master",
        };
        if (cacheGenerationAtStart === authCacheGeneration) {
          setAuthCache(pwdHash, { result: res, expiresAt: Date.now() + 60 * 1000 });
        }
        return res;
      }
    }

    // 2. D1 access_passwords check for standard users / secondary admins
    let passwordRows: D1Row[] | undefined;
    try {
      const dbRes = await env.DB.prepare(
        "SELECT id, name, role, max_stocks, max_indices, is_active, password_hash FROM access_passwords WHERE is_active = 1 AND id != 'admin-master' ORDER BY created_at ASC",
      ).all();
      passwordRows = dbRes.results;
    } catch (lookupErr: unknown) {
      if (!isMissingColumnError(lookupErr, "max_indices")) throw lookupErr;
      const dbRes = await env.DB.prepare(
        "SELECT id, name, role, max_stocks, is_active, password_hash FROM access_passwords WHERE is_active = 1 AND id != 'admin-master' ORDER BY created_at ASC",
      ).all();
      passwordRows = dbRes.results;
    }

    let checkedCount = 0;
    let scanTruncated = false;
    for (const row of passwordRows || []) {
      const user = row as {
        id: string;
        name: string;
        role: "admin" | "user";
        max_stocks: number | null;
        max_indices?: number | null;
        is_active: number;
        password_hash: string;
      };
      if (typeof user.password_hash !== "string") {
        continue;
      }
      checkedCount++;
      if (!(await verifyPasswordHash(pwd, user.password_hash))) {
        if (checkedCount >= MAX_AUTH_ROW_VERIFICATIONS) {
          // The budget ran out before every active account was checked. Report
          // a distinct error so the operator can see the cause; reporting
          // "wrong password" here permanently locked out the remaining
          // accounts with no way to diagnose why.
          scanTruncated = true;
          break;
        }
        continue;
      }
      await upgradeLegacyPasswordHash(env, user.id, pwd, user.password_hash);
      // NOTE: deliberately NOT cached in authCache — see the comment above
      // about same-password collisions across user accounts.
      const res: AuthResult = {
        authenticated: true,
        role: user.role,
        name: user.name,
        maxStocks:
          user.max_stocks !== null && user.max_stocks !== undefined
            ? Number(user.max_stocks)
            : null,
        maxIndices:
          user.max_indices !== null && user.max_indices !== undefined
            ? Number(user.max_indices)
            : null,
        id: user.id,
      };
      return res;
    }
    if (scanTruncated) {
      return {
        authenticated: false,
        error:
          "アカウント数が認証の検証上限を超えているため認証できません。管理者にお問い合わせください",
      };
    }
  } catch (err) {
    console.error("Auth DB error:", err);
  }

  return { authenticated: false, error: "パスワードが正しくありません" };
}

// In-memory cache for warm worker isolates to minimize D1 reads
export interface MemoryCacheEntry<T> {
  data: T;
  expiresAt: number;
  /** Approximate payload size (JSON length) used for the byte budgets below. */
  bytes: number;
}
export const MAX_GENERAL_CACHE_SIZE = 400;
export const MAX_CALC_CACHE_SIZE = 100;
/**
 * Byte budgets for the in-memory caches.
 *
 * Counting entries alone is not enough: one `/api/calculate` response embeds
 * the full price series of every constituent (up to 500 × ~250 points), so 100
 * "small" entries can still be hundreds of MB of V8 heap. The isolate limit is
 * 128 MB, so an unauthenticated client that varies the basket fingerprint can
 * otherwise evict the isolate mid-request (HTTP 500 for every user in that
 * colo). Entries larger than a single-entry cap are simply not cached — the
 * request still succeeds, it is just recomputed next time.
 */
export const MAX_CALC_CACHE_BYTES = 32 * 1024 * 1024;
export const MAX_GENERAL_CACHE_BYTES = 16 * 1024 * 1024;
export const MAX_MEMORY_CACHE_ENTRY_BYTES = 8 * 1024 * 1024;
export const memoryCache = new Map<string, MemoryCacheEntry<unknown>>();
export const calcMemoryCache = new Map<string, MemoryCacheEntry<unknown>>();

export let allowMemoryCacheInTest = false;
export function setAllowMemoryCacheInTest(allow: boolean): void {
  allowMemoryCacheInTest = allow;
}

/**
 * Detects a test runner environment.
 *
 * `process.env.NODE_ENV` alone is not a reliable signal: the Workers runtime
 * does not define `process`, and a developer shell (or CI job) may export
 * `NODE_ENV=production`, which silently defeats a NODE_ENV-only check and lets
 * the in-memory cache leak between test cases. Vitest always sets
 * `process.env.VITEST` and `import.meta.env.MODE === "test"`, so those are
 * checked as well.
 */
export function isTestRuntime(): boolean {
  if (typeof process !== "undefined") {
    if (process.env?.VITEST) return true;
    if (process.env?.NODE_ENV === "test") return true;
  }
  try {
    return (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === "test";
  } catch {
    return false;
  }
}

export interface MemoryCacheLookup<T> {
  data: T;
  remainingSeconds: number;
}

export let cacheHits = 0;
export let cacheMisses = 0;
export function resetCacheMetrics(): void {
  cacheHits = 0;
  cacheMisses = 0;
}

export function getMemoryCacheEntry<T>(key: string): MemoryCacheLookup<T> | null {
  if (isTestRuntime() && !allowMemoryCacheInTest) {
    return null;
  }
  const targetMap = key.startsWith("calc:") ? calcMemoryCache : memoryCache;
  const entry = targetMap.get(key);
  if (!entry) {
    cacheMisses++;
    return null;
  }
  const remainingMs = entry.expiresAt - Date.now();
  if (remainingMs <= 0) {
    targetMap.delete(key);
    cacheMisses++;
    return null;
  }
  cacheHits++;
  return {
    data: entry.data as T,
    remainingSeconds: Math.max(1, Math.floor(remainingMs / 1000)),
  };
}


export function getMemoryCache<T>(key: string): T | null {
  const entry = getMemoryCacheEntry<T>(key);
  return entry ? entry.data : null;
}

/**
 * Approximate serialized size of a cache payload.
 *
 * `Infinity` means "must not be cached": a payload that cannot be serialized
 * would also never be servable through `json()`, and a payload above the
 * entry budget could push the isolate over its memory limit.
 */
export function approxMemoryCacheBytes(data: unknown): number {
  try {
    const json = JSON.stringify(data);
    return typeof json === "string" ? json.length : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export interface MemoryCacheStats {
  entries: number;
  bytes: number;
}

/** Current occupancy of the in-memory caches (optionally restricted by key prefix). */
export function getMemoryCacheStats(prefix?: string): MemoryCacheStats {
  const collect = (map: Map<string, MemoryCacheEntry<unknown>>): MemoryCacheStats => {
    const stats = { entries: 0, bytes: 0 };
    for (const [key, entry] of map) {
      if (prefix && !key.startsWith(prefix)) continue;
      stats.entries += 1;
      stats.bytes += entry.bytes || 0;
    }
    return stats;
  };
  const general = collect(memoryCache);
  const calc = collect(calcMemoryCache);
  return { entries: general.entries + calc.entries, bytes: general.bytes + calc.bytes };
}

export function setMemoryCache(key: string, data: unknown, ttlSeconds: number): void {
  const isCalc = key.startsWith("calc:");
  const targetMap = isCalc ? calcMemoryCache : memoryCache;
  const maxEntries = isCalc ? MAX_CALC_CACHE_SIZE : MAX_GENERAL_CACHE_SIZE;
  const maxTotalBytes = isCalc ? MAX_CALC_CACHE_BYTES : MAX_GENERAL_CACHE_BYTES;
  const bytes = approxMemoryCacheBytes(data);
  // Oversized or unserializable payloads are simply not cached: the request
  // still succeeds, it is only recomputed on the next call. Admitting them
  // would let one multi-MB basket response evict every other cached value (or
  // the whole isolate) instead of costing a single recomputation.
  if (bytes > MAX_MEMORY_CACHE_ENTRY_BYTES || bytes > maxTotalBytes) return;

  const now = Date.now();
  let totalBytes = 0;
  for (const [existingKey, existing] of targetMap) {
    if (existing.expiresAt <= now) {
      targetMap.delete(existingKey);
      continue;
    }
    if (existingKey === key) continue; // replaced by this write
    totalBytes += existing.bytes || 0;
  }

  // Evict oldest entries until both budgets (count and bytes) are satisfied.
  while (
    targetMap.size - (targetMap.has(key) ? 1 : 0) >= maxEntries ||
    totalBytes + bytes > maxTotalBytes
  ) {
    const oldestKey = targetMap.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = targetMap.get(oldestKey);
    targetMap.delete(oldestKey);
    totalBytes -= oldest?.bytes || 0;
  }

  if (targetMap.has(key)) {
    targetMap.delete(key);
  }

  targetMap.set(key, {
    data,
    expiresAt: now + ttlSeconds * 1000,
    bytes,
  });
}

export function clearMemoryCache(prefix?: string): void {
  if (!prefix) {
    memoryCache.clear();
    calcMemoryCache.clear();
    return;
  }
  for (const key of Array.from(calcMemoryCache.keys())) {
    if (key.startsWith(prefix)) {
      calcMemoryCache.delete(key);
    }
  }
  for (const key of Array.from(memoryCache.keys())) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

export function getMarketAwareCacheDuration(now: Date = new Date()): number {
  return getMarketAwareCacheDurationShared(now);
}

export function isPriceCacheFresh(nowSec: number, lastSyncedSec: number): boolean {
  return isPriceCacheFreshShared(nowSec, lastSyncedSec);
}

// Generate an ETag from arbitrary string or JSON data
export async function generateETag(content: string): Promise<string> {
  const hash = await hashToken(content);
  return `"${hash.slice(0, 16)}"`;
}

// Yahoo Finance API fetcher
export async function fetchYahooFinance(symbol: string, range = "1y"): Promise<PricePoint[]> {
  const encodedSymbol = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=${range}`;
  try {
    const res = await fetch(url, {
      // Abort hung connections so a single slow Yahoo response cannot consume
      // the entire worker CPU/wall-clock budget for the calling request.
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!res.ok) throw new Error(`Yahoo Finance error: ${res.status}`);

    const data: YahooChartResponse = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return [];

    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const closes = Array.isArray(result.indicators?.quote)
      ? (result.indicators.quote[0]?.close ?? [])
      : [];
    const volumes = Array.isArray(result.indicators?.quote)
      ? (result.indicators.quote[0]?.volume ?? [])
      : [];

    const pointsByDate = new Map<string, { close: number; volume?: number }>();
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const close = closes[i];
      const vol = volumes[i];
      if (
        typeof ts === "number" &&
        Number.isFinite(ts) &&
        typeof close === "number" &&
        Number.isFinite(close) &&
        close > 0
      ) {
        const date = new Date(ts * 1000);
        // YYYY-MM-DD format: year-aware, sortable across year boundaries (UTC-consistent)
        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(date.getUTCDate()).padStart(2, "0");
        const safeVol =
          typeof vol === "number" && Number.isFinite(vol) && vol >= 0 ? Math.round(vol) : undefined;
        pointsByDate.set(`${yyyy}-${mm}-${dd}`, {
          close: Number(close.toFixed(2)),
          volume: safeVol,
        });
      }
    }

    return Array.from(pointsByDate.entries())
      .map(([date, data]) => ({
        date,
        close: data.close,
        ...(data.volume !== undefined ? { volume: data.volume } : {}),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    console.error(`Error fetching ${symbol}:`, err);
    return [];
  }
}

export function formatTickerPrice(price: number, decimals: number = 2): string {
  if (!Number.isFinite(price) || price < 0) {
    return decimals === 4 ? "0.0000" : "0.00";
  }
  return price.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatTickerChange(change: number, decimals: number = 2): string {
  const threshold = decimals === 4 ? 0.00005 : 0.005;
  if (!Number.isFinite(change) || Math.abs(change) < threshold || Object.is(change, -0)) {
    return decimals === 4 ? "0.0000" : "0.00";
  }
  const formatted = Math.abs(change).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (change > 0) return `+${formatted}`;
  if (change < 0) return `-${formatted}`;
  return decimals === 4 ? "0.0000" : "0.00";
}

export function formatTickerChangePercent(pct: number): string {
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.005 || Object.is(pct, -0)) {
    return "0.00%";
  }
  const formatted = Math.abs(pct).toFixed(2);
  if (pct > 0) return `+${formatted}%`;
  if (pct < 0) return `-${formatted}%`;
  return "0.00%";
}

export interface YahooQuoteSummary {
  price: number;
  change: number;
  changePercent: number;
}

export async function fetchYahooQuote(symbol: string): Promise<YahooQuoteSummary | null> {
  const encodedSymbol = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=5d`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;

    const data: YahooChartResponse & {
      chart?: {
        result?: {
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
          };
          timestamp: number[];
          indicators: {
            quote: { close: (number | null)[] }[];
          };
        }[];
      };
    } = await res.json();

    const result = data.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter(
      (c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0,
    );

    let price: number | null = null;
    if (
      typeof meta.regularMarketPrice === "number" &&
      Number.isFinite(meta.regularMarketPrice) &&
      meta.regularMarketPrice > 0
    ) {
      price = meta.regularMarketPrice;
    } else if (validCloses.length > 0) {
      price = validCloses[validCloses.length - 1];
    }

    if (price === null) return null;

    let prevClose: number | null = null;
    if (
      typeof meta.chartPreviousClose === "number" &&
      Number.isFinite(meta.chartPreviousClose) &&
      meta.chartPreviousClose > 0
    ) {
      prevClose = meta.chartPreviousClose;
    } else if (
      typeof meta.previousClose === "number" &&
      Number.isFinite(meta.previousClose) &&
      meta.previousClose > 0
    ) {
      prevClose = meta.previousClose;
    } else if (validCloses.length >= 2) {
      prevClose = validCloses[validCloses.length - 2];
    } else {
      prevClose = price;
    }

    const isFx = symbol.endsWith("=X") || symbol.startsWith("FX_");
    const isJpyFx = isFx && symbol.includes("JPY");
    const isSubTenFx = isFx && !isJpyFx;
    const decimals = isSubTenFx ? 4 : 2;

    const change = Number((price - prevClose).toFixed(decimals));
    const changePercent = prevClose > 0 ? Number(((change / prevClose) * 100).toFixed(2)) : 0;

    return {
      price: Number(price.toFixed(decimals)),
      change,
      changePercent,
    };
  } catch (err) {
    console.error(`fetchYahooQuote error for ${symbol}:`, err);
    return null;
  }
}

export async function fetchAllTickerQuotes(
  prevQuotes?: Map<string, TickerPriceQuote>,
): Promise<TickerPriceQuote[]> {
  const promises = TICKER_MAPPINGS.map(async (mapping) => {
    const isSubTenFx = mapping.symbol.endsWith("=X") && !mapping.symbol.includes("JPY");
    const decimals = isSubTenFx ? 4 : 2;
    try {
      const quote = await fetchYahooQuote(mapping.symbol);
      if (quote) {
        return {
          proName: mapping.proName,
          symbol: mapping.symbol,
          price: quote.price,
          change: quote.change,
          changePercent: quote.changePercent,
          formattedPrice: formatTickerPrice(quote.price, decimals),
          formattedChange: formatTickerChange(quote.change, decimals),
          formattedChangePercent: formatTickerChangePercent(quote.changePercent),
          isPositive: quote.change >= 0,
          stale: false,
        };
      }
    } catch {
      // ignore
    }

    // Previous quote fallback: still usable, but must be flagged so the
    // client never badges a fully-stale tape as LIVE market data.
    const prev = prevQuotes?.get(mapping.proName);
    if (prev) {
      return { ...prev, stale: true };
    }

    // Default static fallback
    return {
      proName: mapping.proName,
      symbol: mapping.symbol,
      price: mapping.defaultPrice,
      change: mapping.defaultChange,
      changePercent: mapping.defaultChangePercent,
      formattedPrice: formatTickerPrice(mapping.defaultPrice, decimals),
      formattedChange: formatTickerChange(mapping.defaultChange, decimals),
      formattedChangePercent: formatTickerChangePercent(mapping.defaultChangePercent),
      isPositive: mapping.defaultChange >= 0,
      stale: true,
    };
  });

  return Promise.all(promises);
}

export const lastKnownTickerQuotes = new Map<string, TickerPriceQuote>();
export function resetLastKnownTickerQuotes(): void {
  lastKnownTickerQuotes.clear();
}

export let cachedYahooCrumb: string | null = null;
export let cachedYahooCookie: string | null = null;
export let yahooCrumbExpiresAt = 0;

export function resetYahooCrumbCache(): void {
  cachedYahooCrumb = null;
  cachedYahooCookie = null;
  yahooCrumbExpiresAt = 0;
}

export async function getYahooCrumb(
  forceRefresh = false,
): Promise<{ crumb: string; cookie: string } | null> {
  if (!forceRefresh && cachedYahooCrumb && cachedYahooCookie && Date.now() < yahooCrumbExpiresAt) {
    return { crumb: cachedYahooCrumb, cookie: cachedYahooCookie };
  }
  try {
    const res1 = await fetch("https://fc.yahoo.com", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    const rawCookies: string[] =
      typeof (res1.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie ===
      "function"
        ? (res1.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : res1.headers.get("set-cookie")
          ? [res1.headers.get("set-cookie")!]
          : [];
    const cookie = rawCookies
      .map((c) => c.split(";")[0]?.trim())
      .filter((c): c is string => Boolean(c && c.includes("=")))
      .join("; ");
    let crumbText = "";
    try {
      const res2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        signal: AbortSignal.timeout(4000),
      });
      if (res2.ok) {
        crumbText = (await res2.text()).trim();
      }
    } catch {
      // try query1
    }

    if (!crumbText || crumbText.includes("<")) {
      try {
        const resAlt = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          signal: AbortSignal.timeout(4000),
        });
        if (resAlt.ok) {
          crumbText = (await resAlt.text()).trim();
        }
      } catch {
        // best effort
      }
    }

    const tokenCandidate = crumbText.split("\n").pop()?.trim() || crumbText;
    if (tokenCandidate && !tokenCandidate.includes("<") && /^[A-Za-z0-9_.~-]{5,50}$/.test(tokenCandidate)) {
      cachedYahooCrumb = tokenCandidate;
      cachedYahooCookie = cookie;
      yahooCrumbExpiresAt = Date.now() + 1000 * 60 * 60; // 1 hour
      return { crumb: tokenCandidate, cookie };
    }
  } catch {
    // fallback
  }
  return null;
}

export const US_CIK_LOOKUP: Record<string, string> = {
  NVDA: "0001045810",
  AAPL: "0000320193",
  MSFT: "0000789019",
  AMZN: "0001018724",
  GOOGL: "0001652044",
  GOOG: "0001652044",
  META: "0001326801",
  TSLA: "0001318605",
  INTC: "0000050863",
  AMD: "0000002488",
  NFLX: "0001065280",
  AVGO: "0001730168",
  QCOM: "0000804328",
  ORCL: "0001341439",
  CRM: "0001108524",
  ADBE: "0000796343",
  CSCO: "0000858877",
};

/**
 * SEC EDGAR Company Facts API から米国株の確定年次決算 (10-K) 財務諸表を動的取得
 */
export async function fetchSecEdgarFinancials(
  ticker: string,
): Promise<Array<{ fiscalYear: string; revenue: number; operatingIncome: number; netIncome: number; eps: number; dps: number }>> {
  const norm = ticker.trim().toUpperCase();
  const cik = US_CIK_LOOKUP[norm];
  if (!cik) return [];

  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: {
        "User-Agent": "IndexForgePlatform/1.0 (compliance-contact@indexforge.dev)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      facts?: {
        "us-gaap"?: Record<
          string,
          { units?: Record<string, Array<{ form?: string; fy?: number; val?: number; fp?: string }>> }
        >;
      };
    };
    const usGaap = data.facts?.["us-gaap"];
    if (!usGaap) return [];

    const isUsableFact = (r: { form?: string; fy?: number; val?: number; fp?: string }) =>
      r.form === "10-K" &&
      typeof r.fy === "number" &&
      typeof r.val === "number" &&
      Number.isFinite(r.val) &&
      (!r.fp || r.fp === "FY");

    const revList = (
      usGaap.Revenues?.units?.USD ||
      usGaap.RevenueFromContractWithCustomerExcludingAssessedTax?.units?.USD ||
      usGaap.SalesRevenueNet?.units?.USD ||
      []
    ).filter(isUsableFact);

    const netList = (usGaap.NetIncomeLoss?.units?.USD || []).filter(isUsableFact);

    const opList = (usGaap.OperatingIncomeLoss?.units?.USD || []).filter(isUsableFact);

    // SEC's XBRL companyfacts expose per-share concepts under the
    // "USD/shares" unit key (plain "USD" is for absolute amounts), so EPS
    // and DPS facts must be read from there. Keep the "USD" fallback for adapters
    // that normalize the unit key.
    const epsUnits = usGaap.EarningsPerShareDiluted?.units;
    const epsList = (epsUnits?.["USD/shares"] || epsUnits?.USD || []).filter(isUsableFact);

    const dpsUnits =
      usGaap.CommonStockDividendsPerShareDeclared?.units ||
      usGaap.CommonStockDividendsPerShareCashPaid?.units;
    const dpsList = (dpsUnits?.["USD/shares"] || dpsUnits?.USD || []).filter(isUsableFact);

    const years = [...new Set(revList.map((r) => r.fy!))].sort((a, b) => a - b).slice(-4);
    if (years.length === 0) return [];

    return years.map((fy) => {
      const revItem = revList.filter((r) => r.fy === fy).pop();
      const netItem = netList.filter((r) => r.fy === fy).pop();
      const opItem = opList.filter((r) => r.fy === fy).pop();
      const epsItem = epsList.filter((r) => r.fy === fy).pop();
      const dpsItem = dpsList.filter((r) => r.fy === fy).pop();

      const rev = revItem && typeof revItem.val === "number" && Number.isFinite(revItem.val)
        ? Math.round(revItem.val / 1_000_000)
        : 0;
      const net = netItem && typeof netItem.val === "number" && Number.isFinite(netItem.val)
        ? Math.round(netItem.val / 1_000_000)
        : 0;
      // 営業利益: 実データが存在しない場合は net * 1.25 の捏造を行わず純利益を代用
      // (2811/2844行付近の Yahoo 経路と同方針)。捏造値を SEC データとして表示しない。
      const op = opItem && typeof opItem.val === "number" && Number.isFinite(opItem.val)
        ? Math.round(opItem.val / 1_000_000)
        : net;
      const safeEps = epsItem && typeof epsItem.val === "number" && Number.isFinite(epsItem.val)
        ? Number(epsItem.val.toFixed(2))
        : 0;
      const safeDps = dpsItem && typeof dpsItem.val === "number" && Number.isFinite(dpsItem.val)
        ? Number(dpsItem.val.toFixed(2))
        : 0;

      return {
        fiscalYear: `${fy} FY`,
        revenue: rev,
        operatingIncome: op,
        netIncome: net,
        eps: safeEps,
        dps: safeDps,
      };
    });
  } catch {
    return [];
  }
}

export interface OverviewAssetDef {
  symbol: string;
  querySymbol: string;
  name: string;
  category: "INDEX" | "FX" | "COMMODITY" | "CRYPTO" | "BOND";
  currency: string;
  defaultPrice: number;
  defaultChange: number;
  defaultChangePercent: number;
}

export const OVERVIEW_ASSET_DEFS: OverviewAssetDef[] = BASELINE_ASSET_QUOTES.map((quote) => ({
  symbol: quote.symbol,
  querySymbol: quote.querySymbol,
  name: quote.name,
  category: quote.category,
  currency: quote.currency,
  defaultPrice: quote.baselinePrice,
  defaultChange: quote.baselineChange,
  defaultChangePercent: quote.baselineChangePercent,
}));

export const SECTOR_SAMPLE_DEFINITIONS: Array<{ name: string; market: "TSE"; tickers: string[] }> =
  [
    { name: "電気機器・半導体", market: "TSE", tickers: ["8035.T", "6857.T", "6758.T", "6861.T"] },
    { name: "精密機器", market: "TSE", tickers: ["7735.T", "6146.T"] },
    { name: "輸送用機器", market: "TSE", tickers: ["7203.T", "7267.T", "6902.T"] },
    { name: "銀行業", market: "TSE", tickers: ["8306.T", "8316.T", "8411.T"] },
    { name: "卸売業 (商社)", market: "TSE", tickers: ["8058.T", "8001.T", "8031.T"] },
    { name: "情報・通信業", market: "TSE", tickers: ["9984.T", "9432.T", "9433.T"] },
    { name: "医薬品", market: "TSE", tickers: ["4502.T", "4503.T", "4519.T"] },
    { name: "化学・素材", market: "TSE", tickers: ["4063.T", "4188.T", "5401.T"] },
    { name: "食料品・小売", market: "TSE", tickers: ["2914.T", "9983.T", "3382.T"] },
    { name: "鉱業・エネルギー", market: "TSE", tickers: ["1605.T", "5020.T"] },
  ];

export let lastKnownMarketOverview: MarketOverviewData | null = null;
export function resetLastKnownMarketOverview(): void {
  lastKnownMarketOverview = null;
}

export async function fetchLiveMarketOverview(
  prevOverview?: MarketOverviewData | null,
): Promise<MarketOverviewData> {
  const querySymbols = OVERVIEW_ASSET_DEFS.map((d) => d.querySymbol);
  const sectorTickers = Array.from(new Set(SECTOR_SAMPLE_DEFINITIONS.flatMap((s) => s.tickers)));
  const allSymbolsToFetch = Array.from(new Set([...querySymbols, ...sectorTickers]));

  const quotesMap = new Map<
    string,
    { price: number; change: number; changePercent: number; prevClose?: number }
  >();
  const sparkMap = new Map<string, number[]>();

  // 1. Fetch sparklines for major overview assets
  try {
    const sparkUrl = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(querySymbols.join(","))}&range=1d&interval=30m`;
    const sparkRes = await fetch(sparkUrl, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (sparkRes.ok) {
      const sparkJson = (await sparkRes.json()) as {
        spark?: {
          result?: Array<{
            symbol: string;
            response?: Array<{
              indicators?: {
                quote?: Array<{ close?: (number | null)[] }>;
              };
            }>;
          }>;
        };
      };
      for (const item of sparkJson.spark?.result || []) {
        const rawCloses = item.response?.[0]?.indicators?.quote?.[0]?.close;
        if (Array.isArray(rawCloses)) {
          const valid = rawCloses.filter(
            (c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0,
          );
          if (valid.length > 0) {
            sparkMap.set(item.symbol, valid);
          }
        }
      }
    }
  } catch {
    // Ignore sparkline fetch error
  }

  // 2. Fetch quotes for all assets & sector tickers using Yahoo crumb
  const auth = await getYahooCrumb();
  if (auth) {
    try {
      const quoteUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(allSymbolsToFetch.join(","))}&crumb=${encodeURIComponent(auth.crumb)}`;
      const quoteRes = await fetch(quoteUrl, {
        signal: AbortSignal.timeout(6000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Cookie: auth.cookie,
        },
      });
      if (quoteRes.ok) {
        const qJson = (await quoteRes.json()) as {
          quoteResponse?: {
            result?: Array<{
              symbol: string;
              regularMarketPrice?: number;
              regularMarketChange?: number;
              regularMarketChangePercent?: number;
              regularMarketPreviousClose?: number;
            }>;
          };
        };
        for (const q of qJson.quoteResponse?.result || []) {
          if (typeof q.regularMarketPrice === "number" && Number.isFinite(q.regularMarketPrice)) {
            const price = q.regularMarketPrice;
            const change =
              typeof q.regularMarketChange === "number" && Number.isFinite(q.regularMarketChange)
                ? q.regularMarketChange
                : 0;
            const changePercent =
              typeof q.regularMarketChangePercent === "number" &&
              Number.isFinite(q.regularMarketChangePercent)
                ? q.regularMarketChangePercent
                : 0;
            quotesMap.set(q.symbol, {
              price,
              change,
              changePercent,
              prevClose: q.regularMarketPreviousClose,
            });
          }
        }
      } else if (quoteRes.status === 401 || quoteRes.status === 403) {
        resetYahooCrumbCache();
      }
    } catch {
      // Ignore quote batch error
    }
  }

  // If crumb batch failed, fallback for major assets via fetchYahooQuote
  if (quotesMap.size === 0) {
    await Promise.all(
      OVERVIEW_ASSET_DEFS.map(async (def) => {
        try {
          const q = await fetchYahooQuote(def.querySymbol);
          if (q) {
            quotesMap.set(def.querySymbol, {
              price: q.price,
              change: q.change,
              changePercent: q.changePercent,
            });
          }
        } catch {
          // ignore
        }
      }),
    );
  }

  // Helper to build a MarketAssetQuote
  const buildAssetQuote = (def: OverviewAssetDef): MarketAssetQuote => {
    const live = quotesMap.get(def.querySymbol);
    const prevQuote = prevOverview
      ? [
          ...prevOverview.indices,
          ...prevOverview.forex,
          ...prevOverview.commodities,
          ...prevOverview.crypto,
        ].find((a) => a.symbol === def.symbol)
      : undefined;

    const price = live?.price ?? prevQuote?.price ?? def.defaultPrice;
    const change = live?.change ?? prevQuote?.change ?? def.defaultChange;
    const changePercent =
      live?.changePercent ?? prevQuote?.changePercent ?? def.defaultChangePercent;
    let spark = sparkMap.get(def.querySymbol) ?? prevQuote?.sparkline;
    if (!spark || spark.length === 0) {
      const prevClose = live?.prevClose ?? price - change;
      spark = [
        Number((prevClose * 0.998).toFixed(2)),
        Number((prevClose * 1.001).toFixed(2)),
        Number(((prevClose + price) / 2).toFixed(2)),
        price,
      ];
    }

    return {
      symbol: def.symbol,
      name: def.name,
      category: def.category,
      price: Number(price.toFixed(def.category === "FX" && price < 2 ? 4 : 2)),
      change: Number(change.toFixed(def.category === "FX" && Math.abs(change) < 0.1 ? 4 : 2)),
      changePercent: Number(changePercent.toFixed(2)),
      currency: def.currency,
      sparkline: spark,
      updatedAt: quotesMap.size > 0 ? "リアルタイム" : "参考値 (ベースライン)",
    };
  };

  const indices = OVERVIEW_ASSET_DEFS.filter((d) => d.category === "INDEX").map(buildAssetQuote);
  const forex = OVERVIEW_ASSET_DEFS.filter((d) => d.category === "FX").map(buildAssetQuote);
  const commodities = OVERVIEW_ASSET_DEFS.filter(
    (d) => d.category === "COMMODITY" || d.category === "BOND",
  ).map(buildAssetQuote);
  const crypto = OVERVIEW_ASSET_DEFS.filter((d) => d.category === "CRYPTO").map(buildAssetQuote);

  // 3. Compute Sectors and Breadth from real sampled quotes
  let totalSampleGainers = 0;
  let totalSampleLosers = 0;
  let totalSampleUnchanged = 0;

  const sectors: SectorPerformance[] = SECTOR_SAMPLE_DEFINITIONS.map((secDef) => {
    const changes: number[] = [];
    for (const ticker of secDef.tickers) {
      const q = quotesMap.get(ticker);
      if (q) {
        changes.push(q.changePercent);
        if (q.changePercent > 0.05) totalSampleGainers++;
        else if (q.changePercent < -0.05) totalSampleLosers++;
        else totalSampleUnchanged++;
      }
    }
    const avgChange = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
    return {
      name: secDef.name,
      changePercent: Number(avgChange.toFixed(2)),
      market: secDef.market,
    };
  });

  const totalSamples = totalSampleGainers + totalSampleLosers + totalSampleUnchanged;
  const gainRatio = totalSamples > 0 ? totalSampleGainers / totalSamples : 0.62;
  const lossRatio = totalSamples > 0 ? totalSampleLosers / totalSamples : 0.33;
  const extrapolatedGainers = Math.round(1650 * gainRatio);
  const extrapolatedLosers = Math.round(1650 * lossRatio);
  const extrapolatedUnchanged = Math.max(0, 1650 - extrapolatedGainers - extrapolatedLosers);
  const sentimentScore = Math.max(10, Math.min(90, Math.round(gainRatio * 80 + 15)));

  // 4. Fetch news from Yahoo Search
  let newsList: MarketOverviewData["news"] = [];
  try {
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=market&newsCount=6`;
    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(4000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (searchRes.ok) {
      const sJson = (await searchRes.json()) as {
        news?: Array<{
          uuid: string;
          title: string;
          publisher: string;
          link: string;
          providerPublishTime: number;
          relatedTickers?: string[];
        }>;
      };
      if (Array.isArray(sJson.news) && sJson.news.length > 0) {
        newsList = sJson.news.map((item) => {
          const date = new Date((item.providerPublishTime || Math.floor(Date.now() / 1000)) * 1000);
          const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
          const hh = String(jstDate.getUTCHours()).padStart(2, "0");
          const mm = String(jstDate.getUTCMinutes()).padStart(2, "0");
          return {
            id: item.uuid || `news-${Math.random()}`,
            title: item.title,
            source: item.publisher || "市場速報",
            publishedAt: `${hh}:${mm}`,
            publishedTimestamp: date.toISOString(),
            url: item.link,
            relatedTicker: item.relatedTickers?.[0],
          };
        });
      }
    }
  } catch {
    // fallback
  }

  if (newsList.length === 0) {
    const nowMs = Date.now();
    const nowJst = new Date(nowMs + 9 * 60 * 60 * 1000);
    const getJstTimeStr = (offsetMinutes: number) => {
      const d = new Date(nowJst.getTime() - offsetMinutes * 60 * 1000);
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    };
    const getIsoTimestamp = (offsetMinutes: number) => {
      return new Date(nowMs - offsetMinutes * 60 * 1000).toISOString();
    };
    newsList = [
      {
        id: "news-live-1",
        title: "日経平均は高水準推移、主要ハイテク・半導体関連株に実需買い",
        source: "市場速報",
        publishedAt: getJstTimeStr(5),
        publishedTimestamp: getIsoTimestamp(5),
        relatedTicker: "8035",
      },
      {
        id: "news-live-2",
        title: "米ドル円は158円台で推移、日米金利動向と実需フローを見極め",
        source: "為替市況",
        publishedAt: getJstTimeStr(15),
        publishedTimestamp: getIsoTimestamp(15),
        relatedTicker: "USDJPY=X",
      },
      {
        id: "news-live-3",
        title: "米ハイテク株と主要指数が堅調推移、インフラ・生成AI需要が下支え",
        source: "グローバル金融",
        publishedAt: getJstTimeStr(45),
        publishedTimestamp: getIsoTimestamp(45),
        relatedTicker: "NVDA",
      },
      {
        id: "news-live-4",
        title: "東証プライム騰落レシオは良好、好業績バリュー銘柄に見直し買いが継続",
        source: "株式ニュース",
        publishedAt: getJstTimeStr(120),
        publishedTimestamp: getIsoTimestamp(120),
      },
    ];
  }

  return {
    dataSource: quotesMap.size > 0 ? "live" : "fallback",
    dataAsOf: new Date().toISOString(),
    indices,
    forex,
    commodities,
    crypto,
    sectors,
    marketBreadth: {
      gainers: extrapolatedGainers,
      losers: extrapolatedLosers,
      unchanged: extrapolatedUnchanged,
      sentimentScore,
    },
    news: newsList,
  };
}

interface YahooQuoteSummaryResponse {
  quoteSummary?: {
    result?: Array<{
      price?: {
        shortName?: string;
        longName?: string;
        regularMarketPrice?: { raw?: number };
        regularMarketChange?: { raw?: number };
        regularMarketChangePercent?: { raw?: number };
        regularMarketPreviousClose?: { raw?: number };
        regularMarketVolume?: { raw?: number };
        regularMarketDayHigh?: { raw?: number };
        regularMarketDayLow?: { raw?: number };
        marketCap?: { raw?: number };
        sector?: string;
      };
      financialData?: {
        returnOnEquity?: { raw?: number };
        recommendationKey?: string;
      };
      defaultKeyStatistics?: {
        trailingEps?: { raw?: number };
        forwardEps?: { raw?: number };
        priceToBook?: { raw?: number };
        sharesOutstanding?: { raw?: number };
        trailingPE?: { raw?: number };
        forwardPE?: { raw?: number };
        lastDividendValue?: { raw?: number };
        debtToEquity?: { raw?: number };
      };
      summaryDetail?: {
        trailingPE?: { raw?: number };
        forwardPE?: { raw?: number };
        dividendYield?: { raw?: number };
        dividendRate?: { raw?: number };
        fiftyTwoWeekHigh?: { raw?: number };
        fiftyTwoWeekLow?: { raw?: number };
        volume?: { raw?: number };
        dayHigh?: { raw?: number };
        dayLow?: { raw?: number };
        marketCap?: { raw?: number };
      };
      earnings?: {
        financialsChart?: {
          yearly?: Array<{
            date?: number;
            revenue?: { raw?: number };
            earnings?: { raw?: number };
          }>;
        };
      };
      incomeStatementHistory?: {
        incomeStatementHistory?: Array<{
          endDate?: { fmt?: string; raw?: number };
          totalRevenue?: { raw?: number };
          operatingIncome?: { raw?: number };
          netIncome?: { raw?: number };
        }>;
      };
    }>;
  };
}

export async function fetchLiveStockFundamentals(ticker: string, env?: Env): Promise<StockQuoteFundamentals> {
  const input = ticker.trim().toUpperCase();
  const matchedPreset =
    POPULAR_STOCKS.find((s) => s.ticker.toUpperCase() === input) ??
    (input ? POPULAR_STOCKS.find((s) => s.name === input) : undefined);
  const normTicker = matchedPreset ? matchedPreset.ticker.toUpperCase() : input;
  const baselineAsset = BASELINE_ASSET_QUOTES.find(
    (a) => a.symbol.toUpperCase() === normTicker || a.querySymbol.toUpperCase() === normTicker,
  );
  const isIndex = normTicker.startsWith("^") || (baselineAsset?.category === "INDEX");
  const isFx = normTicker.includes("=X") || (baselineAsset?.category === "FX");
  const isCrypto = normTicker.endsWith("-USD") || (baselineAsset?.category === "CRYPTO");
  const isMacroAsset = Boolean(
    isIndex ||
    isFx ||
    isCrypto ||
    (baselineAsset && (baselineAsset.category === "COMMODITY" || baselineAsset.category === "BOND")),
  );

  const baseline = getStockFundamentals(normTicker);

  let name = baselineAsset
    ? baselineAsset.name
    : matchedPreset
      ? matchedPreset.name
      : baseline.name;
  const theme = isIndex
    ? "株価指数"
    : isFx
      ? "為替"
      : isCrypto
        ? "暗号資産"
        : baselineAsset
          ? "指数・ETF"
          : baseline.theme;
  const isUS = baselineAsset ? baselineAsset.currency === "USD" : !/^\d/.test(normTicker);
  const priceDecimals = isFx
    ? (normTicker.includes("JPY") || baselineAsset?.currency === "JPY" ? 2 : 4)
    : (isUS ? 2 : 1);
  const market: StockQuoteFundamentals["market"] = baselineAsset ? (isUS ? "US" : "PRIME") : baseline.market;
  const yahooSymbol = baselineAsset ? baselineAsset.querySymbol : toYahooSymbol(normTicker);

  let currentPrice = baselineAsset ? baselineAsset.baselinePrice : baseline.price;
  let change = baselineAsset ? baselineAsset.baselineChange : baseline.change;
  let changePct = baselineAsset ? baselineAsset.baselineChangePercent : baseline.changePercent;
  let prevClose = baseline.previousClose;
  let volume = isFx ? 0 : baseline.volume;
  let dayHigh = baseline.dayHigh;
  let dayLow = baseline.dayLow;
  let yearHigh = baseline.yearHigh;
  let yearLow = baseline.yearLow;
  let marketCap = isMacroAsset ? 0 : baseline.marketCap;
  let per: number | null = isMacroAsset ? null : baseline.per;
  let isEstimatedPer: boolean = baseline.isEstimatedPer ?? false;
  let perNote: string | undefined = baseline.perNote;
  let pbr: number | null = isMacroAsset ? null : baseline.pbr;
  let dividendYield: number | null = isMacroAsset ? null : baseline.dividendYield;
  let dps: number | null = isMacroAsset ? null : baseline.dps;
  let eps: number | null = isMacroAsset ? null : baseline.eps;
  let roe: number | null = isMacroAsset ? null : baseline.roe;
  let equityRatio: number | null = isMacroAsset ? null : baseline.equityRatio;
  let sparkline: number[] = baseline.sparkline && baseline.sparkline.length > 0 ? baseline.sparkline : [];
  let technicalSignal: StockQuoteFundamentals["technicalSignal"] = baseline.technicalSignal;
  let sector = baseline.sector;
  let historicalFinances: StockQuoteFundamentals["historicalFinances"] = isMacroAsset
    ? []
    : baseline.historicalFinances;
  let hasLivePrice = false;

  const currentYear = new Date().getFullYear();

  try {
    const auth = await getYahooCrumb();
    const [summaryRes, chartRes] = await Promise.all([
      auth
        ? fetch(
            `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=financialData,defaultKeyStatistics,summaryDetail,earnings,price,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,calendarEvents&crumb=${encodeURIComponent(auth.crumb)}`,
            {
              signal: AbortSignal.timeout(6000),
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Cookie: auth.cookie,
              },
            },
          )
        : Promise.resolve(null),
      fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1mo`,
        {
          signal: AbortSignal.timeout(5000),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        },
      ),
    ]);

    let summaryData: YahooQuoteSummaryResponse | null = null;
    if (summaryRes && summaryRes.ok) {
      try {
        summaryData = (await summaryRes.json()) as YahooQuoteSummaryResponse;
      } catch {
        summaryData = null;
      }
    } else if (summaryRes && (summaryRes.status === 401 || summaryRes.status === 403)) {
      resetYahooCrumbCache();
    }

    // Tier 2 Fallback: If Tier 1 (with crumb) failed or was skipped, try query1/query2 quoteSummary without crumb
    if (!summaryData?.quoteSummary?.result?.[0] && !isMacroAsset) {
      for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
        try {
          const altRes = await fetch(
            `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=financialData,defaultKeyStatistics,summaryDetail,earnings,price,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,calendarEvents`,
            {
              signal: AbortSignal.timeout(4500),
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              },
            },
          );
          if (altRes.ok) {
            const altJson = (await altRes.json()) as YahooQuoteSummaryResponse;
            if (altJson?.quoteSummary?.result?.[0]) {
              summaryData = altJson;
              break;
            }
          }
        } catch {
          // continue to next host
        }
      }
    }
    let chartData: YahooChartResponse | null = null;
    if (chartRes && chartRes.ok) {
      chartData = (await chartRes.json()) as YahooChartResponse;
    }

    const chartMeta = chartData?.chart?.result?.[0]?.meta || {};
    const chartCloses =
      chartData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(
        (c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0,
      ) || [];

    if (chartCloses.length > 0) {
      sparkline = chartCloses;
    }

    const result = summaryData?.quoteSummary?.result?.[0] || {};
    const priceObj = result.price || {};
    const fin = result.financialData || {};
    const stats = result.defaultKeyStatistics || {};
    const detail = result.summaryDetail || {};
    const earnings = result.earnings || {};

    if (typeof priceObj.regularMarketPrice?.raw === "number" && priceObj.regularMarketPrice.raw > 0) {
      currentPrice = priceObj.regularMarketPrice.raw;
      hasLivePrice = true;
    } else if (typeof chartMeta.regularMarketPrice === "number" && chartMeta.regularMarketPrice > 0) {
      currentPrice = chartMeta.regularMarketPrice;
      hasLivePrice = true;
    } else if (chartCloses.length > 0) {
      currentPrice = chartCloses[chartCloses.length - 1];
      hasLivePrice = true;
    }

    if (!matchedPreset && !baselineAsset) {
      const companyName = priceObj.shortName || priceObj.longName;
      if (typeof companyName === "string" && companyName.trim().length > 0) {
        name = companyName.trim();
      }
    }

    if (typeof priceObj.regularMarketChange?.raw === "number") {
      change = priceObj.regularMarketChange.raw;
    } else if (typeof chartMeta.regularMarketChange === "number") {
      change = chartMeta.regularMarketChange;
    } else if (typeof chartMeta.chartPreviousClose === "number") {
      change = Number((currentPrice - chartMeta.chartPreviousClose).toFixed(priceDecimals));
    }

    if (typeof priceObj.regularMarketChangePercent?.raw === "number") {
      changePct = Number((priceObj.regularMarketChangePercent.raw * 100).toFixed(2));
    } else if (typeof chartMeta.regularMarketChangePercent === "number") {
      changePct = Number(chartMeta.regularMarketChangePercent.toFixed(2));
    }

    prevClose =
      typeof priceObj.regularMarketPreviousClose?.raw === "number"
        ? priceObj.regularMarketPreviousClose.raw
        : typeof chartMeta.chartPreviousClose === "number"
          ? chartMeta.chartPreviousClose
          : Number((currentPrice - change).toFixed(priceDecimals));

    volume =
      priceObj.regularMarketVolume?.raw ||
      detail.volume?.raw ||
      chartMeta.regularMarketVolume ||
      volume;

    dayHigh =
      detail.dayHigh?.raw ||
      priceObj.regularMarketDayHigh?.raw ||
      chartMeta.regularMarketDayHigh ||
      currentPrice;
    dayLow =
      detail.dayLow?.raw ||
      priceObj.regularMarketDayLow?.raw ||
      chartMeta.regularMarketDayLow ||
      currentPrice;
    yearHigh = detail.fiftyTwoWeekHigh?.raw || chartMeta.fiftyTwoWeekHigh || yearHigh;
    yearLow = detail.fiftyTwoWeekLow?.raw || chartMeta.fiftyTwoWeekLow || yearLow;

    if (!isMacroAsset) {
      const rawCap = detail.marketCap?.raw || priceObj.marketCap?.raw || 0;
      if (rawCap > 0) {
        marketCap = isUS ? Math.round(rawCap / 1_000_000) : Math.round(rawCap / 100_000_000);
      }

      const rawForwardPE = stats.forwardPE?.raw ?? detail.forwardPE?.raw;
      const rawTrailingPE = stats.trailingPE?.raw ?? detail.trailingPE?.raw;
      const liveEps = stats.trailingEps?.raw;

      if (typeof rawForwardPE === "number" && Number.isFinite(rawForwardPE) && rawForwardPE > 0) {
        per = Number(rawForwardPE.toFixed(1));
        isEstimatedPer = false;
        perNote = undefined;
      } else if (typeof rawTrailingPE === "number" && Number.isFinite(rawTrailingPE) && rawTrailingPE > 0) {
        per = Number(rawTrailingPE.toFixed(1));
        isEstimatedPer = true;
        perNote = "会社予想非開示のため直近実績(TTM)より推計";
      } else if (typeof liveEps === "number" && Number.isFinite(liveEps) && liveEps > 0 && currentPrice > 0) {
        per = Number((currentPrice / liveEps).toFixed(1));
        isEstimatedPer = true;
        perNote = "会社予想非開示のため直近実績(TTM)より推計";
      } else {
        // 実データ取得時: 赤字(liveEps <= 0)または非開示で実績も不明なら null
        per = null;
        isEstimatedPer = false;
        perNote = undefined;
      }
      const livePbr = stats.priceToBook?.raw || null;
      if (livePbr && livePbr > 0) pbr = Number(livePbr.toFixed(2));

      const rawDiv = detail.dividendYield?.raw;
      if (typeof rawDiv === "number" && Number.isFinite(rawDiv)) {
        dividendYield = Number((rawDiv * 100).toFixed(2));
      }
      const rawDivRate = detail.dividendRate?.raw;
      if (typeof rawDivRate === "number" && Number.isFinite(rawDivRate)) {
        dps = Number(rawDivRate.toFixed(isUS ? 2 : 1));
      } else if (
        typeof stats.lastDividendValue?.raw === "number" &&
        Number.isFinite(stats.lastDividendValue.raw) &&
        (!dividendYield || dividendYield > 0)
      ) {
        dps = Number(stats.lastDividendValue.raw.toFixed(isUS ? 2 : 1));
      }

      // 予想配当利回りと1株配当の相互整合性チェック・無配の厳格保証
      if (dividendYield === 0) {
        dps = 0;
      } else if (dps === 0 && (dividendYield === null || dividendYield === undefined)) {
        dividendYield = 0;
      } else if (dividendYield && dividendYield > 0) {
        if (dps === null || dps === undefined || dps <= 0) {
          dps = Number(((currentPrice * dividendYield) / 100).toFixed(isUS ? 2 : 1));
        }
      } else if (dps && dps > 0 && currentPrice > 0 && (dividendYield === null || dividendYield === undefined)) {
        dividendYield = Number(((dps / currentPrice) * 100).toFixed(2));
      }

      if (typeof liveEps === "number" && Number.isFinite(liveEps)) {
        eps = Number(liveEps.toFixed(isUS ? 2 : 1));
      } else if (per && currentPrice) {
        eps = Number((currentPrice / per).toFixed(isUS ? 2 : 1));
      }

      const rawRoe = fin.returnOnEquity?.raw;
      if (typeof rawRoe === "number") {
        roe = Number((rawRoe * 100).toFixed(1));
      }

      // 自己資本比率: 貸借対照表 (balanceSheetHistory) の純資産/総資産から実数算出
      const bshStatements = (result as { balanceSheetHistory?: { balanceSheetStatements?: Array<Record<string, { raw?: number }>> } })
        ?.balanceSheetHistory?.balanceSheetStatements;
      if (Array.isArray(bshStatements) && bshStatements.length > 0) {
        const latestBs = bshStatements[0];
        const rawEquity = latestBs.totalStockholderEquity?.raw ?? latestBs.totalEquity?.raw;
        const rawAssets = latestBs.totalAssets?.raw;
        if (typeof rawEquity === "number" && typeof rawAssets === "number" && rawAssets > 0) {
          equityRatio = Number(((rawEquity / rawAssets) * 100).toFixed(1));
        }
      }
      // balanceSheetHistory がない場合は debtToEquity からフォールバック
      if (equityRatio === null) {
        const debtEquity = stats.debtToEquity?.raw;
        if (typeof debtEquity === "number" && Number.isFinite(debtEquity)) {
          const denom = 1 + debtEquity / 100;
          if (denom > 0) {
            equityRatio = Number((100 / denom).toFixed(1));
          }
        }
      }
    } else {
      marketCap = 0;
      per = null;
      pbr = null;
      dividendYield = null;
      dps = null;
      eps = null;
      roe = null;
      equityRatio = null;
    }

    if (fin.recommendationKey === "strong_buy") technicalSignal = "STRONG_BUY";
    else if (fin.recommendationKey === "buy") technicalSignal = "BUY";
    else if (fin.recommendationKey === "hold") technicalSignal = "NEUTRAL";
    else if (fin.recommendationKey === "sell") technicalSignal = "SELL";
    else if (fin.recommendationKey === "strong_sell") technicalSignal = "STRONG_SELL";
    else {
      if (changePct > 2.0) technicalSignal = "STRONG_BUY";
      else if (changePct > 0) technicalSignal = "BUY";
      else if (changePct > -1.5) technicalSignal = "NEUTRAL";
      else technicalSignal = "SELL";
    }

    if (!isMacroAsset && priceObj.sector) sector = priceObj.sector;

    // Financial statement extraction from dynamic external sources
    if (!isMacroAsset) {
      const ish = (result as { incomeStatementHistory?: { incomeStatementHistory?: Array<Record<string, { raw?: number; fmt?: string }>> } })?.incomeStatementHistory?.incomeStatementHistory;
      const validIsh = Array.isArray(ish)
        ? ish.filter((s) => (s.totalRevenue?.raw && s.totalRevenue.raw > 0) || (s.netIncome?.raw && s.netIncome.raw > 0))
        : [];

      const isZeroDiv = dividendYield === 0 || dps === 0;
      const safeDpsVal = isZeroDiv ? 0 : (dps ?? 0);
      const safeEpsVal = eps ?? 0;

      if (validIsh.length > 0) {
        historicalFinances = validIsh.map((stmt, idx) => {
          const rawDate = stmt.endDate?.fmt || String(stmt.endDate?.raw || "");
          const dateYear = rawDate.match(/\d{4}/)?.[0] || String(currentYear);
          const revRaw = stmt.totalRevenue?.raw || 0;
          const opRaw = stmt.operatingIncome?.raw;
          const netRaw = stmt.netIncome?.raw || 0;
          const rev = Math.round(revRaw / (isUS ? 1_000_000 : 100_000_000));
          const net = Math.round(netRaw / (isUS ? 1_000_000 : 100_000_000));
          // 営業利益: 負の値 (営業赤字) も含め、実データが存在する場合はそのまま採用 (net * 1.25 の捏造を撤廃)
          const opInc = typeof opRaw === "number" && Number.isFinite(opRaw)
            ? Math.round(opRaw / (isUS ? 1_000_000 : 100_000_000))
            : net;
          const isLatest = idx === 0; // validIsh は新しい順に並んでおり、後で reverse される
          
          // 過去年度のEPS: stmt の dilutedEPS / basicEPS を実数取得 (0.9倍掛けの推計を撤廃)
          const stmtEps = stmt.dilutedEPS?.raw ?? stmt.basicEPS?.raw;
          const periodEps = typeof stmtEps === "number" && Number.isFinite(stmtEps)
            ? (isUS ? Number(stmtEps.toFixed(2)) : Number(stmtEps.toFixed(1)))
            : (isLatest ? (safeEpsVal ? (isUS ? Number(safeEpsVal.toFixed(2)) : Math.round(safeEpsVal)) : 0) : Math.round(safeEpsVal));

          // 過去年度のDPS: 無配銘柄は確実に0 (0.9倍掛けの推計を撤廃)
          const periodDps = isZeroDiv
            ? 0
            : (isUS ? Number(safeDpsVal.toFixed(2)) : Number(safeDpsVal.toFixed(1)));

          return {
            fiscalYear: isUS ? `${dateYear} FY` : `${dateYear}/3`,
            revenue: rev,
            operatingIncome: opInc,
            netIncome: net,
            eps: periodEps,
            dps: periodDps,
          };
        }).reverse();
      } else {
        const yearlyChart = earnings.financialsChart?.yearly;
        if (Array.isArray(yearlyChart) && yearlyChart.length > 0) {
          const baseEarningsRaw = yearlyChart[yearlyChart.length - 1]?.earnings?.raw;
          historicalFinances = yearlyChart.map((y) => {
            const rev = Math.round((y.revenue?.raw || 0) / (isUS ? 1_000_000 : 100_000_000));
            const net = Math.round((y.earnings?.raw || 0) / (isUS ? 1_000_000 : 100_000_000));
            // 営業利益の net * 1.25 捏造を撤廃
            const opInc = net;
            const earningsRatio =
              typeof baseEarningsRaw === "number" &&
              baseEarningsRaw > 0 &&
              typeof y.earnings?.raw === "number"
                ? y.earnings.raw / baseEarningsRaw
                : 1;
            const yEps = eps
              ? (isUS ? Number((eps * earningsRatio).toFixed(2)) : Math.round(eps * earningsRatio))
              : 0;
            const yDate = typeof y.date === "number" ? y.date : currentYear;
            const rawYDps = isZeroDiv ? 0 : safeDpsVal;
            const yDps = isUS ? Number(rawYDps.toFixed(2)) : Number(rawYDps.toFixed(1));
            return {
              fiscalYear: isUS ? `${yDate} FY` : `${yDate}/3`,
              revenue: rev,
              operatingIncome: opInc,
              netIncome: net,
              eps: yEps,
              dps: isZeroDiv ? 0 : yDps,
            };
          });
        }
      }

      // Tier 3: SEC EDGAR official XBRL facts API for US stocks
      if (isUS && (!historicalFinances || historicalFinances.length === 0)) {
        try {
          const secFinances = await fetchSecEdgarFinancials(normTicker);
          if (secFinances.length > 0) {
            historicalFinances = secFinances;
          }
        } catch {
          // best effort
        }
      }
    } else {
      historicalFinances = [];
    }

    // Secondary fallback: if summaryData was missing, attempt quote endpoint for real valuation metrics
    if (!summaryData && !isMacroAsset) {
      try {
        const qUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahooSymbol)}`;
        const qRes = await fetch(qUrl, {
          signal: AbortSignal.timeout(4000),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        if (qRes.ok) {
          const qJson = (await qRes.json()) as {
            quoteResponse?: { result?: Array<Record<string, unknown>> };
          };
          const q = qJson.quoteResponse?.result?.[0];
          if (q) {
            if (typeof q.regularMarketPrice === "number" && q.regularMarketPrice > 0) {
              currentPrice = q.regularMarketPrice;
              hasLivePrice = true;
            }
            if (typeof q.regularMarketChange === "number") change = q.regularMarketChange;
            if (typeof q.regularMarketChangePercent === "number") changePct = Number(q.regularMarketChangePercent.toFixed(2));
            if (typeof q.regularMarketPreviousClose === "number") prevClose = q.regularMarketPreviousClose;
            if (typeof q.regularMarketVolume === "number") volume = q.regularMarketVolume;
            if (typeof q.regularMarketDayHigh === "number") dayHigh = q.regularMarketDayHigh;
            if (typeof q.regularMarketDayLow === "number") dayLow = q.regularMarketDayLow;
            if (typeof q.fiftyTwoWeekHigh === "number") yearHigh = q.fiftyTwoWeekHigh;
            if (typeof q.fiftyTwoWeekLow === "number") yearLow = q.fiftyTwoWeekLow;
            if (typeof q.marketCap === "number" && q.marketCap > 0) {
              marketCap = isUS ? Math.round(q.marketCap / 1_000_000) : Math.round(q.marketCap / 100_000_000);
            }
            if (typeof q.forwardPE === "number" && Number.isFinite(q.forwardPE) && q.forwardPE > 0) {
              per = Number(q.forwardPE.toFixed(1));
              isEstimatedPer = false;
              perNote = undefined;
            } else if (typeof q.trailingPE === "number" && Number.isFinite(q.trailingPE) && q.trailingPE > 0) {
              per = Number(q.trailingPE.toFixed(1));
              isEstimatedPer = true;
              perNote = "会社予想非開示のため直近実績(TTM)より推計";
            } else if (typeof q.epsTrailingTwelveMonths === "number" && Number.isFinite(q.epsTrailingTwelveMonths) && q.epsTrailingTwelveMonths > 0 && currentPrice > 0) {
              per = Number((currentPrice / q.epsTrailingTwelveMonths).toFixed(1));
              isEstimatedPer = true;
              perNote = "会社予想非開示のため直近実績(TTM)より推計";
            } else {
              per = null;
              isEstimatedPer = false;
              perNote = undefined;
            }
            if (typeof q.priceToBook === "number" && q.priceToBook > 0) pbr = Number(q.priceToBook.toFixed(2));
            if (typeof q.trailingAnnualDividendYield === "number" && Number.isFinite(q.trailingAnnualDividendYield)) {
              dividendYield = Number((q.trailingAnnualDividendYield * 100).toFixed(2));
            } else if (typeof q.dividendYield === "number" && Number.isFinite(q.dividendYield)) {
              dividendYield = Number(q.dividendYield.toFixed(2));
            }
            if (typeof q.dividendRate === "number" && Number.isFinite(q.dividendRate)) {
              dps = Number(q.dividendRate.toFixed(isUS ? 2 : 1));
            } else if (typeof q.trailingAnnualDividendRate === "number" && Number.isFinite(q.trailingAnnualDividendRate)) {
              dps = Number(q.trailingAnnualDividendRate.toFixed(isUS ? 2 : 1));
            }

            if (dividendYield === 0) {
              dps = 0;
            } else if (dps === 0 && (dividendYield === null || dividendYield === undefined)) {
              dividendYield = 0;
            } else if (dividendYield && dividendYield > 0 && (!dps || dps <= 0)) {
              dps = Number(((currentPrice * dividendYield) / 100).toFixed(isUS ? 2 : 1));
            }

            if (typeof q.epsTrailingTwelveMonths === "number" && Number.isFinite(q.epsTrailingTwelveMonths)) {
              eps = Number(q.epsTrailingTwelveMonths.toFixed(isUS ? 2 : 1));
            }
            const companyName = q.shortName || q.longName;
            if (typeof companyName === "string" && companyName.trim().length > 0 && !matchedPreset && !baselineAsset) {
              name = companyName.trim();
            }
          }
        }
      } catch {
        // Best effort
      }
    }
  } catch {
    // Ignore error and return populated fundamentals
  }

  // D1 database fallback if offline / Yahoo completely blocked
  if (!hasLivePrice && env?.DB) {
    try {
      const dbRow = await env.DB.prepare("SELECT prices FROM stock_series WHERE ticker = ?").bind(normTicker).first<{ prices?: string }>();
      if (dbRow?.prices) {
        const parsedPrices = JSON.parse(dbRow.prices) as Array<{ date: string; close: number }>;
        if (Array.isArray(parsedPrices) && parsedPrices.length >= 2) {
          const lastPt = parsedPrices[parsedPrices.length - 1];
          const prevPt = parsedPrices[parsedPrices.length - 2];
          if (
            lastPt &&
            Number.isFinite(lastPt.close) &&
            lastPt.close > 0 &&
            prevPt &&
            Number.isFinite(prevPt.close) &&
            prevPt.close > 0
          ) {
            currentPrice = lastPt.close;
            prevClose = prevPt.close;
            change = Number((currentPrice - prevClose).toFixed(isUS ? 2 : 1));
            changePct = Number((((currentPrice - prevClose) / prevPt.close) * 100).toFixed(2));
            sparkline = parsedPrices.slice(-10).map((p) => p.close);
            hasLivePrice = true;
          } else if (lastPt && Number.isFinite(lastPt.close) && lastPt.close > 0) {
            currentPrice = lastPt.close;
            prevClose = currentPrice;
            change = 0;
            changePct = 0;
            sparkline = parsedPrices.slice(-10).map((p) => p.close);
            hasLivePrice = true;
          }
        } else if (Array.isArray(parsedPrices) && parsedPrices.length === 1) {
          const singlePt = parsedPrices[0];
          if (singlePt && Number.isFinite(singlePt.close) && singlePt.close > 0) {
            currentPrice = singlePt.close;
            prevClose = currentPrice;
            change = 0;
            changePct = 0;
            sparkline = [singlePt.close];
            hasLivePrice = true;
          }
        }
      }
    } catch {
      // DB best effort
    }
  }

  return {
    ticker: normTicker,
    name,
    theme,
    sector,
    market,
    price: Number(currentPrice.toFixed(priceDecimals)),
    change: Number(change.toFixed(priceDecimals)),
    changePercent: Number(changePct.toFixed(2)),
    volume,
    previousClose: Number(prevClose.toFixed(priceDecimals)),
    dayHigh: Number(dayHigh.toFixed(priceDecimals)),
    dayLow: Number(dayLow.toFixed(priceDecimals)),
    yearHigh: Number(yearHigh.toFixed(priceDecimals)),
    yearLow: Number(yearLow.toFixed(priceDecimals)),
    marketCap,
    per,
    pbr,
    dividendYield,
    roe,
    equityRatio,
    eps,
    dps,
    sparkline: sparkline.length > 0 ? sparkline : [prevClose * 0.99, prevClose, currentPrice],
    technicalSignal,
    isEstimatedPer,
    perNote,
    ...(!hasLivePrice ? { isDemoData: true } : {}),
    historicalFinances,
  };
}

export let lastKnownScreenerUniverse: StockQuoteFundamentals[] | null = null;

export function resetLastKnownScreenerUniverse(): void {
  lastKnownScreenerUniverse = null;
}

export async function fetchLiveScreenerUniverse(
  prevUniverse?: StockQuoteFundamentals[] | null,
): Promise<StockQuoteFundamentals[]> {
  const universe: StockQuoteFundamentals[] = [];
  const querySymbols = POPULAR_STOCKS.map((preset) => toYahooSymbol(preset.ticker));

  const prevMap = new Map<string, StockQuoteFundamentals>();
  if (prevUniverse) {
    for (const item of prevUniverse) {
      prevMap.set(item.ticker, item);
    }
  }

  // 1. Yahoo crumb で全銘柄一括取得 (v7/finance/quote)
  const quotesMap = new Map<string, Record<string, unknown>>();
  const auth = await getYahooCrumb();
  if (auth) {
    try {
      const qUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(querySymbols.join(","))}&crumb=${encodeURIComponent(auth.crumb)}`;
      const qRes = await fetch(qUrl, {
        signal: AbortSignal.timeout(8000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Cookie: auth.cookie,
        },
      });
      if (qRes.ok) {
        const qData = (await qRes.json()) as {
          quoteResponse?: { result?: Array<Record<string, unknown>> };
        };
        for (const q of qData.quoteResponse?.result || []) {
          if (typeof q.symbol === "string") {
            quotesMap.set(q.symbol, q);
          }
        }
      } else if (qRes.status === 401 || qRes.status === 403) {
        resetYahooCrumbCache();
      }
    } catch {
      // ignore
    }
  }

  // 2. 各プリセット銘柄をStockQuoteFundamentalsに変換
  for (const preset of POPULAR_STOCKS) {
    const sym = toYahooSymbol(preset.ticker);
    const q = quotesMap.get(sym);
    const isUS = !/^\d/.test(preset.ticker);
    const market: StockQuoteFundamentals["market"] = isUS ? "US" : "PRIME";
    const prev = prevMap.get(preset.ticker);

    let price: number;
    let change: number;
    let changePct: number;
    let prevClose: number;
    let volume: number;
    let dayHigh: number;
    let dayLow: number;
    let yearHigh: number;
    let yearLow: number;
    let marketCap: number;
    let per: number | null = null;
    let isEstimatedPer = false;
    let perNote: string | undefined = undefined;
    let pbr: number | null = null;
    let dividendYield: number | null = null;
    let dps: number | null = null;
    let eps: number | null = null;
    let roe: number | null = null;
    let equityRatio: number | null = null;
    let sector = preset.theme;

    let isDemo = false;

    if (
      q &&
      typeof q.regularMarketPrice === "number" &&
      Number.isFinite(q.regularMarketPrice) &&
      q.regularMarketPrice > 0
    ) {
      price = q.regularMarketPrice;
      change =
        typeof q.regularMarketChange === "number" && Number.isFinite(q.regularMarketChange)
          ? q.regularMarketChange
          : 0;
      changePct =
        typeof q.regularMarketChangePercent === "number" &&
        Number.isFinite(q.regularMarketChangePercent)
          ? Number(q.regularMarketChangePercent.toFixed(2))
          : 0;
      prevClose =
        typeof q.regularMarketPreviousClose === "number" &&
        Number.isFinite(q.regularMarketPreviousClose)
          ? q.regularMarketPreviousClose
          : Number((price - change).toFixed(2));
      volume =
        typeof q.regularMarketVolume === "number" && Number.isFinite(q.regularMarketVolume)
          ? q.regularMarketVolume
          : 1000000;
      dayHigh =
        typeof q.regularMarketDayHigh === "number" && Number.isFinite(q.regularMarketDayHigh)
          ? q.regularMarketDayHigh
          : price;
      dayLow =
        typeof q.regularMarketDayLow === "number" && Number.isFinite(q.regularMarketDayLow)
          ? q.regularMarketDayLow
          : price;
      yearHigh =
        typeof q.fiftyTwoWeekHigh === "number" && Number.isFinite(q.fiftyTwoWeekHigh)
          ? q.fiftyTwoWeekHigh
          : price * 1.25;
      yearLow =
        typeof q.fiftyTwoWeekLow === "number" && Number.isFinite(q.fiftyTwoWeekLow)
          ? q.fiftyTwoWeekLow
          : price * 0.75;

      const rawCap =
        typeof q.marketCap === "number" && Number.isFinite(q.marketCap) ? q.marketCap : 0;
      if (rawCap > 0) {
        marketCap = isUS ? Math.round(rawCap / 1_000_000) : Math.round(rawCap / 100_000_000);
      } else {
        marketCap = prev?.marketCap ?? (isUS ? 50000 : 25000);
      }

      if (typeof q.forwardPE === "number" && Number.isFinite(q.forwardPE) && q.forwardPE > 0) {
        per = Number(q.forwardPE.toFixed(1));
        isEstimatedPer = false;
        perNote = undefined;
      } else if (typeof q.trailingPE === "number" && Number.isFinite(q.trailingPE) && q.trailingPE > 0) {
        per = Number(q.trailingPE.toFixed(1));
        isEstimatedPer = true;
        perNote = "会社予想非開示のため直近実績(TTM)より推計";
      } else if (
        typeof q.epsTrailingTwelveMonths === "number" &&
        Number.isFinite(q.epsTrailingTwelveMonths) &&
        q.epsTrailingTwelveMonths > 0 &&
        price > 0
      ) {
        per = Number((price / q.epsTrailingTwelveMonths).toFixed(1));
        isEstimatedPer = true;
        perNote = "会社予想非開示のため直近実績(TTM)より推計";
      } else {
        per = null;
        isEstimatedPer = false;
        perNote = undefined;
      }

      if (
        typeof q.priceToBook === "number" &&
        Number.isFinite(q.priceToBook) &&
        q.priceToBook > 0
      ) {
        pbr = Number(q.priceToBook.toFixed(2));
      } else {
        pbr = prev?.pbr ?? null;
      }

      if (typeof q.dividendYield === "number" && Number.isFinite(q.dividendYield)) {
        dividendYield = Number(q.dividendYield.toFixed(2));
      } else if (
        typeof q.trailingAnnualDividendYield === "number" &&
        Number.isFinite(q.trailingAnnualDividendYield)
      ) {
        dividendYield = Number((q.trailingAnnualDividendYield * 100).toFixed(2));
      } else {
        dividendYield = prev?.dividendYield ?? null;
      }

      if (typeof q.dividendRate === "number" && Number.isFinite(q.dividendRate)) {
        dps = Number(q.dividendRate.toFixed(isUS ? 2 : 1));
      } else if (
        typeof q.trailingAnnualDividendRate === "number" &&
        Number.isFinite(q.trailingAnnualDividendRate)
      ) {
        dps = Number(q.trailingAnnualDividendRate.toFixed(isUS ? 2 : 1));
      } else if (dividendYield && dividendYield > 0) {
        dps = Number(((price * dividendYield) / 100).toFixed(isUS ? 2 : 1));
      } else {
        dps = prev?.dps ?? null;
      }

      // 利回り0（無配）の確実な反映
      if (dividendYield === 0) {
        dps = 0;
      } else if (dps === 0 && (dividendYield === null || dividendYield === undefined)) {
        dividendYield = 0;
      }

      if (
        typeof q.epsTrailingTwelveMonths === "number" &&
        Number.isFinite(q.epsTrailingTwelveMonths)
      ) {
        eps = Number(q.epsTrailingTwelveMonths.toFixed(isUS ? 2 : 1));
      } else if (per && per > 0) {
        eps = Number((price / per).toFixed(isUS ? 2 : 1));
      } else {
        eps = prev?.eps ?? null;
      }

      if (
        typeof q.bookValue === "number" &&
        Number.isFinite(q.bookValue) &&
        q.bookValue > 0 &&
        eps
      ) {
        roe = Number(((eps / q.bookValue) * 100).toFixed(1));
      } else {
        roe = prev?.roe ?? (per && pbr ? Number(((pbr / per) * 100).toFixed(1)) : null);
      }

      equityRatio = prev?.equityRatio ?? null;
    } else if (prev) {
      price = prev.price;
      change = prev.change;
      changePct = prev.changePercent;
      prevClose = prev.previousClose;
      volume = prev.volume;
      dayHigh = prev.dayHigh;
      dayLow = prev.dayLow;
      yearHigh = prev.yearHigh;
      yearLow = prev.yearLow;
      marketCap = prev.marketCap;
      per = prev.per;
      isEstimatedPer = Boolean(prev.isEstimatedPer);
      perNote = prev.perNote;
      pbr = prev.pbr;
      dividendYield = prev.dividendYield;
      dps = prev.dps;
      eps = prev.eps;
      roe = prev.roe;
      equityRatio = prev.equityRatio;
      sector = prev.sector;
      isDemo = Boolean(prev.isDemoData);
    } else {
      // Fallback via getStockFundamentals
      const fallback = getStockFundamentals(preset.ticker);
      price = fallback.price;
      change = fallback.change;
      changePct = fallback.changePercent;
      prevClose = fallback.previousClose;
      volume = fallback.volume;
      dayHigh = fallback.dayHigh;
      dayLow = fallback.dayLow;
      yearHigh = fallback.yearHigh;
      yearLow = fallback.yearLow;
      marketCap = fallback.marketCap;
      per = fallback.per;
      isEstimatedPer = Boolean(fallback.isEstimatedPer);
      perNote = fallback.perNote;
      pbr = fallback.pbr;
      dividendYield = fallback.dividendYield;
      dps = fallback.dps;
      eps = fallback.eps;
      roe = fallback.roe;
      equityRatio = fallback.equityRatio;
      sector = fallback.sector;
      isDemo = fallback.isDemoData ?? true;
    }

    let technicalSignal: StockQuoteFundamentals["technicalSignal"] = "BUY";
    if (changePct > 2.0) technicalSignal = "STRONG_BUY";
    else if (changePct > 0) technicalSignal = "BUY";
    else if (changePct > -1.5) technicalSignal = "NEUTRAL";
    else technicalSignal = "SELL";

    // 財務ハイライト推移: モック合成 (marketCap * 0.72 等) を完全排除し、実キャッシュまたは実アンカーデータのみを採用
    const fallbackFund = getStockFundamentals(preset.ticker);
    const historicalFinances = (prev?.historicalFinances && prev.historicalFinances.length > 0)
      ? prev.historicalFinances
      : (fallbackFund?.historicalFinances && fallbackFund.historicalFinances.length > 0 && !fallbackFund.isDemoData)
        ? fallbackFund.historicalFinances
        : [];

    const sparkline = (prev?.sparkline && prev.sparkline.length > 0)
      ? prev.sparkline
      : (fallbackFund?.sparkline && fallbackFund.sparkline.length > 0)
        ? fallbackFund.sparkline
        : [prevClose, price];

    universe.push({
      ticker: preset.ticker,
      name: preset.name,
      theme: preset.theme,
      sector,
      market,
      price: Number(price.toFixed(isUS ? 2 : 1)),
      change: Number(change.toFixed(isUS ? 2 : 1)),
      changePercent: Number(changePct.toFixed(2)),
      volume,
      previousClose: Number(prevClose.toFixed(isUS ? 2 : 1)),
      dayHigh: Number(dayHigh.toFixed(isUS ? 2 : 1)),
      dayLow: Number(dayLow.toFixed(isUS ? 2 : 1)),
      yearHigh: Number(yearHigh.toFixed(isUS ? 2 : 1)),
      yearLow: Number(yearLow.toFixed(isUS ? 2 : 1)),
      marketCap,
      per,
      pbr,
      dividendYield,
      roe,
      equityRatio,
      eps,
      dps,
      sparkline,
      technicalSignal,
      isEstimatedPer,
      perNote,
      ...(isDemo ? { isDemoData: true } : {}),
      historicalFinances,
    });
  }

  return universe;
}

// 日銀金融政策決定会合 (BOJ) スケジュール公定マスター (2024 - 2027)
const BOJ_MEETING_SCHEDULE: ReadonlyArray<{ year: number; month: number; day: number }> = [
  // 2024
  { year: 2024, month: 1, day: 23 },
  { year: 2024, month: 3, day: 19 },
  { year: 2024, month: 4, day: 26 },
  { year: 2024, month: 6, day: 14 },
  { year: 2024, month: 7, day: 31 },
  { year: 2024, month: 9, day: 20 },
  { year: 2024, month: 10, day: 31 },
  { year: 2024, month: 12, day: 19 },
  // 2025
  { year: 2025, month: 1, day: 24 },
  { year: 2025, month: 3, day: 19 },
  { year: 2025, month: 5, day: 1 },
  { year: 2025, month: 6, day: 13 },
  { year: 2025, month: 7, day: 31 },
  { year: 2025, month: 9, day: 19 },
  { year: 2025, month: 10, day: 30 },
  { year: 2025, month: 12, day: 19 },
  // 2026
  { year: 2026, month: 1, day: 23 },
  { year: 2026, month: 3, day: 19 },
  { year: 2026, month: 4, day: 28 },
  { year: 2026, month: 6, day: 16 },
  { year: 2026, month: 7, day: 31 },
  { year: 2026, month: 9, day: 18 },
  { year: 2026, month: 10, day: 30 },
  { year: 2026, month: 12, day: 18 },
  // 2027
  { year: 2027, month: 1, day: 22 },
  { year: 2027, month: 3, day: 19 },
  { year: 2027, month: 4, day: 28 },
  { year: 2027, month: 6, day: 16 },
  { year: 2027, month: 7, day: 30 },
  { year: 2027, month: 9, day: 22 },
  { year: 2027, month: 10, day: 29 },
  { year: 2027, month: 12, day: 17 },
];

// 米FOMC スケジュール公定マスター (2024 - 2027)
const FOMC_MEETING_SCHEDULE: ReadonlyArray<{ year: number; month: number; day: number }> = [
  // 2024
  { year: 2024, month: 1, day: 31 },
  { year: 2024, month: 3, day: 20 },
  { year: 2024, month: 5, day: 1 },
  { year: 2024, month: 6, day: 12 },
  { year: 2024, month: 7, day: 31 },
  { year: 2024, month: 9, day: 18 },
  { year: 2024, month: 11, day: 7 },
  { year: 2024, month: 12, day: 18 },
  // 2025
  { year: 2025, month: 1, day: 29 },
  { year: 2025, month: 3, day: 19 },
  { year: 2025, month: 5, day: 7 },
  { year: 2025, month: 6, day: 18 },
  { year: 2025, month: 7, day: 30 },
  { year: 2025, month: 9, day: 17 },
  { year: 2025, month: 10, day: 29 },
  { year: 2025, month: 12, day: 10 },
  // 2026
  { year: 2026, month: 1, day: 28 },
  { year: 2026, month: 3, day: 18 },
  { year: 2026, month: 5, day: 6 },
  { year: 2026, month: 6, day: 17 },
  { year: 2026, month: 7, day: 29 },
  { year: 2026, month: 9, day: 16 },
  { year: 2026, month: 11, day: 4 },
  { year: 2026, month: 12, day: 16 },
  // 2027
  { year: 2027, month: 1, day: 27 },
  { year: 2027, month: 3, day: 17 },
  { year: 2027, month: 5, day: 5 },
  { year: 2027, month: 6, day: 16 },
  { year: 2027, month: 7, day: 28 },
  { year: 2027, month: 9, day: 22 },
  { year: 2027, month: 11, day: 3 },
  { year: 2027, month: 12, day: 15 },
];

function adjustToWeekday(d: Date): Date {
  const res = new Date(d);
  const day = res.getDay();
  if (day === 0) res.setDate(res.getDate() + 1); // 日曜 -> 月曜
  if (day === 6) res.setDate(res.getDate() + 2); // 土曜 -> 月曜
  return res;
}

function generateUpcomingMacroEvents(refDate = new Date()): CalendarEvent[] {
  const mStr = (m: number) => String(m).padStart(2, "0");
  const dStr = (d: number) => String(d).padStart(2, "0");
  const fmt = (d: Date) => `${mStr(d.getMonth() + 1)}/${dStr(d.getDate())}`;
  const fmtFull = (d: Date) => `${d.getFullYear()}-${mStr(d.getMonth() + 1)}-${dStr(d.getDate())}`;

  const events: CalendarEvent[] = [];
  const refTime = refDate.getTime() - 24 * 60 * 60 * 1000; // 過去24時間以内は当日分として保持

  // 1. 日銀会合 (直近2回)
  let bojCount = 0;
  for (const item of BOJ_MEETING_SCHEDULE) {
    const d = new Date(item.year, item.month - 1, item.day);
    if (d.getTime() >= refTime && bojCount < 2) {
      events.push({
        id: `macro-boj-${item.year}-${mStr(item.month)}`,
        date: fmt(d),
        fullDate: fmtFull(d),
        type: "MACRO",
        title: "日銀金融政策決定会合・総裁記者会見",
        importance: "HIGH",
        time: "15:30 JST",
        market: "TSE",
        previous: "0.25%",
        forecast: "0.50%",
        description: "日銀金融政策決定会合後の総裁定例記者会見。政策金利判断や国債買入れ方針に注目。",
      });
      bojCount++;
    }
  }

  // 2. 米FOMC (直近2回)
  let fomcCount = 0;
  for (const item of FOMC_MEETING_SCHEDULE) {
    const d = new Date(item.year, item.month - 1, item.day);
    if (d.getTime() >= refTime && fomcCount < 2) {
      events.push({
        id: `macro-fomc-${item.year}-${mStr(item.month)}`,
        date: fmt(d),
        fullDate: fmtFull(d),
        type: "MACRO",
        title: "米FOMC 政策金利発表 & パウエル議長記者会見",
        importance: "HIGH",
        time: "03:00 JST",
        market: "US",
        previous: "4.75%",
        forecast: "4.50%",
        description: "米連邦公開市場委員会（FOMC）政策金利発表および議長会見。FF金利誘導目標。",
      });
      fomcCount++;
    }
  }

  // 3. 米雇用統計 (当月または翌月の第1金曜日、直近2回)
  for (let offset = 0; offset <= 3; offset++) {
    const targetMonth = new Date(refDate.getFullYear(), refDate.getMonth() + offset, 1);
    const y = targetMonth.getFullYear();
    const m = targetMonth.getMonth();
    const firstDay = new Date(y, m, 1);
    const dayOfWeek = firstDay.getDay();
    const diff = (5 - dayOfWeek + 7) % 7;
    const friday = new Date(y, m, 1 + diff);
    if (
      friday.getTime() >= refTime &&
      events.filter((e) => e.id.startsWith("macro-jobs")).length < 2
    ) {
      events.push({
        id: `macro-jobs-${y}-${mStr(m + 1)}`,
        date: fmt(friday),
        fullDate: fmtFull(friday),
        type: "MACRO",
        title: "米雇用統計 (非農業部門雇用者数・失業率)",
        importance: "HIGH",
        time: "21:30 JST",
        market: "US",
        previous: "14.2万人",
        forecast: "15.0万人",
        description: "米労働省発表。非農業部門雇用者数変化、失業率、平均時給の伸び率。",
      });
    }
  }

  // 4. 米CPI (毎月中旬12日前後の平日、直近2回)
  for (let offset = 0; offset <= 3; offset++) {
    const targetMonth = new Date(refDate.getFullYear(), refDate.getMonth() + offset, 1);
    const y = targetMonth.getFullYear();
    const m = targetMonth.getMonth();
    const cpiDate = adjustToWeekday(new Date(y, m, 12));
    if (
      cpiDate.getTime() >= refTime &&
      events.filter((e) => e.id.startsWith("macro-cpi")).length < 2
    ) {
      events.push({
        id: `macro-cpi-${y}-${mStr(m + 1)}`,
        date: fmt(cpiDate),
        fullDate: fmtFull(cpiDate),
        type: "MACRO",
        title: "米消費者物価指数 (CPI) 発表",
        importance: "HIGH",
        time: "21:30 JST",
        market: "US",
        previous: "2.7%",
        forecast: "2.6%",
        description: "米労働省発表。総合およびコア消費者物価指数のインフレ動向。",
      });
    }
  }

  // 5. 日本全国CPI (毎月第3または第4金曜日、直近2回)
  for (let offset = 0; offset <= 3; offset++) {
    const targetMonth = new Date(refDate.getFullYear(), refDate.getMonth() + offset, 1);
    const y = targetMonth.getFullYear();
    const m = targetMonth.getMonth();
    const cpiJpDate = adjustToWeekday(new Date(y, m, 19));
    if (
      cpiJpDate.getTime() >= refTime &&
      events.filter((e) => e.id.startsWith("macro-jp-cpi")).length < 2
    ) {
      events.push({
        id: `macro-jp-cpi-${y}-${mStr(m + 1)}`,
        date: fmt(cpiJpDate),
        fullDate: fmtFull(cpiJpDate),
        type: "MACRO",
        title: "日本 全国消費者物価指数 (全国CPI)",
        importance: "HIGH",
        time: "08:30 JST",
        market: "TSE",
        previous: "2.8%",
        forecast: "2.7%",
        description: "総務省発表。生鮮食品を除くコアCPI前年比。日銀利上げ判断の重要指標。",
      });
    }
  }

  return events;
}

function generateFallbackEarningsEvents(
  universe?: StockQuoteFundamentals[],
  refDate = new Date(),
): CalendarEvent[] {
  const capMap = new Map<string, number>();
  if (universe) {
    for (const u of universe) {
      if (u.marketCap > 0) capMap.set(u.ticker, u.marketCap);
    }
  }

  const mStr = (m: number) => String(m).padStart(2, "0");
  const dStr = (d: number) => String(d).padStart(2, "0");
  const fmt = (d: Date) => `${mStr(d.getMonth() + 1)}/${dStr(d.getDate())}`;
  const fmtFull = (d: Date) => `${d.getFullYear()}-${mStr(d.getMonth() + 1)}-${dStr(d.getDate())}`;

  // 基準日以降の平日に自然に分散配置
  const addBusinessDays = (start: Date, days: number): Date => {
    const cur = new Date(start);
    let added = 0;
    while (added < days) {
      cur.setDate(cur.getDate() + 1);
      const day = cur.getDay();
      if (day !== 0 && day !== 6) {
        added++;
      }
    }
    return cur;
  };

  const corporateList = [
    {
      id: "earn-toyota",
      ticker: "7203",
      companyName: "トヨタ自動車",
      title: "トヨタ自動車 (7203) 決算発表",
      defaultCap: 345000,
      importance: "HIGH" as const,
      days: 2,
    },
    {
      id: "earn-shinetsu",
      ticker: "4063",
      companyName: "信越化学工業",
      title: "信越化学工業 (4063) 決算発表",
      defaultCap: 115000,
      importance: "HIGH" as const,
      days: 5,
    },
    {
      id: "earn-fanuc",
      ticker: "6954",
      companyName: "ファナック",
      title: "ファナック (6954) 決算発表",
      defaultCap: 41000,
      importance: "MEDIUM" as const,
      days: 7,
    },
    {
      id: "earn-advantest",
      ticker: "6857",
      companyName: "アドバンテスト",
      title: "アドバンテスト (6857) 決算発表",
      defaultCap: 300000,
      importance: "HIGH" as const,
      days: 10,
    },
    {
      id: "earn-aapl",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      title: "Apple (AAPL) 決算発表",
      defaultCap: 4900000,
      importance: "HIGH" as const,
      days: 13,
    },
    {
      id: "earn-sbg",
      ticker: "9984",
      companyName: "ソフトバンクグループ",
      title: "ソフトバンクグループ (9984) 決算発表",
      defaultCap: 135000,
      importance: "HIGH" as const,
      days: 16,
    },
    {
      id: "earn-tel",
      ticker: "8035",
      companyName: "東京エレクトロン",
      title: "東京エレクトロン (8035) 決算発表",
      defaultCap: 290000,
      importance: "HIGH" as const,
      days: 19,
    },
    {
      id: "earn-nvda",
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      title: "NVIDIA (NVDA) 決算発表",
      defaultCap: 5500000,
      importance: "HIGH" as const,
      days: 23,
    },
  ];

  return corporateList.map((corp) => {
    const targetDate = addBusinessDays(refDate, corp.days);
    const isUS = corp.ticker === "AAPL" || corp.ticker === "NVDA";
    return {
      id: corp.id,
      date: fmt(targetDate),
      fullDate: fmtFull(targetDate),
      type: "EARNINGS" as const,
      title: corp.title,
      ticker: corp.ticker,
      companyName: corp.companyName,
      importance: corp.importance,
      marketCap: capMap.get(corp.ticker) ?? corp.defaultCap,
      market: isUS ? "US" : "TSE",
      time: isUS ? "06:30 JST (米引け後)" : "15:00 JST (東証引け後)",
      description: `${corp.companyName} (${corp.ticker}) の四半期業績および通期見通し発表。`,
      source: "fallback",
    };
  });
}

function sortCalendarEvents(events: CalendarEvent[], refDate = new Date()): CalendarEvent[] {
  const currentYear = refDate.getFullYear();
  const currentMonth = refDate.getMonth() + 1;

  const parseTime = (e: CalendarEvent): number => {
    if (e.fullDate) {
      const parts = e.fullDate.split("-");
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
          return new Date(y, m - 1, d).getTime();
        }
      }
    }
    const parts = e.date.split("/");
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    if (isNaN(m) || isNaN(d)) return 0;
    let y = currentYear;
    if (m < currentMonth && currentMonth - m >= 6) {
      y = currentYear + 1;
    } else if (m > currentMonth && m - currentMonth >= 6) {
      y = currentYear - 1;
    }
    return new Date(y, m - 1, d).getTime();
  };

  return [...events].sort((a, b) => parseTime(a) - parseTime(b));
}

export let lastKnownCalendarEvents: CalendarEvent[] | null = null;
export function getLastKnownCalendarEvents(): CalendarEvent[] | null {
  return lastKnownCalendarEvents;
}
export function resetLastKnownCalendarEvents(): void {
  lastKnownCalendarEvents = null;
}

/**
 * 同期フォールバックカレンダー生成ヘルパー。
 * 外部通信を行わず、現在日時に適応した確定マクロ日程と平日配置の決算日程を生成する。
 * 各イベントに source: "fallback" を付与。
 */
export function fetchLiveMarketCalendar(
  universe?: StockQuoteFundamentals[],
  refDate = new Date(),
): CalendarEvent[] {
  const macros = generateUpcomingMacroEvents(refDate).map((m) => ({ ...m, source: "fallback" }));
  const earnings = generateFallbackEarningsEvents(universe, refDate);
  const combined = sortCalendarEvents([...macros, ...earnings], refDate);
  if (!lastKnownCalendarEvents) {
    lastKnownCalendarEvents = combined;
  }
  return combined;
}

/**
 * リアルタイムカレンダー取得（非同期）。
 * Yahoo Finance から主要企業の最新決算予定日時をライブ取得し、
 * 公定スケジュールと統合する。通信失敗時は動的フォールバックを返却。
 */
export async function fetchLiveMarketCalendarAsync(
  universe?: StockQuoteFundamentals[],
  refDate = new Date(),
): Promise<CalendarEvent[]> {
  const macroEvents = generateUpcomingMacroEvents(refDate);

  const liveEarnings: CalendarEvent[] = [];
  const fallbackCorporateTickers = [
    "7203",
    "4063",
    "6954",
    "6857",
    "AAPL",
    "9984",
    "8035",
    "NVDA",
  ];
  const tickersToQuery = Array.from(
    new Set([
      ...POPULAR_STOCKS.map((s) => s.ticker),
      ...fallbackCorporateTickers,
      "AAPL",
      "NVDA",
      "MSFT",
      "AMZN",
      "GOOGL",
      "META",
      "TSLA",
    ]),
  );

  try {
    const auth = await getYahooCrumb();
    if (auth) {
      const symbols = tickersToQuery.map(toYahooSymbol);
      const qUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}&crumb=${encodeURIComponent(auth.crumb)}`;
      const qRes = await fetch(qUrl, {
        signal: AbortSignal.timeout(5000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Cookie: auth.cookie,
        },
      });
      if (qRes.ok) {
        const qData = (await qRes.json()) as {
          quoteResponse?: {
            result?: Array<{
              symbol?: string;
              shortName?: string;
              longName?: string;
              displayName?: string;
              marketCap?: number;
              earningsTimestamp?: number;
              earningsTimestampStart?: number;
              earningsTimestampEnd?: number;
            }>;
          };
        };

        const results = qData.quoteResponse?.result || [];
        const mStr = (m: number) => String(m).padStart(2, "0");
        const dStr = (d: number) => String(d).padStart(2, "0");
        const refTime = refDate.getTime() - 7 * 24 * 60 * 60 * 1000; // 直近7日以内〜未来
        const maxTime = refDate.getTime() + 90 * 24 * 60 * 60 * 1000; // 向こう90日以内

        for (const q of results) {
          const rawSymbol = q.symbol || "";
          const normTicker = rawSymbol.replace(/\.T$/i, "");
          const rawTimestamp = q.earningsTimestamp || q.earningsTimestampStart;
          if (typeof rawTimestamp === "number" && rawTimestamp > 0) {
            const earnTime = rawTimestamp * 1000;
            if (earnTime >= refTime && earnTime <= maxTime) {
              const jstDate = new Date(earnTime + 9 * 60 * 60 * 1000);
              const matchedPreset = POPULAR_STOCKS.find((s) => s.ticker === normTicker);
              const companyName = matchedPreset?.name || q.displayName || q.shortName || normTicker;
              const title = `${companyName} (${normTicker}) 決算発表`;
              const isUS = !/^\d{4}/.test(normTicker) && !rawSymbol.endsWith(".T");
              const marketCap = q.marketCap
                ? isUS
                  ? Math.round(q.marketCap / 1_000_000)
                  : Math.round(q.marketCap / 100_000_000)
                : undefined;
              const isHighImportance = isUS
                ? marketCap !== undefined && marketCap >= 500000
                : marketCap !== undefined && marketCap >= 50000;
              const dateStr = `${mStr(jstDate.getUTCMonth() + 1)}/${dStr(jstDate.getUTCDate())}`;
              const fullDateStr = `${jstDate.getUTCFullYear()}-${mStr(jstDate.getUTCMonth() + 1)}-${dStr(jstDate.getUTCDate())}`;

              liveEarnings.push({
                id: `earn-live-${normTicker.toLowerCase()}`,
                date: dateStr,
                fullDate: fullDateStr,
                type: "EARNINGS",
                title,
                ticker: normTicker,
                companyName,
                marketCap,
                importance: isHighImportance ? "HIGH" : "MEDIUM",
                market: isUS ? "US" : "TSE",
                time: isUS ? "06:30 JST (米引け後)" : "15:00 JST (東証引け後)",
                description: `${companyName} (${normTicker}) 決算発表`,
                // 実データのため source は付与しない (undefined)
              });
            }
          }
        }
      } else if (qRes.status === 401 || qRes.status === 403) {
        resetYahooCrumbCache();
      }
    }
  } catch (err) {
    console.warn("fetchLiveMarketCalendarAsync: Live quote fetch failed, using fallback:", err);
  }

  // 実データ決算イベントをフォールバック決算リストと統合
  const fallbackEarnings = generateFallbackEarningsEvents(universe, refDate);
  let finalEarnings: CalendarEvent[] = [];
  let finalMacros = macroEvents;

  if (liveEarnings.length > 0) {
    // 取得できた実データがあれば該当銘柄を実データに置換し、新規実データ銘柄を追加 (日本企業イベントの脱落を防止)
    const liveMap = new Map<string, CalendarEvent>();
    for (const le of liveEarnings) {
      if (le.ticker) liveMap.set(le.ticker, le);
    }

    finalEarnings = fallbackEarnings.map((fe) => {
      if (fe.ticker && liveMap.has(fe.ticker)) {
        return liveMap.get(fe.ticker)!;
      }
      return fe;
    });

    for (const le of liveEarnings) {
      if (le.ticker && !fallbackEarnings.some((fe) => fe.ticker === le.ticker)) {
        finalEarnings.push(le);
      }
    }
  } else {
    // 実データ取得ゼロ件 (ネットワーク不通など): 全イベントに source: fallback を付与
    finalEarnings = fallbackEarnings;
    finalMacros = macroEvents.map((m) => ({ ...m, source: "fallback" }));
  }

  const combined = sortCalendarEvents([...finalMacros, ...finalEarnings], refDate);

  const hasLive = liveEarnings.length > 0;
  if (hasLive || !lastKnownCalendarEvents) {
    lastKnownCalendarEvents = combined;
  }

  return combined;
}

export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}

export function json(
  data: unknown,
  status = 200,
  request?: Request,
  customHeaders?: Record<string, string>,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
    ...customHeaders,
  };

  // Cloudflare Assets 経由で同じドメインから呼ばれる場合は CORS 不要。
  // 開発時のローカルホストからのクロスドメインリクエストのみ許可。
  if (request) {
    const origin = request.headers.get("origin");
    if (origin && isAllowedOrigin(origin)) {
      headers["access-control-allow-origin"] = origin;
      headers["access-control-allow-methods"] = "GET,POST,PUT,DELETE,OPTIONS";
      headers["access-control-allow-headers"] =
        "content-type,x-owner-token,x-admin-key,x-auth-password,x-auth-mode,authorization,cache-control,pragma,if-none-match";
      headers["access-control-expose-headers"] = "etag, x-data-stale, x-cache";
    }
    // The CORS headers above are selected by the request Origin, so the
    // response must always declare Vary: Origin (RFC 9110 §12.5.5). Emitting
    // it only for allowed origins let a shared cache store a response without
    // CORS headers (or with headers for a different origin) and reuse it for a
    // later cross-origin request.
    headers["vary"] = "Origin";

    const pathname = new URL(request.url).pathname;
    const isMutation =
      request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS";
    if (
      status >= 400 ||
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/admin/") ||
      isMutation
    ) {
      if (!headers["cache-control"]) {
        headers["cache-control"] = "no-store";
      }
    }
  }

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

export function notModified(request?: Request, customHeaders?: Record<string, string>) {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
    ...customHeaders,
  };
  if (request) {
    const origin = request.headers.get("origin");
    if (origin && isAllowedOrigin(origin)) {
      headers["access-control-allow-origin"] = origin;
      headers["access-control-allow-methods"] = "GET,POST,PUT,DELETE,OPTIONS";
      headers["access-control-allow-headers"] =
        "content-type,x-owner-token,x-admin-key,x-auth-password,x-auth-mode,authorization,cache-control,pragma,if-none-match";
      headers["access-control-expose-headers"] = "etag, x-data-stale, x-cache";
    }
    // See json(): Vary must be declared whenever CORS headers are selected by
    // the Origin header, even when this particular request is not allowed.
    headers["vary"] = "Origin";
  }
  return new Response(null, {
    status: 304,
    headers,
  });
}

/**
 * RFC 7232 / RFC 9110 conditional request validator for If-None-Match header.
 * Supports wildcard (*), comma-separated ETag lists, whitespace normalization,
 * and weak/strong comparison (W/"..." vs "...").
 */
export function matchesIfNoneMatch(
  ifNoneMatchHeader: string | null | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatchHeader || !etag) return false;
  const trimmedHeader = ifNoneMatchHeader.trim();
  if (!trimmedHeader) return false;
  if (trimmedHeader === "*") return true;

  const normalizeTag = (tag: string) => {
    let t = tag.trim();
    if (t.startsWith("W/") || t.startsWith("w/")) t = t.slice(2).trim();
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
      t = t.slice(1, -1);
    }
    return t;
  };

  const target = normalizeTag(etag);
  const candidates = trimmedHeader.split(",").map(normalizeTag);
  return candidates.some((candidate) => candidate === target);
}

/**
 * Extracts the client IP address for rate limiting.
 *
 * Trust order:
 * 1. `CF-Connecting-IP` — set by Cloudflare's edge from the actual TCP peer and
 *    therefore the only authoritative source inside a Cloudflare Worker.
 * 2. `X-Real-IP` — only honored when CF-Connecting-IP is absent (non-CF
 *    environments such as local dev behind a single trusted proxy).
 * 3. `X-Forwarded-For` — spoofable by the client, so it is used last and
 *    interpreted as a trusted proxy chain: the right-most entry is the address
 *    appended by the closest trusted proxy, not the client-supplied left-most
 *    entry.
 *
 * This ordering prevents direct clients from bypassing rate limits by sending
 * forged `X-Real-IP` / `X-Forwarded-For` headers.
 */
export function getClientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwardedHeader = request.headers.get("x-forwarded-for")?.trim();
  if (forwardedHeader) {
    // Trusted-proxy-chain interpretation: the right-most hop is the one added
    // by the infrastructure we control; the left-most is client-controlled.
    const hops = forwardedHeader
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}

// Maximum request body size (1 MB) to prevent DoS attacks
export const MAX_REQUEST_BODY_SIZE = 1024 * 1024;

export async function parseJsonBody(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  try {
    // Check Content-Length header to reject oversized payloads early
    const contentLength = request.headers.get("content-length");
    if (
      contentLength &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BODY_SIZE)
    ) {
      return { ok: false, response: json({ error: "Request body too large" }, 413, request) };
    }

    // Content-Length is optional for streamed/chunked requests. Read the
    // stream with a hard cap as well so those requests cannot bypass the
    // limit by omitting the header.
    const reader = request.body?.getReader();
    if (!reader) {
      return { ok: false, response: json({ error: "Invalid JSON body" }, 400, request) };
    }
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize > MAX_REQUEST_BODY_SIZE) {
        await reader.cancel();
        return { ok: false, response: json({ error: "Request body too large" }, 413, request) };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {
        ok: false,
        response: json({ error: "Invalid JSON body: expected an object" }, 400, request),
      };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON body" }, 400, request) };
  }
}

// Rate limiting: check and update per-IP request count in D1
export const RATE_LIMIT_WINDOW = 60; // seconds
export const RATE_LIMIT_MAX = 60; // max requests per window per endpoint

// Endpoints that receive high read/compute traffic use in-memory rate limiting
// to prevent exhausting Cloudflare D1's 100,000 rows/month write quota (approx 3,333 writes/day).
export const HIGH_FREQUENCY_RATE_LIMIT_ENDPOINTS = new Set([
  "snapshot",
  "ticker-prices",
  "calculate",
  "market-overview",
  "stock-fundamentals",
  "stocks-screener",
  "market-calendar",
  // The index list is the only read endpoint the UI refetches after every
  // mutation; an unauthenticated client could otherwise loop it without any
  // per-IP limit (each request costs JSON.stringify + SHA-256 for the ETag).
  "indices-list",
]);

export interface MemoryRateLimitRecord {
  count: number;
  windowStart: number;
}
export const memoryRateLimits = new Map<string, MemoryRateLimitRecord>();
export const MAX_MEMORY_RATE_LIMIT_ENTRIES = 1000;

export function clearMemoryRateLimits(): void {
  memoryRateLimits.clear();
}

export function checkMemoryRateLimit(
  ip: string,
  endpoint: string,
  maxRequests: number,
  windowSeconds = RATE_LIMIT_WINDOW,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const key = `${ip}::${endpoint}`;
  const record = memoryRateLimits.get(key);

  if (!record || now - record.windowStart >= windowSeconds) {
    if (!record && memoryRateLimits.size >= MAX_MEMORY_RATE_LIMIT_ENTRIES) {
      const oldestKey = memoryRateLimits.keys().next().value;
      if (oldestKey) memoryRateLimits.delete(oldestKey);
    }
    memoryRateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count += 1;
  return true;
}

export function requestsFreshCalculation(request: Request): boolean {
  const pragma = (request.headers.get("pragma") || "").toLowerCase().trim();
  if (pragma.split(",").some((directive) => directive.trim() === "no-cache")) {
    return true;
  }
  return (request.headers.get("cache-control") || "")
    .split(",")
    .some((directive) => {
      const d = directive.trim().toLowerCase();
      return d === "no-cache" || d === "no-store" || d === "max-age=0";
    });
}

export async function checkRateLimit(
  env: Env,
  ip: string,
  endpoint: string,
  maxRequests = RATE_LIMIT_MAX,
  failClosed = false,
  ctx?: WorkerExecutionContext,
): Promise<boolean> {
  // High-frequency read & compute endpoints use in-memory rate limiting to
  // protect Cloudflare D1's strict 100,000 writes/month free-tier quota.
  if (HIGH_FREQUENCY_RATE_LIMIT_ENDPOINTS.has(endpoint)) {
    return checkMemoryRateLimit(ip, endpoint, maxRequests);
  }

  const now = Math.floor(Date.now() / 1000);
  try {
    // Probabilistic cleanup of dead rate_limit rows (approx every 100 requests)
    if (Math.random() < 0.01) {
      const purgePromise = env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
        .bind(now - 3600)
        .run()
        .catch(() => {});
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(purgePromise);
      }
    }

    // Reserve a request slot atomically. The former SELECT-then-UPDATE flow
    // allowed concurrent calls that all observed the same count just below the
    // limit, so each was admitted. The WHERE clause makes a saturated active
    // window a no-op (meta.changes = 0); an expired window is reset to one.
    const result = await env.DB.prepare(
      "INSERT INTO rate_limits (ip, endpoint, request_count, window_start) VALUES (?, ?, 1, ?) ON CONFLICT(ip, endpoint) DO UPDATE SET request_count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.request_count + 1 END, window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END WHERE rate_limits.window_start <= ? OR rate_limits.request_count < ?",
    )
      .bind(
        ip,
        endpoint,
        now,
        now - RATE_LIMIT_WINDOW,
        now - RATE_LIMIT_WINDOW,
        now - RATE_LIMIT_WINDOW,
        maxRequests,
      )
      .run();
    const changes = (result as { meta?: { changes?: number } }).meta?.changes;
    // D1 always reports meta.changes. Retain compatibility with the project's
    // lightweight D1 adapters, which model a successful write without this
    // optional metadata field.
    return changes === undefined || changes === 1;
  } catch (err) {
    if (failClosed) {
      console.error(`Rate limit check failed for ${endpoint}:`, err);
      return false;
    }
    // Non-authenticated public endpoints remain available if the optional
    // abuse-prevention table is temporarily unavailable.
    return true;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx?: WorkerExecutionContext): Promise<Response> {
    try {
      if (request.method === "OPTIONS")
        return json({ ok: true }, 200, request, { "access-control-max-age": "86400" });

      const url = new URL(request.url);

      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "indexforge-worker" }, 200, request);
      }

      // Cloudflare Turnstile設定および管理者ロックアウト状態取得
      if (url.pathname === "/api/auth/turnstile-config" && request.method === "GET") {
        try {
          const ip = getClientIp(request);
          const lockout = await checkAdminLoginLockout(env, ip);
          const siteKey = env.TURNSTILE_SITE_KEY?.trim() || TURNSTILE_DEFAULT_SITE_KEY;
          return json(
            {
              ok: true,
              siteKey,
              lockout: {
                locked: lockout.locked,
                remainingSeconds: lockout.remainingSeconds,
                remainingAttempts: lockout.remainingAttempts,
              },
            },
            200,
            request,
          );
        } catch (err) {
          console.error("Turnstile config endpoint error:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 管理者ログイン専用認証 (Turnstile検証 + 試行回数制限 + 秘密の暗号検証)
      if (url.pathname === "/api/auth/admin-login" && request.method === "POST") {
        try {
          const ip = getClientIp(request);
          const lockout = await checkAdminLoginLockout(env, ip);
          if (lockout.locked) {
            const minutes = Math.ceil(lockout.remainingSeconds / 60);
            return json(
              {
                ok: false,
                locked: true,
                remainingSeconds: lockout.remainingSeconds,
                remainingAttempts: 0,
                error: `管理者ログインの試行回数上限（${ADMIN_LOGIN_MAX_ATTEMPTS}回）に達したためロックされています。あと約${minutes}分後に再試行してください。`,
              },
              429,
              request,
            );
          }

          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return parsed.response;
          const password =
            typeof parsed.body.password === "string" ? parsed.body.password.trim() : "";
          const secretCode =
            typeof parsed.body.secretCode === "string" ? parsed.body.secretCode.normalize("NFC").trim() : "";
          const turnstileToken =
            typeof parsed.body.turnstileToken === "string" ? parsed.body.turnstileToken.trim() : "";

          if (!password) {
            return json({ ok: false, error: "管理者パスワードを入力してください" }, 400, request);
          }
          if (!secretCode) {
            return json({ ok: false, error: "秘密の暗号を入力してください" }, 400, request);
          }
          if (!turnstileToken) {
            return json(
              { ok: false, error: "Turnstile認証（ロボット確認）を完了してください" },
              400,
              request,
            );
          }

          // 1. Turnstile トークン検証
          const tsRes = await verifyTurnstileToken(
            env.TURNSTILE_SECRET_KEY,
            turnstileToken,
            ip,
            isLocalOrTestHost(url.hostname),
          );
          if (!tsRes.success) {
            return json(
              {
                ok: false,
                error: tsRes.error || "Turnstile認証に失敗しました。再試行してください。",
              },
              400,
              request,
            );
          }

          // 2. 秘密の暗号検証
          const isSecretValid = await verifyAdminSecretCode(
            env,
            secretCode,
            isLocalOrTestHost(url.hostname),
          );
          if (!isSecretValid) {
            const fail = await recordAdminLoginFailure(env, ip);
            if (fail.locked) {
              const minutes = Math.ceil(fail.remainingSeconds / 60);
              return json(
                {
                  ok: false,
                  locked: true,
                  remainingSeconds: fail.remainingSeconds,
                  remainingAttempts: 0,
                  error: `試行回数の上限（${ADMIN_LOGIN_MAX_ATTEMPTS}回）に達したためロックされました。約${minutes}分後に再試行してください。`,
                },
                429,
                request,
              );
            }
            return json(
              {
                ok: false,
                remainingAttempts: fail.remainingAttempts,
                error: `秘密の暗号が正しくありません（残り試行可能回数: ${fail.remainingAttempts}回）`,
              },
              401,
              request,
            );
          }

          // 3. 管理者パスワード検証
          const auth = await authenticatePassword(request, env, password, "auth-login", ctx);
          if (!auth.authenticated || auth.role !== "admin") {
            const fail = await recordAdminLoginFailure(env, ip);
            if (fail.locked) {
              const minutes = Math.ceil(fail.remainingSeconds / 60);
              return json(
                {
                  ok: false,
                  locked: true,
                  remainingSeconds: fail.remainingSeconds,
                  remainingAttempts: 0,
                  error: `試行回数の上限（${ADMIN_LOGIN_MAX_ATTEMPTS}回）に達したためロックされました。約${minutes}分後に再試行してください。`,
                },
                429,
                request,
              );
            }
            return json(
              {
                ok: false,
                remainingAttempts: fail.remainingAttempts,
                error: `管理者パスワードが正しくありません（残り試行可能回数: ${fail.remainingAttempts}回）`,
              },
              401,
              request,
            );
          }

          // 4. 成功時: 失敗カウントをリセット
          await resetAdminLoginAttempts(env, ip);

          return json(
            {
              ok: true,
              role: auth.role,
              name: auth.name,
              maxStocks: auth.maxStocks,
              maxIndices: auth.maxIndices ?? null,
              id: auth.id,
            },
            200,
            request,
          );
        } catch (err) {
          console.error("Admin login endpoint error:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // パスワード認証確認
      if (url.pathname === "/api/auth/verify" && request.method === "POST") {
        try {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return parsed.response;
          const password = typeof parsed.body.password === "string" ? parsed.body.password : "";
          const requestedRole = typeof parsed.body.role === "string" ? parsed.body.role : undefined;
          const userOnly = Boolean(
            parsed.body.userOnly === true ||
            requestedRole === "user" ||
            request.headers.get("x-auth-mode") === "user",
          );
          const auth = await authenticatePassword(request, env, password, "auth-login", ctx);
          if (!auth.authenticated) {
            return json(
              { ok: false, error: auth.error || "パスワードが正しくありません" },
              401,
              request,
            );
          }
          if (userOnly && auth.role === "admin") {
            return json(
              {
                ok: false,
                error:
                  "管理者としてログインするには「管理者ログイン」から秘密の暗号およびTurnstile認証を行ってください",
              },
              403,
              request,
            );
          }
          return json(
            {
              ok: true,
              role: auth.role,
              name: auth.name,
              maxStocks: auth.maxStocks,
              maxIndices: auth.maxIndices ?? null,
              id: auth.id,
            },
            200,
            request,
          );
        } catch (err) {
          console.error("Authentication endpoint error:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 管理者向け: ユーザーパスワード一覧取得 (マスター管理者を除外)
      if (url.pathname === "/api/admin/passwords" && request.method === "GET") {
        try {
          const auth = await authenticatePassword(request, env, null, "auth-api", ctx);
          if (!auth.authenticated || auth.role !== "admin") {
            return json({ error: "管理者権限が必要です" }, 403, request);
          }
          await ensurePasswordTable(env);
          let results: D1Row[] | undefined;
          try {
            const dbRes = await env.DB.prepare(
              "SELECT id, name, role, max_stocks, max_indices, is_active, created_at, updated_at FROM access_passwords WHERE id != 'admin-master' ORDER BY created_at DESC",
            ).all();
            results = dbRes.results;
          } catch (lookupErr: unknown) {
            if (!isMissingColumnError(lookupErr, "max_indices")) throw lookupErr;
            const dbRes = await env.DB.prepare(
              "SELECT id, name, role, max_stocks, is_active, created_at, updated_at FROM access_passwords WHERE id != 'admin-master' ORDER BY created_at DESC",
            ).all();
            results = dbRes.results;
          }
          return json(results || [], 200, request);
        } catch (err) {
          console.error("Failed to fetch passwords:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 管理者向け: ユーザーパスワード新規作成（銘柄数制限設定 & 指数上限設定）
      if (url.pathname === "/api/admin/passwords" && request.method === "POST") {
        try {
          const auth = await authenticatePassword(request, env, null, "auth-api", ctx);
          if (!auth.authenticated || auth.role !== "admin") {
            return json({ error: "管理者権限が必要です" }, 403, request);
          }
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return parsed.response;
          const { name, password, maxStocks, maxIndices, role } = parsed.body;
          if (
            !name ||
            typeof name !== "string" ||
            name.trim().length === 0 ||
            name.trim().length > 100
          ) {
            return json({ error: "ユーザー名/ラベルは1〜100文字で入力してください" }, 400, request);
          }
          if (
            !password ||
            typeof password !== "string" ||
            password.trim().length < 8 ||
            password.trim().length > 100
          ) {
            return json({ error: "パスワードは8〜100文字で入力してください" }, 400, request);
          }
          let maxStockLimit: number | null = null;
          if (
            maxStocks !== undefined &&
            maxStocks !== null &&
            maxStocks !== "" &&
            maxStocks !== 0 &&
            maxStocks !== "0"
          ) {
            const num = Number(maxStocks);
            if (!Number.isFinite(num) || num < 1 || num > 500) {
              return json({ error: "銘柄数上限は1〜500の数値を指定してください" }, 400, request);
            }
            maxStockLimit = Math.floor(num);
          }
          let maxIndexLimit: number | null = null;
          if (
            maxIndices !== undefined &&
            maxIndices !== null &&
            maxIndices !== "" &&
            maxIndices !== 0 &&
            maxIndices !== "0"
          ) {
            const num = Number(maxIndices);
            if (!Number.isFinite(num) || num < 1 || num > 100) {
              return json({ error: "指数上限は1〜100の数値を指定してください" }, 400, request);
            }
            maxIndexLimit = Math.floor(num);
          }
          const assignedRole = role === "admin" ? "admin" : "user";
          const id = `pwd-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
          const initialPassword = password.trim();
          await ensurePasswordTable(env);
          const collision = await findPasswordCollision(env, initialPassword);
          const isTargetAdmin = assignedRole === "admin";
          if (collision.isAdminCollision || (isTargetAdmin && collision.hasCollision)) {
            const errorMsg = isTargetAdmin
              ? "既存のユーザーアカウントで使用されているパスワードは管理者に設定できません"
              : "管理者アカウントと同一のパスワードは設定できません";
            return json({ error: errorMsg }, 400, request);
          }
          const hash = await hashPassword(initialPassword);
          const now = Math.floor(Date.now() / 1000);

          try {
            await env.DB.prepare(
              "INSERT INTO access_passwords (id, name, password_hash, role, max_stocks, max_indices, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
            )
              .bind(id, name.trim(), hash, assignedRole, maxStockLimit, maxIndexLimit, now, now)
              .run();
          } catch (insertErr: unknown) {
            // Never silently discard a requested index quota on an unmigrated
            // database. An administrator must apply the migration first.
            if (maxIndexLimit !== null) {
              if (isMissingColumnError(insertErr, "max_indices")) {
                return json(
                  { error: "指数上限を保存するにはデータベースのマイグレーションが必要です" },
                  503,
                  request,
                );
              }
              throw insertErr;
            }
            // Unlimited accounts remain compatible with the pre-max_indices
            // schema, but unrelated insert failures must still surface.
            if (!isMissingColumnError(insertErr, "max_indices")) {
              throw insertErr;
            }
            await env.DB.prepare(
              "INSERT INTO access_passwords (id, name, password_hash, role, max_stocks, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
            )
              .bind(id, name.trim(), hash, assignedRole, maxStockLimit, now, now)
              .run();
          }
          clearAuthCache();

          return json(
            {
              ok: true,
              password: {
                id,
                name: name.trim(),
                // SECURITY: Do NOT include the plaintext password in the
                // response. The client already holds the value it generated
                // (or received from the operator) before sending it here.
                // Returning it would expose the secret in server access logs,
                // CDN/proxy caches, and browser devtools Network panels.
                role: assignedRole,
                max_stocks: maxStockLimit,
                max_indices: maxIndexLimit,
                is_active: 1,
                created_at: now,
              },
            },
            201,
            request,
          );
        } catch (err) {
          console.error("Failed to create password:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 管理者向け: ユーザーパスワード更新
      if (url.pathname === "/api/admin/passwords" && request.method === "PUT") {
        try {
          const auth = await authenticatePassword(request, env, null, "auth-api", ctx);
          if (!auth.authenticated || auth.role !== "admin") {
            return json({ error: "管理者権限が必要です" }, 403, request);
          }
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return parsed.response;
          const { id, name, password, maxStocks, maxIndices, isActive, role } = parsed.body;
          if (!id || typeof id !== "string") {
            return json({ error: "Invalid password id" }, 400, request);
          }
          if (id === "admin-master") {
            if (role === "user" || isActive === false) {
              return json(
                { error: "マスター管理者アカウントのロール変更および無効化はできません" },
                403,
                request,
              );
            }
            return json(
              {
                error:
                  "マスター管理者アカウントの変更は専用エンドポイント (/api/admin/admin-password) を使用してください",
              },
              403,
              request,
            );
          }

          await ensurePasswordTable(env);
          const updates: string[] = [];
          const params: unknown[] = [];
          let includesMaxIndicesUpdate = false;
          let maxIndicesRequiresMigration = false;

          if (typeof name === "string" && name.trim()) {
            // Reject overlong names symmetrically with the create endpoint
            // (which 400s above 100 chars) instead of silently truncating.
            if (name.trim().length > 100) {
              return json(
                { error: "ユーザー名/ラベルは1〜100文字で入力してください" },
                400,
                request,
              );
            }
            updates.push("name = ?");
            params.push(name.trim());
          }
          // Collision prevention when promoting to admin without a new password.
          // Stored hashes are salted PBKDF2, so two accounts sharing a password
          // never have equal hash strings; the previous hash-string comparisons
          // could not detect a collision for any account created through this
          // API (or upgraded on login). Since uniqueness cannot be verified
          // without the plaintext, a promotion must supply a new password so
          // findPasswordCollision() can enforce the invariant.
          if (
            role === "admin" &&
            (!password || typeof password !== "string" || password.trim().length === 0)
          ) {
            let existingRow: { role?: string; password_hash?: string } | undefined;
            try {
              const { results: existingRows } = await env.DB.prepare(
                "SELECT role, password_hash FROM access_passwords WHERE id = ?",
              )
                .bind(id)
                .all();
              existingRow = existingRows?.[0] as
                { role?: string; password_hash?: string } | undefined;
            } catch {
              // Fail closed: without the current role we cannot tell a promotion
              // (which must be guarded) from a rename of an existing admin.
              return json(
                { error: "アカウント情報を確認できないため、しばらくしてから再試行してください" },
                503,
                request,
              );
            }
            if (existingRow && existingRow.role !== "admin") {
              return json(
                {
                  error: "一般ユーザーから管理者へ昇格する場合は新しいパスワードを指定してください",
                },
                400,
                request,
              );
            }
          }

          if (typeof password === "string" && password.trim().length > 0) {
            if (password.trim().length < 8 || password.trim().length > 100) {
              return json({ error: "パスワードは8〜100文字で入力してください" }, 400, request);
            }
            const collision = await findPasswordCollision(env, password.trim(), id);
            let isTargetAdmin = role === "admin";
            if (role !== "admin" && role !== "user") {
              try {
                const { results: existingRows } = await env.DB.prepare(
                  "SELECT role FROM access_passwords WHERE id = ?",
                )
                  .bind(id)
                  .all();
                const existingRow = existingRows?.[0] as { role?: string } | undefined;
                if (existingRow?.role === "admin") {
                  isTargetAdmin = true;
                }
              } catch {
                // If query fails or column is missing, fall back to role value
              }
            }
            if (collision.isAdminCollision || (isTargetAdmin && collision.hasCollision)) {
              const errorMsg = isTargetAdmin
                ? "既存のユーザーアカウントで使用されているパスワードは管理者に設定できません"
                : "管理者アカウントと同一のパスワードは設定できません";
              return json({ error: errorMsg }, 400, request);
            }
            const hash = await hashPassword(password.trim());
            updates.push("password_hash = ?");
            params.push(hash);
          }
          if (maxStocks !== undefined) {
            if (maxStocks === null || maxStocks === 0 || maxStocks === "" || maxStocks === "0") {
              updates.push("max_stocks = NULL");
            } else {
              const num = Number(maxStocks);
              if (!Number.isFinite(num) || num < 1 || num > 500) {
                return json({ error: "銘柄数上限は1〜500の数値を指定してください" }, 400, request);
              }
              updates.push("max_stocks = ?");
              params.push(Math.floor(num));
            }
          }
          if (maxIndices !== undefined) {
            if (
              maxIndices === null ||
              maxIndices === 0 ||
              maxIndices === "" ||
              maxIndices === "0"
            ) {
              updates.push("max_indices = NULL");
            } else {
              const num = Number(maxIndices);
              if (!Number.isFinite(num) || num < 1 || num > 100) {
                return json({ error: "指数上限は1〜100の数値を指定してください" }, 400, request);
              }
              updates.push("max_indices = ?");
              params.push(Math.floor(num));
              maxIndicesRequiresMigration = true;
            }
            includesMaxIndicesUpdate = true;
          }
          if (role === "admin" || role === "user") {
            updates.push("role = ?");
            params.push(role);
          }
          if (isActive !== undefined) {
            const active =
              typeof isActive === "boolean"
                ? isActive
                : typeof isActive === "number"
                  ? isActive !== 0
                  : typeof isActive === "string"
                    ? isActive.trim().toLowerCase() !== "false" && isActive.trim() !== "0" && isActive.trim() !== ""
                    : Boolean(isActive);
            updates.push("is_active = ?");
            params.push(active ? 1 : 0);
          }

          if (updates.length === 0) {
            return json({ error: "更新する項目が指定されていません" }, 400, request);
          }

          const now = Math.floor(Date.now() / 1000);
          updates.push("updated_at = ?");
          params.push(now);

          params.push(id);
          const updateQuery = `UPDATE access_passwords SET ${updates.join(", ")} WHERE id = ?`;
          let updatedChanges: number | undefined;
          try {
            const updateResult = await env.DB.prepare(updateQuery)
              .bind(...params)
              .run();
            updatedChanges = (updateResult as { meta?: { changes?: number } }).meta?.changes;
          } catch (updateErr: unknown) {
            if (!includesMaxIndicesUpdate || !isMissingColumnError(updateErr, "max_indices")) {
              throw updateErr;
            }
            // A legacy database can still update all pre-migration fields. A
            // finite index quota cannot be represented safely without the
            // column, so fail explicitly rather than acknowledging a partial
            // update. Clearing an unlimited quota is already the legacy
            // default and can be treated as a no-op for that field.
            if (maxIndicesRequiresMigration) {
              return json(
                { error: "指数上限を保存するにはデータベースのマイグレーションが必要です" },
                503,
                request,
              );
            }
            const legacyUpdates = updates.filter((update) => update !== "max_indices = NULL");
            const legacyQuery = `UPDATE access_passwords SET ${legacyUpdates.join(", ")} WHERE id = ?`;
            const legacyResult = await env.DB.prepare(legacyQuery)
              .bind(...params)
              .run();
            updatedChanges = (legacyResult as { meta?: { changes?: number } }).meta?.changes;
          }
          if (updatedChanges === 0) {
            // The UPDATE matched no row: report the missing account instead of
            // returning success for a no-op (the admin UI closed the modal and
            // toasted success even though nothing changed).
            return json({ error: "指定されたIDのアカウントが見つかりません" }, 404, request);
          }
          clearAuthCache();

          return json({ ok: true }, 200, request);
        } catch (err) {
          console.error("Failed to update password:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 管理者向け: ユーザーパスワード削除
      if (url.pathname === "/api/admin/passwords" && request.method === "DELETE") {
        try {
          const auth = await authenticatePassword(request, env, null, "auth-api", ctx);
          if (!auth.authenticated || auth.role !== "admin") {
            return json({ error: "管理者権限が必要です" }, 403, request);
          }
          const id = url.searchParams.get("id");
          if (!id) {
            return json({ error: "Missing password id" }, 400, request);
          }
          if (id === "admin-master") {
            return json({ error: "マスター管理者パスワードは削除できません" }, 403, request);
          }
          await ensurePasswordTable(env);
          let deleteChanges: number | undefined;
          try {
            const batchResults = await env.DB.batch([
              env.DB.prepare("UPDATE indices SET creator_id = NULL WHERE creator_id = ?").bind(id),
              env.DB.prepare("DELETE FROM access_passwords WHERE id = ?").bind(id),
            ]);
            deleteChanges = (
              batchResults as Array<{ meta?: { changes?: number } }> | undefined
            )?.[1]?.meta?.changes;
          } catch (deleteBatchErr: unknown) {
            if (!isMissingColumnError(deleteBatchErr, "creator_id")) throw deleteBatchErr;
            const legacyDelete = await env.DB.prepare("DELETE FROM access_passwords WHERE id = ?")
              .bind(id)
              .run();
            deleteChanges = (legacyDelete as { meta?: { changes?: number } }).meta?.changes;
          }
          if (deleteChanges === 0) {
            return json({ error: "指定されたIDのアカウントが見つかりません" }, 404, request);
          }
          clearAuthCache();
          return json({ ok: true }, 200, request);
        } catch (err) {
          console.error("Failed to delete password:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 管理者向け: 管理者マスターパスワード変更 (平文保存は行わない)
      if (url.pathname === "/api/admin/admin-password" && request.method === "PUT") {
        try {
          const auth = await authenticatePassword(request, env, null, "auth-api", ctx);
          if (!auth.authenticated || auth.role !== "admin" || auth.id !== "admin-master") {
            return json({ error: "管理者権限が必要です" }, 403, request);
          }
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return parsed.response;
          const newPassword =
            typeof parsed.body.newPassword === "string" ? parsed.body.newPassword.trim() : "";
          if (newPassword.length < 8 || newPassword.length > 100) {
            return json({ error: "管理者パスワードは8〜100文字で入力してください" }, 400, request);
          }
          const currentPassword =
            typeof parsed.body.currentPassword === "string" ? parsed.body.currentPassword.trim() : "";
          if (currentPassword) {
            const currentAuth = await authenticatePassword(request, env, currentPassword, "auth-api", ctx);
            if (!currentAuth.authenticated || currentAuth.id !== "admin-master") {
              return json({ error: "現在の管理者パスワードが正しくありません" }, 401, request);
            }
          }
          await ensurePasswordTable(env);
          const collision = await findPasswordCollision(env, newPassword, "admin-master");
          if (collision.hasCollision) {
            return json(
              {
                error: "既存のユーザーアカウントで使用されているパスワードは管理者に設定できません",
              },
              400,
              request,
            );
          }
          const hash = await hashPassword(newPassword);
          const now = Math.floor(Date.now() / 1000);
          await env.DB.prepare(
            "INSERT INTO access_passwords (id, name, password_hash, role, max_stocks, is_active, created_at, updated_at) VALUES ('admin-master', 'マスター管理者', ?, 'admin', NULL, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin', max_stocks = NULL, is_active = 1, updated_at = excluded.updated_at",
          )
            .bind(hash, now, now)
            .run();
          clearAuthCache();

          return json({ ok: true, message: "管理者パスワードを更新しました" }, 200, request);
        } catch (err) {
          console.error("Failed to update admin password:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 管理者向け: 秘密の暗号変更 (平文保存は行わずハッシュ保存)
      if (
        url.pathname === "/api/admin/admin-secret-code" &&
        (request.method === "PUT" || request.method === "POST")
      ) {
        try {
          const auth = await authenticatePassword(request, env, null, "auth-api", ctx);
          if (!auth.authenticated || auth.role !== "admin" || auth.id !== "admin-master") {
            return json({ error: "管理者権限が必要です" }, 403, request);
          }
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return parsed.response;
          const newSecretCode =
            typeof parsed.body.newSecretCode === "string" ? parsed.body.newSecretCode.normalize("NFC").trim() : "";
          if (newSecretCode.length < 6 || newSecretCode.length > 100) {
            return json({ error: "秘密の暗号は6〜100文字で入力してください" }, 400, request);
          }
          const currentSecretCode =
            typeof parsed.body.currentSecretCode === "string" ? parsed.body.currentSecretCode.normalize("NFC").trim() : "";
          if (!currentSecretCode) {
            return json({ error: "現在の秘密の暗号を入力してください" }, 400, request);
          }
          const isCurrentValid = await verifyAdminSecretCode(
            env,
            currentSecretCode,
            isLocalOrTestHost(url.hostname),
          );
          if (!isCurrentValid) {
            return json({ error: "現在の秘密の暗号が正しくありません" }, 401, request);
          }
          await ensurePasswordTable(env);
          const hash = await hashPassword(newSecretCode);
          const now = Math.floor(Date.now() / 1000);

          const { results: existingRows } = await env.DB.prepare(
            "SELECT id FROM access_passwords WHERE id = 'admin-master'",
          ).all();
          if (!existingRows || existingRows.length === 0) {
            const masterPwd =
              env.ADMIN_PASSWORD?.trim() ||
              request.headers.get("x-auth-password")?.trim() ||
              request.headers.get("x-admin-key")?.trim() ||
              "";
            if (!masterPwd) {
              return json({ error: "管理者マスターパスワードが設定されていません" }, 500, request);
            }
            const masterPwdHash = await hashPassword(masterPwd);
            await env.DB.prepare(
              "INSERT INTO access_passwords (id, name, password_hash, secret_code_hash, role, max_stocks, is_active, created_at, updated_at) VALUES ('admin-master', 'マスター管理者', ?, ?, 'admin', NULL, 1, ?, ?)",
            )
              .bind(masterPwdHash, hash, now, now)
              .run();
          } else {
            await env.DB.prepare(
              "UPDATE access_passwords SET secret_code_hash = ?, updated_at = ? WHERE id = 'admin-master'",
            )
              .bind(hash, now)
              .run();
          }

          return json({ ok: true, message: "秘密の暗号を更新しました" }, 200, request);
        } catch (err) {
          console.error("Failed to update admin secret code:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 管理者向け: システム運用・健全性メトリクス取得
      if (url.pathname === "/api/admin/system-stats" && request.method === "GET") {
        try {
          const auth = await authenticatePassword(request, env, null, "auth-api", ctx);
          if (!auth.authenticated || auth.role !== "admin") {
            return json({ error: "管理者権限が必要です" }, 403, request);
          }
          await ensurePasswordTable(env);

          let totalUsers = 0;
          let activeUsers = 0;
          let adminUsers = 0;
          try {
            const pwdRows = await env.DB.prepare(
              "SELECT role, is_active, COUNT(*) as count FROM access_passwords GROUP BY role, is_active",
            ).all();
            for (const r of pwdRows.results || []) {
              const row = r as { role?: string; is_active?: number; count?: number };
              const c = Number(row.count) || 0;
              totalUsers += c;
              if (row.is_active === 1) activeUsers += c;
              if (row.role === "admin") adminUsers += c;
            }
          } catch {
            // fallback
          }

          let indicesCount = 0;
          let totalConstituents = 0;
          try {
            const idxRes = await env.DB.prepare("SELECT COUNT(*) as count FROM indices").first<{ count: number }>();
            indicesCount = idxRes?.count ?? 0;
            const bktRes = await env.DB.prepare("SELECT COUNT(*) as count FROM basket_items").first<{ count: number }>();
            totalConstituents = bktRes?.count ?? 0;
          } catch {
            // fallback
          }

          let rateLimitEntries = 0;
          try {
            const rlRes = await env.DB.prepare("SELECT COUNT(*) as count FROM rate_limits").first<{ count: number }>();
            rateLimitEntries = rlRes?.count ?? 0;
          } catch {
            // fallback
          }

          const avgConstituentsPerIndex =
            indicesCount > 0 ? Number((totalConstituents / indicesCount).toFixed(1)) : 0;
          const totalCacheRequests = cacheHits + cacheMisses;
          const hitRatio =
            totalCacheRequests > 0
              ? `${((cacheHits / totalCacheRequests) * 100).toFixed(1)}%`
              : "N/A";

          const stats = {
            dbStatus: "CONNECTED",
            indicesCount,
            totalConstituents,
            avgConstituentsPerIndex,
            userPasswordsCount: totalUsers,
            activeUsersCount: activeUsers,
            adminUsersCount: Math.max(1, adminUsers),
            cacheStats: {
              hits: cacheHits,
              misses: cacheMisses,
              hitRatio,
              memoryCacheSize: memoryCache.size,
              memoryRateLimitsSize: memoryRateLimits.size,
              persistentRateLimitEntries: rateLimitEntries,
            },
            serverTime: new Date().toISOString(),
            version: "2.4.0-enterprise",
          };

          return json({ ok: true, stats, ...stats }, 200, request, {
            "cache-control": "no-store, private",
          });
        } catch (err) {
          console.error("Failed to fetch system stats:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 構成銘柄の個別追加 (パスワード認証＋上限数チェック)
      if (url.pathname === "/api/indices/stock" && request.method === "POST") {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(
            env,
            ip,
            "indices-stock",
            RATE_LIMIT_MAX,
            false,
            ctx,
          );
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return parsed.response;
          const { indexId, stock, password } = parsed.body;
          if (
            !indexId ||
            typeof indexId !== "string" ||
            indexId.trim().length === 0 ||
            indexId.trim().length > 100 ||
            !/^[A-Za-z0-9._-]+$/.test(indexId.trim())
          ) {
            return json(
              { error: "indexId is required (1-100 alphanumeric, dot, hyphen, underscore)" },
              400,
              request,
            );
          }
          const cleanIndexId = indexId.trim();

          // 認証チェック
          const auth = await authenticatePassword(
            request,
            env,
            typeof password === "string" ? password : null,
            "auth-api",
            ctx,
          );
          if (!auth.authenticated) {
            return json({ error: "この操作にはパスワード認証が必要です" }, 401, request);
          }

          if (SYSTEM_INDICES.has(cleanIndexId) && auth.role !== "admin") {
            return json({ error: "システム指数の銘柄変更には管理者権限が必要です" }, 403, request);
          }

          if (!stock || typeof stock !== "object") {
            return json({ error: "銘柄情報 (stock) は必須です" }, 400, request);
          }
          const rawStock = stock as Record<string, unknown>;
          const ownerTokenCandidates = [
            request.headers.get("x-owner-token"),
            typeof rawStock.ownerToken === "string" ? rawStock.ownerToken : null,
            typeof parsed.body.ownerToken === "string" ? parsed.body.ownerToken : null,
          ];
          if (ownerTokenCandidates.some((token) => token !== null && token.trim().length > 256)) {
            return json({ error: "作成者トークンは256文字以内で指定してください" }, 400, request);
          }
          const ticker =
            typeof rawStock.ticker === "string" ? rawStock.ticker.trim().toUpperCase() : "";
          const name = typeof rawStock.name === "string" ? rawStock.name.trim() : "";
          const theme = typeof rawStock.theme === "string" ? rawStock.theme.trim() : "カスタム";
          const rawWeight =
            rawStock.weight === undefined || rawStock.weight === null || rawStock.weight === ""
              ? 10
              : Number(rawStock.weight);
          if (!Number.isFinite(rawWeight) || rawWeight <= 0 || rawWeight > 100) {
            return json(
              { error: "銘柄の構成比率 (weight) は0超100以下の数値を指定してください" },
              400,
              request,
            );
          }
          const weight = rawWeight;

          if (!ticker || !/^[A-Za-z0-9.-]+$/.test(ticker) || ticker.length > 20) {
            return json({ error: "無効な銘柄コードです" }, 400, request);
          }
          if (!name || name.length > 100) {
            return json({ error: "銘柄名は1〜100文字で入力してください" }, 400, request);
          }
          if (theme.length > 100) {
            return json({ error: "テーマは100文字以内で入力してください" }, 400, request);
          }

          // 現在の銘柄数チェック
          const { results: existingStocks } = await env.DB.prepare(
            "SELECT ticker FROM basket_items WHERE index_id = ?",
          )
            .bind(cleanIndexId)
            .all();

          // 所有権チェック（非管理者の場合）
          let existingHash: string | null = null;
          let existingCreatorId: string | null = null;
          let hasCheckedIndex = false;
          try {
            const { results } = await env.DB.prepare(
              "SELECT id, owner_token_hash, creator_id FROM indices WHERE id = ?",
            )
              .bind(cleanIndexId)
              .all();
            if (results && results.length > 0) {
              hasCheckedIndex = true;
              const index = results[0] as { owner_token_hash?: string; creator_id?: string | null };
              existingHash = index.owner_token_hash || null;
              existingCreatorId =
                typeof index.creator_id === "string" && index.creator_id.length > 0
                  ? index.creator_id
                  : null;
            }
          } catch (lookupErr: unknown) {
            if (
              !isMissingColumnError(lookupErr, "creator_id") &&
              !isMissingColumnError(lookupErr, "owner_token_hash")
            ) {
              throw lookupErr;
            }
            try {
              const { results } = await env.DB.prepare(
                "SELECT id, owner_token_hash FROM indices WHERE id = ?",
              )
                .bind(cleanIndexId)
                .all();
              if (results && results.length > 0) {
                hasCheckedIndex = true;
                existingHash =
                  (results[0] as { owner_token_hash?: string }).owner_token_hash || null;
              }
            } catch (lookupErr2: unknown) {
              if (!isMissingColumnError(lookupErr2, "owner_token_hash")) throw lookupErr2;
              const { results } = await env.DB.prepare("SELECT id FROM indices WHERE id = ?")
                .bind(cleanIndexId)
                .all();
              if (results && results.length > 0) hasCheckedIndex = true;
            }
          }

          if (!hasCheckedIndex) {
            return json({ error: "Index not found" }, 404, request);
          }

          if (auth.role !== "admin") {
            if (existingHash) {
              const providedToken =
                request.headers.get("x-owner-token")?.trim() ||
                (typeof rawStock.ownerToken === "string" ? rawStock.ownerToken.trim() : "") ||
                (typeof parsed.body.ownerToken === "string" ? parsed.body.ownerToken.trim() : "");

              if (!providedToken) {
                return json(
                  { error: "この指数を更新する権限がありません（作成者トークンが必要です）" },
                  403,
                  request,
                );
              }
              const providedHash = await hashToken(providedToken);
              if (!timingSafeEqual(providedHash, existingHash)) {
                return json(
                  { error: "この指数を更新する権限がありません（作成者トークンが一致しません）" },
                  403,
                  request,
                );
              }
            } else {
              return json(
                { error: "この指数は保護されているため更新できません（管理者権限が必要です）" },
                403,
                request,
              );
            }
          }

          const existingTicker = ((existingStocks as { ticker?: unknown }[]) || []).find(
            (s) => typeof s.ticker === "string" && s.ticker.trim().toUpperCase() === ticker,
          )?.ticker;
          const isAlreadyPresent = typeof existingTicker === "string";
          const currentCount = existingStocks?.length ?? 0;
          let insertionLimit = MAX_BASKET_ITEMS;

          if (!isAlreadyPresent) {
            if (currentCount >= MAX_BASKET_ITEMS) {
              return json(
                { error: `この指数には最大${MAX_BASKET_ITEMS}銘柄までしか追加できません` },
                400,
                request,
              );
            }
            // Owner tokens authorize a particular index, not a larger
            // account quota. Preserve the quota attached to the index's
            // original creator even when the caller authenticates through a
            // different non-admin account.
            if (
              auth.role !== "admin" &&
              existingCreatorId &&
              existingCreatorId !== "admin-master"
            ) {
              try {
                const creatorRow =
                  auth.id === existingCreatorId
                    ? { max_stocks: auth.maxStocks }
                    : ((
                        await env.DB.prepare("SELECT max_stocks FROM access_passwords WHERE id = ?")
                          .bind(existingCreatorId)
                          .all()
                      ).results?.[0] as { max_stocks?: unknown } | undefined);
                if (!creatorRow) {
                  return json(
                    { error: "作成者の銘柄数上限を確認できないため、後で再試行してください" },
                    503,
                    request,
                  );
                }
                const rawCreatorMaxStocks = creatorRow.max_stocks;
                if (rawCreatorMaxStocks !== null && rawCreatorMaxStocks !== undefined) {
                  const creatorMaxStocks = Number(rawCreatorMaxStocks);
                  if (
                    !Number.isSafeInteger(creatorMaxStocks) ||
                    creatorMaxStocks < 1 ||
                    creatorMaxStocks > MAX_BASKET_ITEMS
                  ) {
                    return json(
                      { error: "作成者の銘柄数上限を確認できないため、後で再試行してください" },
                      503,
                      request,
                    );
                  }
                  if (currentCount >= creatorMaxStocks) {
                    return json(
                      {
                        error: `この指数は作成者の設定により最大${creatorMaxStocks}銘柄までに制限されています（現在${currentCount}銘柄）`,
                      },
                      403,
                      request,
                    );
                  }
                  insertionLimit = Math.min(insertionLimit, creatorMaxStocks);
                }
              } catch (quotaLookupErr) {
                console.error("Failed to check index creator stock quota:", quotaLookupErr);
                return json(
                  { error: "作成者の銘柄数上限を確認できないため、後で再試行してください" },
                  503,
                  request,
                );
              }
            }
            // 新規追加の場合、ユーザー権限なら上限銘柄数をチェック
            if (auth.role === "user" && auth.maxStocks && auth.maxStocks > 0) {
              if (currentCount >= auth.maxStocks) {
                return json(
                  {
                    error: `このユーザー用パスワードでは銘柄数を最大${auth.maxStocks}銘柄までに制限されています（現在${currentCount}銘柄）`,
                  },
                  403,
                  request,
                );
              }
              insertionLimit = Math.min(insertionLimit, auth.maxStocks);
            }
          }

          const saveStockStmt = env.DB.prepare(
            "INSERT OR REPLACE INTO basket_items (index_id, ticker, name, weight, theme) VALUES (?, ?, ?, ?, ?)",
          ).bind(cleanIndexId, ticker, name, weight, theme);
          if (typeof existingTicker === "string" && existingTicker.trim() !== ticker) {
            // Normalize legacy lower-case tickers before writing. SQLite's
            // UNIQUE constraint is case-sensitive, so a plain INSERT OR
            // REPLACE would otherwise create a duplicate logical constituent.
            await env.DB.batch([
              env.DB.prepare(
                "DELETE FROM basket_items WHERE index_id = ? AND UPPER(ticker) = ?",
              ).bind(cleanIndexId, ticker),
              saveStockStmt,
            ]);
          } else if (!isAlreadyPresent) {
            // The earlier count checks produce clear validation errors for a
            // normal request, but are not sufficient under concurrent writes:
            // two requests can both observe the final free slot. Reserve the
            // slot in the INSERT itself so D1 serializes the quota decision.
            // An exact ticker match remains writable at the limit, making two
            // concurrent edits of the same constituent idempotent.
            const insertResult = await env.DB.prepare(
              `INSERT OR REPLACE INTO basket_items (index_id, ticker, name, weight, theme)
               SELECT ?, ?, ?, ?, ?
               WHERE EXISTS (SELECT 1 FROM basket_items WHERE index_id = ? AND ticker = ?)
                  OR (
                    NOT EXISTS (SELECT 1 FROM basket_items WHERE index_id = ? AND UPPER(ticker) = ?)
                    AND (SELECT COUNT(*) FROM basket_items WHERE index_id = ?) < ?
                  )`,
            )
              .bind(
                cleanIndexId,
                ticker,
                name,
                weight,
                theme,
                cleanIndexId,
                ticker,
                cleanIndexId,
                ticker,
                cleanIndexId,
                insertionLimit,
              )
              .run();
            const changes = (insertResult as { meta?: { changes?: number } }).meta?.changes;
            if (changes === 0) {
              return json(
                {
                  error:
                    "同時更新により銘柄数上限に達しました。最新の構成を確認してから再試行してください",
                },
                409,
                request,
              );
            }
          } else {
            await saveStockStmt.run();
          }

          clearMemoryCache("api:indices");
          clearMemoryCache("calc:");
          return json({ ok: true, message: "銘柄を追加・更新しました", ticker }, 200, request);
        } catch (err) {
          console.error("Failed to add stock:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 構成銘柄の個別削除 (パスワード認証)
      if (url.pathname === "/api/indices/stock" && request.method === "DELETE") {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(
            env,
            ip,
            "indices-stock",
            RATE_LIMIT_MAX,
            false,
            ctx,
          );
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const rawIndexId = url.searchParams.get("indexId");
          const rawTicker = url.searchParams.get("ticker");
          if (
            !rawIndexId ||
            rawIndexId.trim().length === 0 ||
            rawIndexId.trim().length > 100 ||
            !/^[A-Za-z0-9._-]+$/.test(rawIndexId.trim()) ||
            !rawTicker ||
            rawTicker.trim().length === 0 ||
            rawTicker.trim().length > 20 ||
            !/^[A-Za-z0-9.-]+$/.test(rawTicker.trim())
          ) {
            return json(
              { error: "Valid indexId and ticker parameters are required" },
              400,
              request,
            );
          }
          const indexId = rawIndexId.trim();
          const ticker = rawTicker.trim().toUpperCase();
          const providedToken =
            url.searchParams.get("ownerToken")?.trim() ||
            request.headers.get("x-owner-token")?.trim() ||
            "";
          if (providedToken.length > 256) {
            return json({ error: "作成者トークンは256文字以内で指定してください" }, 400, request);
          }

          const auth = await authenticatePassword(request, env, null, "auth-api", ctx);
          if (!auth.authenticated) {
            return json({ error: "この操作にはパスワード認証が必要です" }, 401, request);
          }

          if (SYSTEM_INDICES.has(indexId) && auth.role !== "admin") {
            return json({ error: "システム指数の銘柄削除には管理者権限が必要です" }, 403, request);
          }

          // 所有権チェック（非管理者の場合）
          let existingHash: string | null = null;
          let hasCheckedIndex = false;
          try {
            const { results } = await env.DB.prepare(
              "SELECT id, owner_token_hash FROM indices WHERE id = ?",
            )
              .bind(indexId)
              .all();
            if (results && results.length > 0) {
              hasCheckedIndex = true;
              existingHash = (results[0] as { owner_token_hash?: string }).owner_token_hash || null;
            }
          } catch (lookupErr: unknown) {
            if (!isMissingColumnError(lookupErr, "owner_token_hash")) throw lookupErr;
            const { results } = await env.DB.prepare("SELECT id FROM indices WHERE id = ?")
              .bind(indexId)
              .all();
            if (results && results.length > 0) hasCheckedIndex = true;
          }

          if (!hasCheckedIndex) {
            return json({ error: "Index not found" }, 404, request);
          }

          if (auth.role !== "admin") {
            if (existingHash) {
              if (!providedToken) {
                return json(
                  {
                    error: "この指数から銘柄を削除する権限がありません（作成者トークンが必要です）",
                  },
                  403,
                  request,
                );
              }
              const providedHash = await hashToken(providedToken);
              if (!timingSafeEqual(providedHash, existingHash)) {
                return json(
                  {
                    error:
                      "この指数から銘柄を削除する権限がありません（作成者トークンが一致しません）",
                  },
                  403,
                  request,
                );
              }
            } else {
              return json(
                {
                  error: "この指数は保護されているため銘柄を削除できません（管理者権限が必要です）",
                },
                403,
                request,
              );
            }
          }

          // Keep the minimum-one-constituent invariant in the DELETE itself.
          // A separate COUNT followed by DELETE allows two concurrent requests
          // to both observe two constituents and remove both rows. The scalar
          // subquery is evaluated as part of the same SQLite statement, so D1
          // serializes the check and the deletion. Select one physical row so
          // legacy case-variant duplicates cannot all be removed at once.
          const deleteResult = await env.DB.prepare(
            `DELETE FROM basket_items
             WHERE rowid = (
               SELECT rowid FROM basket_items
               WHERE index_id = ? AND UPPER(ticker) = ?
               ORDER BY rowid
               LIMIT 1
             )
             AND (SELECT COUNT(*) FROM basket_items WHERE index_id = ?) > 1`,
          )
            .bind(indexId, ticker, indexId)
            .run();
          const deletedChanges = (deleteResult as { meta?: { changes?: number } }).meta?.changes;
          if (deletedChanges === 0) {
            // Distinguish a missing ticker from the minimum-one-constituent
            // invariant. Checking the invariant first misreported "the index
            // must keep one constituent" when the ticker was simply absent on
            // a single-constituent index.
            const { results: targetRes } = await env.DB.prepare(
              "SELECT COUNT(*) as cnt FROM basket_items WHERE index_id = ? AND UPPER(ticker) = ?",
            )
              .bind(indexId, ticker)
              .all();
            const targetCount = Number((targetRes?.[0] as { cnt?: unknown } | undefined)?.cnt);
            if (!Number.isFinite(targetCount) || targetCount <= 0) {
              return json({ error: "指定された銘柄が見つかりません" }, 404, request);
            }
            // The ticker exists and the guarded DELETE still matched nothing:
            // the atomic guard blocked removing the final constituent.
            return json(
              { error: "構成銘柄が1件のみのため削除できません(指数には最低1銘柄必要です)" },
              400,
              request,
            );
          }

          clearMemoryCache("api:indices");
          clearMemoryCache("calc:");
          return json({ ok: true, message: "銘柄を削除しました", ticker }, 200, request);
        } catch (err) {
          console.error("Failed to delete stock:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // ベンチマーク・スナップショットの取得（D1キャッシュ付き・複数ベンチマーク対応・インメモリ&エッジキャッシュ）
      if (url.pathname === "/api/snapshot" && request.method === "GET") {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(env, ip, "snapshot", RATE_LIMIT_MAX, false, ctx);
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const now = Math.floor(Date.now() / 1000);
          const SNAPSHOT_CACHE_TTL = 5 * 60; // 5 minutes
          const rawSymbol = url.searchParams.get("symbol") || "^N225";
          const symbol = rawSymbol.trim();

          if (symbol.length === 0 || symbol.length > 20 || !/^[A-Za-z0-9.^=_-]+$/.test(symbol)) {
            return json({ error: "Invalid symbol parameter" }, 400, request);
          }
          if (!Object.prototype.hasOwnProperty.call(BENCHMARK_MAP, symbol)) {
            return json({ error: "Unsupported symbol parameter" }, 400, request);
          }

          const memKey = `snapshot:${symbol}`;
          const memCachedEntry = getMemoryCacheEntry<unknown>(memKey);
          if (memCachedEntry) {
            const memCached = memCachedEntry.data;
            const remainingTtl = Math.max(10, memCachedEntry.remainingSeconds);
            const cacheControl = `public, max-age=${Math.min(60, remainingTtl)}, s-maxage=${Math.min(remainingTtl, 1800)}, stale-while-revalidate=600, stale-if-error=86400`;
            const etag = await generateETag(JSON.stringify(memCached));
            if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
              return notModified(request, {
                etag: etag,
                "cache-control": cacheControl,
              });
            }
            return json(memCached, 200, request, {
              etag: etag,
              "cache-control": cacheControl,
            });
          }

          const benchInfo = BENCHMARK_MAP[symbol];

          // For ^N225, check snapshot_cache (id = 1) for backward compatibility
          let cacheRow: { data: string; cached_at: number } | undefined;
          if (symbol === "^N225") {
            try {
              const { results: cached } = await env.DB.prepare(
                "SELECT data, cached_at FROM snapshot_cache WHERE id = 1",
              ).all();
              cacheRow = (cached as { data: string; cached_at: number }[])[0];
            } catch (cacheErr: unknown) {
              if (!isMissingTableError(cacheErr, "snapshot_cache")) throw cacheErr;
              // snapshot_cache table might not exist yet on an unmigrated
              // database; proceed to a fresh fetch instead of failing the
              // default benchmark request.
            }
          } else {
            try {
              const { results: cached } = await env.DB.prepare(
                "SELECT data, cached_at FROM benchmark_cache WHERE symbol = ?",
              )
                .bind(symbol)
                .all();
              cacheRow = (cached as { data: string; cached_at: number }[])[0];
            } catch (cacheErr: unknown) {
              if (!isMissingTableError(cacheErr, "benchmark_cache")) throw cacheErr;
              // benchmark_cache table might not exist yet
            }
          }

          const snapshotTtl =
            symbol === "^N225" && cacheRow
              ? getMarketAwareCacheDuration(new Date(cacheRow.cached_at * 1000))
              : SNAPSHOT_CACHE_TTL;

          if (cacheRow && now - cacheRow.cached_at < snapshotTtl) {
            try {
              const parsedData = parseSnapshotResponseData(
                JSON.parse(cacheRow.data),
                symbol,
                benchInfo,
              );
              if (!parsedData) throw new Error("Invalid snapshot cache payload");
              const remainingTtl = Math.max(10, snapshotTtl - (now - cacheRow.cached_at));
              const memTtl = Math.max(10, Math.min(remainingTtl, 300));
              setMemoryCache(memKey, parsedData, memTtl);
              const etag = await generateETag(JSON.stringify(parsedData));
              if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
                return notModified(request, {
                  etag: etag,
                  "cache-control": `public, max-age=${Math.min(60, remainingTtl)}, s-maxage=${Math.min(remainingTtl, 1800)}, stale-while-revalidate=600, stale-if-error=86400`,
                });
              }
              return json(parsedData, 200, request, {
                etag: etag,
                "cache-control": `public, max-age=${Math.min(60, remainingTtl)}, s-maxage=${Math.min(remainingTtl, 1800)}, stale-while-revalidate=600, stale-if-error=86400`,
              });
            } catch {
              // Malformed cache, proceed to fresh fetch
            }
          }

          // Cache miss or stale — fetch from Yahoo Finance
          const querySym =
            BASELINE_ASSET_QUOTES.find((a) => a.symbol === symbol)?.querySymbol ?? symbol;
          const series = await fetchYahooFinance(querySym, "1y");
          const latest = series[series.length - 1];
          const prev = series[series.length - 2];

          if (!latest) {
            // If fresh fetch fails but stale cache exists, fallback to stale cache
            if (cacheRow) {
              try {
                console.warn(
                  `Using stale snapshot cache for ${symbol} due to Yahoo Finance failure`,
                );
                const staleData = parseSnapshotResponseData(
                  JSON.parse(cacheRow.data),
                  symbol,
                  benchInfo,
                );
                if (!staleData) throw new Error("Invalid snapshot cache payload");
                return json({ ...staleData, stale: true }, 200, request, {
                  "x-data-stale": "true",
                  "cache-control":
                    "public, max-age=30, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400",
                });
              } catch {
                // Corrupted cache, must return 502 error to protect against exposing malformed state
                return json(
                  { error: `No data available from Yahoo Finance for ${symbol}` },
                  502,
                  request,
                );
              }
            }
            // Graceful degradation when both fresh fetch and D1 cache are unavailable
            const baselineAsset = BASELINE_ASSET_QUOTES.find((a) => a.symbol === symbol);
            if (baselineAsset || benchInfo) {
              const currentPrice = baselineAsset ? baselineAsset.baselinePrice : 1000;
              const changeVal = baselineAsset ? baselineAsset.baselineChange : 0;
              const changePctVal = baselineAsset ? baselineAsset.baselineChangePercent : 0;
              const todayStr = new Date().toISOString().slice(0, 10);
              const baselineData: SnapshotResponseData = {
                snapshot: {
                  symbol,
                  label: benchInfo?.label || baselineAsset?.name || symbol,
                  current: currentPrice,
                  change: changeVal,
                  changePct: changePctVal,
                  updatedAt: new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
                  description: benchInfo?.desc || baselineAsset?.name || "基準参考値",
                },
                series: [{ date: todayStr, close: currentPrice }],
              };
              return json({ ...baselineData, stale: true }, 200, request, {
                "x-data-stale": "true",
                "cache-control":
                  "public, max-age=30, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400",
              });
            }
            return json(
              { error: `No data available from Yahoo Finance for ${symbol}` },
              502,
              request,
            );
          }

          const snapshot = {
            symbol,
            label: benchInfo.label,
            current: latest.close,
            change: prev ? Number((latest.close - prev.close).toFixed(2)) : 0,
            changePct: prev ? Number(((latest.close / prev.close - 1) * 100).toFixed(2)) : 0,
            updatedAt: new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
            description: benchInfo.desc,
          };

          const responseData = { snapshot, series };

          // Save to cache
          if (symbol === "^N225") {
            try {
              await env.DB.prepare(
                "INSERT OR REPLACE INTO snapshot_cache (id, data, cached_at) VALUES (1, ?, ?)",
              )
                .bind(JSON.stringify(responseData), now)
                .run();
            } catch (cacheErr: unknown) {
              if (isMissingTableError(cacheErr, "snapshot_cache")) {
                try {
                  await env.DB.prepare(
                    `
                  CREATE TABLE IF NOT EXISTS snapshot_cache (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    data TEXT NOT NULL,
                    cached_at INTEGER NOT NULL
                  )
                `,
                  ).run();
                  await env.DB.prepare(
                    "INSERT OR REPLACE INTO snapshot_cache (id, data, cached_at) VALUES (1, ?, ?)",
                  )
                    .bind(JSON.stringify(responseData), now)
                    .run();
                } catch (createErr) {
                  console.error("Failed to auto-create snapshot_cache table:", createErr);
                }
              } else {
                // Fresh Yahoo data remains useful even if the optional cache
                // write is unavailable (for example during a D1 incident).
                console.error("Failed to persist snapshot cache:", cacheErr);
              }
            }
          } else {
            try {
              await env.DB.prepare(
                "INSERT OR REPLACE INTO benchmark_cache (symbol, data, cached_at) VALUES (?, ?, ?)",
              )
                .bind(symbol, JSON.stringify(responseData), now)
                .run();
            } catch (cacheErr: unknown) {
              if (isMissingTableError(cacheErr, "benchmark_cache")) {
                try {
                  await env.DB.prepare(
                    `
                  CREATE TABLE IF NOT EXISTS benchmark_cache (
                    symbol TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    cached_at INTEGER NOT NULL
                  )
                `,
                  ).run();
                  await env.DB.prepare(
                    "INSERT OR REPLACE INTO benchmark_cache (symbol, data, cached_at) VALUES (?, ?, ?)",
                  )
                    .bind(symbol, JSON.stringify(responseData), now)
                    .run();
                } catch (createErr) {
                  console.error("Failed to auto-create benchmark_cache table:", createErr);
                }
              } else {
                console.error("Failed to persist benchmark cache:", cacheErr);
              }
            }
          }

          const freshMemTtl =
            symbol === "^N225" ? Math.max(60, Math.min(getMarketAwareCacheDuration(), 300)) : 60;
          const freshSMaxAge =
            symbol === "^N225" ? Math.max(300, Math.min(getMarketAwareCacheDuration(), 1800)) : 300;
          setMemoryCache(memKey, responseData, freshMemTtl);
          const freshEtag = await generateETag(JSON.stringify(responseData));
          if (matchesIfNoneMatch(request.headers.get("if-none-match"), freshEtag)) {
            return notModified(request, {
              etag: freshEtag,
              "cache-control": `public, max-age=60, s-maxage=${freshSMaxAge}, stale-while-revalidate=300, stale-if-error=86400`,
            });
          }
          return json(responseData, 200, request, {
            etag: freshEtag,
            "cache-control": `public, max-age=60, s-maxage=${freshSMaxAge}, stale-while-revalidate=300, stale-if-error=86400`,
          });
        } catch (err) {
          console.error("API Error [snapshot]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // ティッカーバー用リアルタイム実データ取得エンドポイント
      if (url.pathname === "/api/ticker-prices" && request.method === "GET") {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(
            env,
            ip,
            "ticker-prices",
            RATE_LIMIT_MAX,
            false,
            ctx,
          );
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const forceRefresh =
            url.searchParams.get("refresh") !== null ||
            requestsFreshCalculation(request);

          const memKey = "ticker:quotes";
          if (!forceRefresh) {
            const memCachedEntry = getMemoryCacheEntry<{
              updatedAt: string;
              quotes: TickerPriceQuote[];
              allStale?: boolean;
            }>(memKey);
            if (memCachedEntry) {
              const memCached = memCachedEntry.data;
              const remainingTtl = memCachedEntry.remainingSeconds;
              const isStale = Boolean(memCached.allStale);
              const edgeTtl = isStale ? Math.min(10, remainingTtl) : Math.min(60, remainingTtl);
              const browserTtl = isStale ? Math.min(5, remainingTtl) : Math.min(30, remainingTtl);
              const cacheControl = `public, max-age=${browserTtl}, s-maxage=${edgeTtl}, stale-while-revalidate=120, stale-if-error=86400`;
              const etag = await generateETag(JSON.stringify(memCached));
              if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
                return notModified(request, {
                  etag,
                  "cache-control": cacheControl,
                });
              }
              return json(memCached, 200, request, {
                etag,
                "cache-control": cacheControl,
              });
            }
          }

          const quotes = await fetchAllTickerQuotes(lastKnownTickerQuotes);
          for (const q of quotes) {
            if (!q.stale) {
              lastKnownTickerQuotes.set(q.proName, q);
            }
          }
          // A payload where every quote is a static/previous fallback must
          // never be cached as fresh market data: shorten its TTL and flag it
          // so the client keeps the 参考値 disclosure instead of badging LIVE.
          const allStale = quotes.length > 0 && quotes.every((q) => q.stale === true);
          const responseData = {
            updatedAt: new Date().toISOString(),
            quotes,
            ...(allStale ? { allStale: true as const } : {}),
          };

          setMemoryCache(memKey, responseData, allStale ? 10 : 45);
          const edgeTtl = allStale ? 10 : 60;
          const browserTtl = allStale ? 5 : 30;
          const cacheControl = `public, max-age=${browserTtl}, s-maxage=${edgeTtl}, stale-while-revalidate=120, stale-if-error=86400`;
          const etag = await generateETag(JSON.stringify(responseData));
          if (!forceRefresh && matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
            return notModified(request, {
              etag,
              "cache-control": cacheControl,
            });
          }

          return json(responseData, 200, request, {
            etag,
            "cache-control": cacheControl,
          });
        } catch (err) {
          console.error("API Error [ticker-prices]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // グローバル市場概況リアルタイムデータ取得エンドポイント
      if (url.pathname === "/api/market/overview" && request.method === "GET") {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(
            env,
            ip,
            "market-overview",
            RATE_LIMIT_MAX,
            false,
            ctx,
          );
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const forceRefresh =
            url.searchParams.get("refresh") !== null ||
            requestsFreshCalculation(request);

          const memKey = "overview:market";
          if (!forceRefresh) {
            const memCachedEntry = getMemoryCacheEntry<MarketOverviewData>(memKey);
            if (memCachedEntry) {
              const memCached = memCachedEntry.data;
              const remainingTtl = memCachedEntry.remainingSeconds;
              const edgeTtl = Math.min(60, remainingTtl);
              const browserTtl = Math.min(30, remainingTtl);
              const cacheControl = `public, max-age=${browserTtl}, s-maxage=${edgeTtl}, stale-while-revalidate=300, stale-if-error=86400`;
              const etag = await generateETag(JSON.stringify(memCached));
              if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
                return notModified(request, {
                  etag,
                  "cache-control": cacheControl,
                });
              }
              return json(memCached, 200, request, {
                etag,
                "cache-control": cacheControl,
              });
            }
          }

          const liveData = await fetchLiveMarketOverview(lastKnownMarketOverview);
          lastKnownMarketOverview = liveData;

          setMemoryCache(memKey, liveData, 45);
          const cacheControl = `public, max-age=30, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400`;
          const etag = await generateETag(JSON.stringify(liveData));
          if (!forceRefresh && matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
            return notModified(request, {
              etag,
              "cache-control": cacheControl,
            });
          }

          return json(liveData, 200, request, {
            etag,
            "cache-control": cacheControl,
          });
        } catch (err) {
          console.error("API Error [market-overview]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 個別銘柄のファンダメンタルズ・リアルタイムデータ取得エンドポイント
      if (
        (url.pathname === "/api/stock/fundamentals" || url.pathname === "/api/stock/quote") &&
        request.method === "GET"
      ) {
        try {
          const ticker = url.searchParams.get("ticker");
          if (!ticker || !ticker.trim()) {
            return json({ error: "ticker query parameter is required" }, 400, request);
          }

          const norm = ticker.trim().toUpperCase();
          if (norm.length > 20 || !/^[A-Z0-9.^=_-]{1,20}$/.test(norm)) {
            return json({ error: "Invalid ticker format" }, 400, request);
          }

          const ip = getClientIp(request);
          const allowed = await checkRateLimit(
            env,
            ip,
            "stock-fundamentals",
            RATE_LIMIT_MAX,
            false,
            ctx,
          );
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const forceRefresh =
            url.searchParams.get("refresh") !== null ||
            requestsFreshCalculation(request);

          const memKey = `stock:${norm}`;
          if (!forceRefresh) {
            const memCachedEntry = getMemoryCacheEntry<StockQuoteFundamentals>(memKey);
            if (memCachedEntry) {
              const memCached = memCachedEntry.data;
              const remainingTtl = memCachedEntry.remainingSeconds;
              const edgeTtl = Math.min(180, remainingTtl);
              const browserTtl = Math.min(60, remainingTtl);
              const cacheControl = `public, max-age=${browserTtl}, s-maxage=${edgeTtl}, stale-while-revalidate=600, stale-if-error=86400`;
              const etag = await generateETag(JSON.stringify(memCached));
              if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
                return notModified(request, {
                  etag,
                  "cache-control": cacheControl,
                });
              }
              return json(memCached, 200, request, {
                etag,
                "cache-control": cacheControl,
              });
            }
          }

          const stockData = await fetchLiveStockFundamentals(norm, env);
          setMemoryCache(memKey, stockData, 300);
          const cacheControl = `public, max-age=60, s-maxage=180, stale-while-revalidate=600, stale-if-error=86400`;
          const etag = await generateETag(JSON.stringify(stockData));
          if (!forceRefresh && matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
            return notModified(request, {
              etag,
              "cache-control": cacheControl,
            });
          }

          return json(stockData, 200, request, {
            etag,
            "cache-control": cacheControl,
          });
        } catch (err) {
          console.error("API Error [stock-fundamentals]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // スクリーナー用リアルタイム実データ取得エンドポイント
      if (
        (url.pathname === "/api/stocks/screener" || url.pathname === "/api/screener") &&
        request.method === "GET"
      ) {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(
            env,
            ip,
            "stocks-screener",
            RATE_LIMIT_MAX,
            false,
            ctx,
          );
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const forceRefresh =
            url.searchParams.get("refresh") !== null ||
            requestsFreshCalculation(request);

          const memKey = "screener:universe";
          if (!forceRefresh) {
            const memCachedEntry = getMemoryCacheEntry<StockQuoteFundamentals[]>(memKey);
            if (memCachedEntry) {
              const memCached = memCachedEntry.data;
              const remainingTtl = memCachedEntry.remainingSeconds;
              const edgeTtl = Math.min(120, remainingTtl);
              const browserTtl = Math.min(60, remainingTtl);
              const cacheControl = `public, max-age=${browserTtl}, s-maxage=${edgeTtl}, stale-while-revalidate=600, stale-if-error=86400`;
              const etag = await generateETag(JSON.stringify(memCached));
              if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
                return notModified(request, {
                  etag,
                  "cache-control": cacheControl,
                });
              }
              return json(memCached, 200, request, {
                etag,
                "cache-control": cacheControl,
              });
            }
          }

          const universeData = await fetchLiveScreenerUniverse(lastKnownScreenerUniverse);
          lastKnownScreenerUniverse = universeData;
          setMemoryCache(memKey, universeData, 180);

          const cacheControl = `public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400`;
          const etag = await generateETag(JSON.stringify(universeData));
          if (!forceRefresh && matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
            return notModified(request, {
              etag,
              "cache-control": cacheControl,
            });
          }

          return json(universeData, 200, request, {
            etag,
            "cache-control": cacheControl,
          });
        } catch (err) {
          console.error("API Error [stocks-screener]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 経済指標・決算発表カレンダーリアルタイム取得エンドポイント
      if (url.pathname === "/api/market/calendar" && request.method === "GET") {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(
            env,
            ip,
            "market-calendar",
            RATE_LIMIT_MAX,
            false,
            ctx,
          );
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const forceRefresh =
            url.searchParams.get("refresh") !== null ||
            requestsFreshCalculation(request);

          const memKey = "market:calendar";
          if (!forceRefresh) {
            const memCachedEntry = getMemoryCacheEntry<CalendarEvent[]>(memKey);
            if (memCachedEntry) {
              const memCached = memCachedEntry.data;
              const remainingTtl = memCachedEntry.remainingSeconds;
              const edgeTtl = Math.min(300, remainingTtl);
              const browserTtl = Math.min(120, remainingTtl);
              const cacheControl = `public, max-age=${browserTtl}, s-maxage=${edgeTtl}, stale-while-revalidate=3600, stale-if-error=86400`;
              const etag = await generateETag(JSON.stringify(memCached));
              if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
                return notModified(request, {
                  etag,
                  "cache-control": cacheControl,
                });
              }
              return json(memCached, 200, request, {
                etag,
                "cache-control": cacheControl,
              });
            }
          }

          let events: CalendarEvent[];
          try {
            events = await fetchLiveMarketCalendarAsync(lastKnownScreenerUniverse ?? undefined);
          } catch (liveErr) {
            console.warn("fetchLiveMarketCalendarAsync failed, falling back:", liveErr);
            events =
              (!forceRefresh && lastKnownCalendarEvents) ||
              fetchLiveMarketCalendar(lastKnownScreenerUniverse ?? undefined);
          }

          const isAllFallback = events.every((e) => e.source === "fallback");
          const memTtl = isAllFallback ? 60 : 600;
          setMemoryCache(memKey, events, memTtl);

          const cacheControl = `public, max-age=120, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400`;
          const etag = await generateETag(JSON.stringify(events));
          if (!forceRefresh && matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
            return notModified(request, {
              etag,
              "cache-control": cacheControl,
            });
          }

          return json(events, 200, request, {
            etag,
            "cache-control": cacheControl,
          });
        } catch (err) {
          console.error("API Error [market-calendar]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 登録されている指数一覧の取得 (D1から取得、sort_order使用、インメモリ&HTTPキャッシュ付き)
      if (url.pathname === "/api/indices" && request.method === "GET") {
        try {
          const ip = getClientIp(request);
          if (!(await checkRateLimit(env, ip, "indices-list", RATE_LIMIT_MAX, false, ctx))) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const cachedIndices = getMemoryCache<unknown>("api:indices");
          if (cachedIndices) {
            const etag = await generateETag(JSON.stringify(cachedIndices));
            if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
              return notModified(request, {
                etag: etag,
                // ETag/304 revalidation only; the CDN must not cache this list
                // (mutations cannot purge the edge cache, so public caching
                // would serve stale index lists after saves/deletes).
                "cache-control": "no-cache",
              });
            }
            return json(cachedIndices, 200, request, {
              etag: etag,
              "cache-control": "no-cache",
            });
          }

          let results: D1Row[] = [];
          try {
            const dbRes = await env.DB.prepare(
              `
            SELECT
              i.id, i.name, i.description, i.base_value, COALESCE(i.sort_order, 99) AS sort_order,
              b.ticker, b.name as stock_name, COALESCE(b.weight, 0) AS weight, b.theme
            FROM indices i
            LEFT JOIN basket_items b ON i.id = b.index_id
            ORDER BY
              COALESCE(i.sort_order, 99),
              i.name,
              i.id,
              b.ticker
          `,
            ).all();
            results = (dbRes.results || []) as D1Row[];
            // D1 has a hard ceiling of 1,000 rows returned per query. If the initial
            // result hit the ceiling, fetch subsequent pages to prevent silent constituent truncation.
            let offset = results.length;
            while (results.length > 0 && offset % 1000 === 0) {
              const pageRes = await env.DB.prepare(
                `
              SELECT
                i.id, i.name, i.description, i.base_value, COALESCE(i.sort_order, 99) AS sort_order,
                b.ticker, b.name as stock_name, COALESCE(b.weight, 0) AS weight, b.theme
              FROM indices i
              LEFT JOIN basket_items b ON i.id = b.index_id
              ORDER BY
                COALESCE(i.sort_order, 99),
                i.name,
                i.id,
                b.ticker
              LIMIT 1000 OFFSET ?
            `,
              )
                .bind(offset)
                .all();
              const pageRows = (pageRes.results || []) as D1Row[];
              if (pageRows.length === 0) break;
              results.push(...pageRows);
              offset += pageRows.length;
              if (pageRows.length < 1000) break;
            }
          } catch (lookupErr: unknown) {
            if (!isMissingColumnError(lookupErr, "sort_order")) throw lookupErr;
            const dbRes = await env.DB.prepare(
              `
            SELECT
              i.id, i.name, i.description, i.base_value, 99 AS sort_order,
              b.ticker, b.name as stock_name, COALESCE(b.weight, 0) AS weight, b.theme
            FROM indices i
            LEFT JOIN basket_items b ON i.id = b.index_id
            ORDER BY
              i.name,
              i.id,
              b.ticker
          `,
            ).all();
            results = (dbRes.results || []) as D1Row[];
            let offset = results.length;
            while (results.length > 0 && offset % 1000 === 0) {
              const pageRes = await env.DB.prepare(
                `
              SELECT
                i.id, i.name, i.description, i.base_value, 99 AS sort_order,
                b.ticker, b.name as stock_name, COALESCE(b.weight, 0) AS weight, b.theme
              FROM indices i
              LEFT JOIN basket_items b ON i.id = b.index_id
              ORDER BY
                i.name,
                i.id,
                b.ticker
              LIMIT 1000 OFFSET ?
            `,
              )
                .bind(offset)
                .all();
              const pageRows = (pageRes.results || []) as D1Row[];
              if (pageRows.length === 0) break;
              results.push(...pageRows);
              offset += pageRows.length;
              if (pageRows.length < 1000) break;
            }
          }

          const indicesMap = new Map<
            string,
            {
              id: string;
              name: string;
              description: string;
              baseValue: number;
              basket: BasketItem[];
              sortOrder?: number;
            }
          >();
          for (const row of results as D1Row[]) {
            const id = String(row.id);
            if (!indicesMap.has(id)) {
              const rawBase = Number(row.base_value);
              const baseValue = Number.isFinite(rawBase) && rawBase > 0 ? rawBase : 1000;
              const rawSort = Number(row.sort_order);
              const sortOrder = Number.isFinite(rawSort) ? rawSort : 99;
              indicesMap.set(id, {
                id,
                name: row.name != null && String(row.name).trim() ? String(row.name).trim() : id,
                description: row.description ? String(row.description) : "",
                baseValue,
                sortOrder,
                basket: [],
              });
            }
            if (row.ticker) {
              const ticker = String(row.ticker).trim().toUpperCase();
              if (!ticker) continue;
              // Legacy rows may carry NULL or zero weights; coerce defensively so the
              // API never emits NaN or non-positive weight into the basket payload.
              const rawWeight = Number(row.weight);
              indicesMap.get(id)!.basket.push({
                ticker,
                name:
                  row.stock_name != null && String(row.stock_name).trim()
                    ? String(row.stock_name).trim()
                    : ticker,
                weight: Number.isFinite(rawWeight) ? rawWeight : 0,
                theme: row.theme ? String(row.theme) : "",
              });
            }
          }

          const indicesList = Array.from(indicesMap.values());
          setMemoryCache("api:indices", indicesList, 15);

          const etag = await generateETag(JSON.stringify(indicesList));
          if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
            return notModified(request, {
              etag: etag,
              "cache-control": "no-cache",
            });
          }

          return json(indicesList, 200, request, {
            etag: etag,
            "cache-control": "no-cache",
          });
        } catch (err) {
          console.error("API Error [indices]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 指数の新規登録・更新 (D1への永続化 + 作成者権限チェック)
      if (url.pathname === "/api/indices" && request.method === "POST") {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(env, ip, "indices");
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return parsed.response;
          const body = parsed.body;
          const headerOwnerToken = request.headers.get("x-owner-token")?.trim() || "";

          if (
            body.ownerToken !== undefined &&
            (typeof body.ownerToken !== "string" || body.ownerToken.length > 256)
          ) {
            return json(
              { error: "Invalid ownerToken: must be a string up to 256 characters" },
              400,
              request,
            );
          }
          if (headerOwnerToken.length > 256) {
            return json(
              { error: "Invalid ownerToken: must be a string up to 256 characters" },
              400,
              request,
            );
          }

          if (
            body.name !== undefined &&
            (typeof body.name !== "string" ||
              body.name.trim().length === 0 ||
              body.name.trim().length > 100)
          ) {
            return json({ error: "Invalid name: must be 1-100 characters" }, 400, request);
          }
          const name =
            typeof body.name === "string" && body.name.trim().length > 0
              ? body.name.trim()
              : "マイカスタム指数";

          if (
            body.id !== undefined &&
            (typeof body.id !== "string" ||
              body.id.trim().length === 0 ||
              body.id.trim().length > 100 ||
              !/^[A-Za-z0-9._-]+$/.test(body.id.trim()))
          ) {
            return json({ error: "Invalid id" }, 400, request);
          }
          const id =
            typeof body.id === "string" && body.id.trim().length > 0
              ? body.id.trim()
              : `custom-${crypto.randomUUID()}`;

          // Password authentication and role check
          const explicitPwd = typeof body.password === "string" ? body.password : null;
          const auth = await authenticatePassword(request, env, explicitPwd, "auth-api", ctx);
          const isAdmin = auth.authenticated && auth.role === "admin";

          if (SYSTEM_INDICES.has(id) && !isAdmin) {
            return json({ error: "システム指数の編集には管理者権限が必要です" }, 403, request);
          }

          if (
            body.description !== undefined &&
            (typeof body.description !== "string" || body.description.length > 500)
          ) {
            return json({ error: "Invalid description: max 500 characters" }, 400, request);
          }
          const description = typeof body.description === "string" ? body.description.trim() : "";

          if (
            body.baseValue !== undefined &&
            (typeof body.baseValue !== "number" ||
              !Number.isFinite(body.baseValue) ||
              body.baseValue <= 0 ||
              body.baseValue > 1000000)
          ) {
            return json({ error: "Invalid baseValue" }, 400, request);
          }
          const baseValue = typeof body.baseValue === "number" ? body.baseValue : 1000;

          let sortOrder: number | null = null;
          if (body.sortOrder !== undefined && body.sortOrder !== null) {
            if (
              typeof body.sortOrder !== "number" ||
              !Number.isFinite(body.sortOrder) ||
              body.sortOrder < 0 ||
              body.sortOrder > 9999
            ) {
              return json(
                { error: "Invalid sortOrder: must be a number between 0 and 9999" },
                400,
                request,
              );
            }
            sortOrder = Math.floor(body.sortOrder);
          }

          const basket: unknown[] = Array.isArray(body.basket) ? body.basket : [];
          if (basket.length === 0) {
            return json({ error: "Basket must contain at least 1 item" }, 400, request);
          }
          if (basket.length > MAX_BASKET_ITEMS) {
            return json(
              { error: `Basket must contain at most ${MAX_BASKET_ITEMS} items` },
              400,
              request,
            );
          }

          const seenTickers = new Set<string>();
          const validatedBasket: BasketItemInput[] = [];
          for (const item of basket) {
            if (!item || typeof item !== "object") {
              return json({ error: "Invalid basket item" }, 400, request);
            }
            const r = item as Record<string, unknown>;
            if (
              typeof r.ticker !== "string" ||
              r.ticker.trim().length === 0 ||
              r.ticker.trim().length > 20 ||
              !/^[A-Za-z0-9.-]+$/.test(r.ticker.trim())
            ) {
              return json({ error: "Invalid basket item: ticker" }, 400, request);
            }
            const ticker = r.ticker.trim().toUpperCase();
            if (seenTickers.has(ticker)) {
              return json({ error: `Duplicate ticker in basket: ${ticker}` }, 400, request);
            }
            seenTickers.add(ticker);

            if (
              typeof r.name !== "string" ||
              r.name.trim().length === 0 ||
              r.name.trim().length > 100
            ) {
              return json({ error: "Invalid basket item: name" }, 400, request);
            }
            if (
              r.theme !== undefined &&
              (typeof r.theme !== "string" || r.theme.trim().length > 100)
            ) {
              return json({ error: "Invalid basket item: theme" }, 400, request);
            }
            if (
              typeof r.weight !== "number" ||
              !Number.isFinite(r.weight) ||
              r.weight <= 0 ||
              r.weight > 100
            ) {
              return json(
                { error: "Invalid basket item: weight must be > 0 and <= 100" },
                400,
                request,
              );
            }
            validatedBasket.push({
              ticker,
              name: r.name.trim(),
              theme: typeof r.theme === "string" ? r.theme.trim() : "カスタム",
              weight: r.weight,
            });
          }

          // Stock limit check for non-admin users
          if (auth.authenticated && auth.role === "user" && auth.maxStocks && auth.maxStocks > 0) {
            if (basket.length > auth.maxStocks) {
              return json(
                {
                  error: `このユーザー用パスワードでは銘柄数を最大${auth.maxStocks}銘柄までに制限されています（指定: ${basket.length}銘柄）`,
                },
                403,
                request,
              );
            }
          }

          // Owner token verification
          let providedToken =
            (typeof body.ownerToken === "string" && body.ownerToken.trim().length > 0
              ? body.ownerToken.trim()
              : null) ||
            headerOwnerToken ||
            "";

          // Check if index already exists in D1
          let existingHash: string | null = null;
          let existingCreatorId: string | null = null;
          let isExisting = false;
          let hasOwnerTokenHashColumn = true;
          try {
            const { results } = await env.DB.prepare(
              "SELECT id, owner_token_hash, creator_id FROM indices WHERE id = ?",
            )
              .bind(id)
              .all();
            if (results && results.length > 0) {
              isExisting = true;
              const row = results[0] as { owner_token_hash?: string; creator_id?: string | null };
              existingHash = row.owner_token_hash || null;
              existingCreatorId = row.creator_id || null;
            }
          } catch (lookupErr: unknown) {
            if (
              !isMissingColumnError(lookupErr, "creator_id") &&
              !isMissingColumnError(lookupErr, "owner_token_hash")
            ) {
              throw lookupErr;
            }
            try {
              const { results } = await env.DB.prepare(
                "SELECT id, owner_token_hash FROM indices WHERE id = ?",
              )
                .bind(id)
                .all();
              if (results && results.length > 0) {
                isExisting = true;
                existingHash =
                  (results[0] as { owner_token_hash?: string }).owner_token_hash || null;
              }
            } catch (lookupErr2: unknown) {
              if (!isMissingColumnError(lookupErr2, "owner_token_hash")) throw lookupErr2;
              hasOwnerTokenHashColumn = false;
              const { results } = await env.DB.prepare("SELECT id FROM indices WHERE id = ?")
                .bind(id)
                .all();
              if (results && results.length > 0) isExisting = true;
            }
          }

          // The client UI requires a password before saving. Enforce that
          // boundary on the API as well: otherwise callers can create new
          // indices directly and bypass per-user stock/index quotas. Existing
          // owner-token protected indices remain editable for compatibility.
          if (!isExisting && !auth.authenticated) {
            return json({ error: "指数の新規作成にはパスワード認証が必要です" }, 401, request);
          }

          // Prevent quota bypass on modifying existing indices:
          // If caller is not admin and the index was created by a user, enforce that user's max_stocks limit.
          if (isExisting && !isAdmin && existingCreatorId && existingCreatorId !== "admin-master") {
            try {
              const creatorRow =
                auth.id === existingCreatorId
                  ? { max_stocks: auth.maxStocks }
                  : ((
                      await env.DB.prepare("SELECT max_stocks FROM access_passwords WHERE id = ?")
                        .bind(existingCreatorId)
                        .all()
                    ).results?.[0] as { max_stocks?: unknown } | undefined);
              if (!creatorRow) {
                return json(
                  { error: "作成者の銘柄数上限を確認できないため、後で再試行してください" },
                  503,
                  request,
                );
              }
              if (creatorRow.max_stocks !== null && creatorRow.max_stocks !== undefined) {
                const creatorMaxStocks = Number(creatorRow.max_stocks);
                if (
                  !Number.isSafeInteger(creatorMaxStocks) ||
                  creatorMaxStocks < 1 ||
                  creatorMaxStocks > MAX_BASKET_ITEMS
                ) {
                  return json(
                    { error: "作成者の銘柄数上限を確認できないため、後で再試行してください" },
                    503,
                    request,
                  );
                }
                if (basket.length > creatorMaxStocks) {
                  return json(
                    {
                      error: `このユーザー用パスワードでは銘柄数を最大${creatorMaxStocks}銘柄までに制限されています（指定: ${basket.length}銘柄）`,
                    },
                    403,
                    request,
                  );
                }
              }
            } catch (quotaLookupErr) {
              console.error("Failed to check index creator stock quota:", quotaLookupErr);
              return json(
                { error: "作成者の銘柄数上限を確認できないため、後で再試行してください" },
                503,
                request,
              );
            }
          }

          const isUserCreatingIndex = !isExisting && auth.authenticated && auth.role === "user";
          const userIndexLimit =
            isUserCreatingIndex &&
            typeof auth.maxIndices === "number" &&
            Number.isSafeInteger(auth.maxIndices) &&
            auth.maxIndices > 0
              ? auth.maxIndices
              : null;

          // A newly-created user index must retain its ownership metadata. The
          // legacy fallback is still available to administrators, but allowing
          // a regular user to create an unowned index would either lock them out
          // on the next edit or weaken the ownership boundary.
          if (isUserCreatingIndex && !hasOwnerTokenHashColumn) {
            return json(
              { error: "指数を安全に作成するにはデータベースのマイグレーションが必要です" },
              503,
              request,
            );
          }

          // Index limit check for user role when creating a new index. A
          // missing creator_id column must fail closed: ignoring the query
          // error would turn a schema migration gap into a quota bypass.
          if (userIndexLimit !== null) {
            if (!auth.id) {
              return json(
                { error: "指数作成数制限を適用するにはユーザー情報のマイグレーションが必要です" },
                503,
                request,
              );
            }
            try {
              const countRes = await env.DB.prepare(
                "SELECT COUNT(*) as count FROM indices WHERE creator_id = ?",
              )
                .bind(auth.id)
                .all();
              const rawCount = (countRes.results?.[0] as { count?: unknown } | undefined)?.count;
              const currentIndicesCount = Number(rawCount);
              if (!Number.isSafeInteger(currentIndicesCount) || currentIndicesCount < 0) {
                return json(
                  {
                    error:
                      "指数作成数制限を確認できないため、データベースのマイグレーションが必要です",
                  },
                  503,
                  request,
                );
              }
              if (currentIndicesCount >= userIndexLimit) {
                return json(
                  {
                    error: `このユーザー用パスワードでは指数作成数を最大${userIndexLimit}件までに制限されています（現在${currentIndicesCount}件登録済み）`,
                  },
                  403,
                  request,
                );
              }
            } catch {
              return json(
                { error: "指数作成数制限を確認するにはデータベースのマイグレーションが必要です" },
                503,
                request,
              );
            }
          }

          let targetHash: string | null = null;

          if (isExisting) {
            // If index already exists and has an owner token hash, require authorization (admin bypasses)
            if (!isAdmin) {
              if (existingHash) {
                if (!providedToken) {
                  return json(
                    { error: "この指数を更新する権限がありません（作成者トークンが必要です）" },
                    403,
                    request,
                  );
                }
                const providedHash = await hashToken(providedToken);
                if (!timingSafeEqual(providedHash, existingHash)) {
                  return json(
                    { error: "この指数を更新する権限がありません（作成者トークンが一致しません）" },
                    403,
                    request,
                  );
                }
                targetHash = existingHash;
              } else {
                return json(
                  { error: "この指数は保護されているため更新できません（管理者権限が必要です）" },
                  403,
                  request,
                );
              }
            } else {
              // Admin edit:
              // 1. Built-in system indices must never have an owner_token_hash.
              if (SYSTEM_INDICES.has(id)) {
                targetHash = null;
              } else if (existingHash) {
                // 2. Preserve existing owner's hash so admin edits don't hijack ownership or lock out users.
                targetHash = existingHash;
              } else if (providedToken) {
                // 3. Unowned custom index being edited by admin
                targetHash = await hashToken(providedToken);
              }
            }
          } else {
            // Brand new index
            if (SYSTEM_INDICES.has(id)) {
              targetHash = null;
            } else {
              if (!providedToken) {
                providedToken = crypto.randomUUID();
              }
              targetHash = await hashToken(providedToken);
            }
          }

          const nowMs = Math.floor(Date.now() / 1000);
          const creatorId = isExisting
            ? existingCreatorId
            : auth.authenticated && auth.id
              ? auth.id
              : null;

          const buildIndexStatements = (columns: IndexWriteColumns): D1PreparedStatement[] => {
            const quotaGuarded = userIndexLimit !== null && columns.creatorId;
            const basketWriteGuard = quotaGuarded
              ? " AND EXISTS (SELECT 1 FROM indices WHERE id = ? AND creator_id = ?)"
              : "";
            const basketWriteGuardParams = quotaGuarded ? [id, auth.id as string] : [];
            const indexUpsert = prepareIndexUpsert(
              env,
              {
                id,
                name,
                description,
                baseValue,
                ownerTokenHash: targetHash,
                creatorId,
                createdAt: nowMs,
                sortOrder,
                useReplace: isExisting || !hasOwnerTokenHashColumn,
                creationLimit: quotaGuarded ? userIndexLimit : undefined,
              },
              columns,
            );
            const deleteBasket = env.DB.prepare(
              `DELETE FROM basket_items WHERE index_id = ?${basketWriteGuard}`,
            ).bind(id, ...basketWriteGuardParams);
            const saveBasketItems = prepareBasketItemWrites(
              env,
              validatedBasket,
              id,
              quotaGuarded,
              quotaGuarded ? (auth.id as string) : null,
            );
            return [indexUpsert, deleteBasket, ...saveBasketItems];
          };

          // Start with the current schema. If D1 reports a missing migration
          // column, retry only after removing the named column. When the owner
          // column itself is absent, omit all optional metadata rather than
          // pretending that ownership/quota metadata was persisted.
          let indexWriteColumns: IndexWriteColumns = {
            ownerTokenHash: hasOwnerTokenHashColumn,
            creatorId: hasOwnerTokenHashColumn,
            createdAt: hasOwnerTokenHashColumn,
            sortOrder: true,
          };
          for (;;) {
            try {
              const batchResults = await env.DB.batch(buildIndexStatements(indexWriteColumns));
              if (userIndexLimit !== null) {
                const firstResult = (
                  batchResults as Array<{ meta?: { changes?: number } }> | undefined
                )?.[0];
                // D1 reports zero changes when another request consumed the
                // final quota slot after the preliminary count check. The
                // guarded basket statements then become no-ops as well.
                if (firstResult?.meta?.changes === 0) {
                  return json(
                    {
                      error: `このユーザー用パスワードでは指数作成数を最大${userIndexLimit}件までに制限されています`,
                    },
                    403,
                    request,
                  );
                }
              }
              break;
            } catch (batchErr: unknown) {
              const mentionsMissingColumn =
                isMissingColumnError(batchErr, "owner_token_hash") ||
                isMissingColumnError(batchErr, "created_at") ||
                isMissingColumnError(batchErr, "creator_id") ||
                isMissingColumnError(batchErr, "sort_order");
              // Retry whenever the failure names one of the optional columns we
              // can drop. Gating this on hasOwnerTokenHashColumn made the
              // sort_order retry unreachable on a legacy schema that lacks
              // owner_token_hash: the "no such column: sort_order" error was
              // rethrown as a 500 instead of retrying without sort_order.
              if (!mentionsMissingColumn) {
                throw batchErr;
              }

              if (
                isUserCreatingIndex &&
                (isMissingColumnError(batchErr, "owner_token_hash") ||
                  isMissingColumnError(batchErr, "creator_id"))
              ) {
                return json(
                  { error: "指数を安全に保存するにはデータベースのマイグレーションが必要です" },
                  503,
                  request,
                );
              }

              const nextColumns: IndexWriteColumns = {
                ownerTokenHash:
                  indexWriteColumns.ownerTokenHash &&
                  !isMissingColumnError(batchErr, "owner_token_hash"),
                creatorId:
                  indexWriteColumns.creatorId && !isMissingColumnError(batchErr, "creator_id"),
                createdAt:
                  indexWriteColumns.createdAt && !isMissingColumnError(batchErr, "created_at"),
                sortOrder:
                  (indexWriteColumns.sortOrder ?? true) &&
                  !isMissingColumnError(batchErr, "sort_order"),
              };
              if (
                nextColumns.ownerTokenHash !== indexWriteColumns.ownerTokenHash &&
                !nextColumns.ownerTokenHash
              ) {
                nextColumns.creatorId = false;
                nextColumns.createdAt = false;
              }
              if (
                nextColumns.ownerTokenHash === indexWriteColumns.ownerTokenHash &&
                nextColumns.creatorId === indexWriteColumns.creatorId &&
                nextColumns.createdAt === indexWriteColumns.createdAt &&
                nextColumns.sortOrder === indexWriteColumns.sortOrder
              ) {
                throw batchErr;
              }
              indexWriteColumns = nextColumns;
            }
          }
          clearMemoryCache("api:indices");
          clearMemoryCache("calc:");

          return json(
            {
              ok: true,
              id,
              // Only return an owner token when the final write actually persisted
              // its hash. On an unmigrated legacy schema the token cannot authorize
              // a later owner operation, so returning it would create a misleading
              // "owned" index in the browser.
              ownerToken:
                indexWriteColumns.ownerTokenHash && !SYSTEM_INDICES.has(id)
                  ? isAdmin && isExisting && existingHash
                    ? undefined
                    : providedToken
                  : undefined,
              message: "Index saved successfully",
            },
            200,
            request,
          );
        } catch (err) {
          console.error("API Error [POST indices]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 指数の削除 (作成者認証付き)
      if (url.pathname === "/api/indices" && request.method === "DELETE") {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(env, ip, "indices");
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const rawId = url.searchParams.get("id");
          if (
            !rawId ||
            typeof rawId !== "string" ||
            rawId.trim().length === 0 ||
            rawId.trim().length > 100 ||
            !/^[A-Za-z0-9._-]+$/.test(rawId.trim())
          ) {
            return json({ error: "Invalid or missing index id parameter" }, 400, request);
          }
          const id = rawId.trim();
          const providedToken =
            url.searchParams.get("ownerToken")?.trim() ||
            request.headers.get("x-owner-token")?.trim() ||
            "";
          if (providedToken.length > 256) {
            return json(
              { error: "Invalid ownerToken: must be a string up to 256 characters" },
              400,
              request,
            );
          }

          if (SYSTEM_INDICES.has(id)) {
            return json({ error: "Cannot delete built-in system index" }, 403, request);
          }

          let existingHash: string | null = null;
          let isExisting = false;
          try {
            const { results } = await env.DB.prepare(
              "SELECT id, owner_token_hash FROM indices WHERE id = ?",
            )
              .bind(id)
              .all();
            if (results && results.length > 0) {
              isExisting = true;
              existingHash = (results[0] as { owner_token_hash?: string }).owner_token_hash || null;
            }
          } catch (lookupErr: unknown) {
            if (!isMissingColumnError(lookupErr, "owner_token_hash")) throw lookupErr;
            const { results } = await env.DB.prepare("SELECT id FROM indices WHERE id = ?")
              .bind(id)
              .all();
            if (results && results.length > 0) isExisting = true;
          }

          if (!isExisting) {
            return json({ error: "Index not found" }, 404, request);
          }

          const auth = await authenticatePassword(request, env, null, "auth-api", ctx);
          const isAdmin = auth.authenticated && auth.role === "admin";

          if (!isAdmin) {
            if (existingHash) {
              if (!providedToken) {
                return json(
                  { error: "この指数を削除する権限がありません（作成者トークンが必要です）" },
                  403,
                  request,
                );
              }
              const providedHash = await hashToken(providedToken);
              if (!timingSafeEqual(providedHash, existingHash)) {
                return json(
                  { error: "この指数を削除する権限がありません（作成者トークンが一致しません）" },
                  403,
                  request,
                );
              }
            } else {
              // Protected / legacy index without hash can only be deleted by admin
              return json(
                { error: "この指数は保護されているため削除できません（管理者権限が必要です）" },
                403,
                request,
              );
            }
          }

          const statements = [
            env.DB.prepare("DELETE FROM basket_items WHERE index_id = ?").bind(id),
            env.DB.prepare("DELETE FROM indices WHERE id = ?").bind(id),
          ];
          await env.DB.batch(statements);
          clearMemoryCache("api:indices");
          clearMemoryCache("calc:");

          return json({ ok: true, id, message: "Index deleted successfully" }, 200, request);
        } catch (err) {
          console.error("API Error [DELETE indices]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 銘柄データの同期 (履歴をD1に保存、並列バッチ処理)
      if (url.pathname === "/api/sync-prices" && request.method === "POST") {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(env, ip, "sync-prices", RATE_LIMIT_MAX, false, ctx);
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return parsed.response;
          const body = parsed.body;
          if (!Array.isArray(body.tickers)) {
            return json({ error: "Invalid request body: tickers array required" }, 400, request);
          }
          if (body.tickers.length === 0) {
            return json(
              { error: "Invalid request body: tickers array must not be empty" },
              400,
              request,
            );
          }
          const rawTickers = body.tickers as unknown[];
          for (const t of rawTickers) {
            if (
              typeof t !== "string" ||
              t.trim().length === 0 ||
              t.trim().length > 20 ||
              !/^[A-Za-z0-9.^=_-]+$/.test(t.trim())
            ) {
              return json({ error: "Invalid ticker value" }, 400, request);
            }
          }
          // Keep the request within Cloudflare's subrequest limits. Silently
          // truncating used to make callers believe every ticker was refreshed.
          if (rawTickers.length > 30) {
            return json({ error: "At most 30 tickers may be synced per request" }, 400, request);
          }
          const tickers = Array.from(
            new Set((rawTickers as string[]).map((t) => t.trim().toUpperCase())),
          );
          const force = body.force === true;
          if (force) {
            const bodyPassword = typeof body.password === "string" ? body.password : null;
            const auth = await authenticatePassword(request, env, bodyPassword, "auth-api", ctx);
            if (!auth.authenticated) {
              return json({ error: "強制同期にはパスワード認証が必要です" }, 401, request);
            }
          }
          await ensurePasswordTable(env);
          const results: { ticker: string; status: string; count?: number; lastSynced?: number }[] =
            [];
          const now = Math.floor(Date.now() / 1000);

          // すでに同期済みの銘柄を確認
          let syncLogs: unknown[] = [];
          try {
            const res = await env.DB.prepare(
              `SELECT ticker, last_synced_at FROM sync_logs WHERE ticker IN (${tickers.map(() => "?").join(",")})`,
            )
              .bind(...tickers)
              .all();
            syncLogs = res.results;
          } catch (syncErr: unknown) {
            if (!isMissingTableError(syncErr, "sync_logs")) throw syncErr;
          }

          const lastSyncedMap = new Map(
            (syncLogs as { ticker: string; last_synced_at: unknown }[])
              .map((l) => [l.ticker, Number(l.last_synced_at)] as const)
              .filter(
                ([ticker, lastSynced]) => typeof ticker === "string" && Number.isFinite(lastSynced),
              ),
          );

          // Collect tickers that need fetching
          const toFetch: string[] = [];
          for (const ticker of tickers) {
            const lastSynced = lastSyncedMap.get(ticker);
            if (!force && lastSynced !== undefined) {
              if (lastSynced < 0) {
                const failedAt = -lastSynced;
                if (now - failedAt < SYNC_FAILURE_RETRY_SECONDS) {
                  // Do not report a failed fetch as "cached": the client would
                  // persist that status and suppress later retries despite
                  // having no fresh prices.
                  results.push({ ticker, status: "failed" });
                  continue;
                }
              } else if (lastSynced > 0 && isPriceCacheFresh(now, lastSynced)) {
                results.push({ ticker, status: "cached", lastSynced });
                continue;
              }
            }
            toFetch.push(ticker);
          }

          // Fetch in parallel batches (concurrency = 5)
          const CONCURRENCY = 5;
          for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
            const batch = toFetch.slice(i, i + CONCURRENCY);
            const batchResults = await Promise.allSettled(
              batch.map(async (ticker) => {
                const symbol = toYahooSymbol(ticker);
                const series = await fetchYahooFinance(symbol);
                if (series.length > 0) {
                  // Check if existing stock_series has identical latest data to skip expensive D1 writes
                  let shouldSkipWrite = false;
                  if (!force) {
                    try {
                      const { results: existingRows } = await env.DB.prepare(
                        "SELECT prices FROM stock_series WHERE ticker = ?",
                      )
                        .bind(ticker)
                        .all();
                      const existingPricesValue = (existingRows?.[0] as D1Row | undefined)?.prices;
                      if (typeof existingPricesValue === "string") {
                        const existingPrices: unknown = JSON.parse(existingPricesValue);
                        const normalizedExistingPrices = sanitizePriceSeries(existingPrices);
                        if (Array.isArray(existingPrices) && existingPrices.length > 0) {
                          if (
                            normalizedExistingPrices.length === series.length &&
                            normalizedExistingPrices.every(
                              (existingPoint, index) =>
                                existingPoint.date === series[index]?.date &&
                                existingPoint.close === series[index]?.close,
                            )
                          ) {
                            shouldSkipWrite = true;
                          }
                        }
                      }
                    } catch {
                      // ignore
                    }
                  }

                  if (shouldSkipWrite) {
                    // Identical data: save expensive D1 table writes by updating only sync_logs
                    try {
                      await env.DB.prepare(
                        "INSERT OR REPLACE INTO sync_logs (ticker, last_synced_at) VALUES (?, ?)",
                      )
                        .bind(ticker, now)
                        .run();
                    } catch (logErr: unknown) {
                      if (!isMissingTableError(logErr, "sync_logs")) throw logErr;
                    }
                    return { ticker, status: "cached", count: series.length, lastSynced: now };
                  }

                  // High-efficiency single-row storage in stock_series:
                  // Stores the full series JSON in 1 row (1 write) instead of 500 writes.
                  // Keep the canonical write independent from optional legacy cleanup and
                  // sync logging. A missing legacy table must not roll back a successful
                  // stock_series write and leave /api/calculate on an older series.
                  const seriesJson = JSON.stringify(series);
                  const seriesWrite = env.DB.prepare(
                    "INSERT OR REPLACE INTO stock_series (ticker, prices, updated_at) VALUES (?, ?, ?)",
                  ).bind(ticker, seriesJson, now);
                  let wroteSeries = false;
                  let canonicalBatchSucceeded = false;
                  try {
                    // Keep the normal path atomic and quota-efficient. If an
                    // optional/legacy table is missing, the fallback below
                    // retries the canonical write independently so D1's batch
                    // rollback cannot leave calculation data stale.
                    await env.DB.batch([
                      seriesWrite,
                      env.DB.prepare("DELETE FROM stock_prices WHERE ticker = ?").bind(ticker),
                      env.DB.prepare(
                        "INSERT OR REPLACE INTO sync_logs (ticker, last_synced_at) VALUES (?, ?)",
                      ).bind(ticker, now),
                    ]);
                    wroteSeries = true;
                    canonicalBatchSucceeded = true;
                  } catch (batchErr: unknown) {
                    const missingOptionalTable =
                      isMissingTableError(batchErr, "stock_series") ||
                      isMissingTableError(batchErr, "stock_prices") ||
                      isMissingTableError(batchErr, "sync_logs");
                    if (!missingOptionalTable) throw batchErr;
                    try {
                      await env.DB.prepare(
                        "INSERT OR REPLACE INTO stock_series (ticker, prices, updated_at) VALUES (?, ?, ?)",
                      )
                        .bind(ticker, seriesJson, now)
                        .run();
                      wroteSeries = true;
                    } catch (seriesErr: unknown) {
                      if (!isMissingTableError(seriesErr, "stock_series")) throw seriesErr;
                    }
                  }

                  if (wroteSeries) {
                    if (!canonicalBatchSucceeded) {
                      try {
                        await env.DB.prepare("DELETE FROM stock_prices WHERE ticker = ?")
                          .bind(ticker)
                          .run();
                      } catch (cleanupErr: unknown) {
                        if (!isMissingTableError(cleanupErr, "stock_prices")) throw cleanupErr;
                      }
                      try {
                        await env.DB.prepare(
                          "INSERT OR REPLACE INTO sync_logs (ticker, last_synced_at) VALUES (?, ?)",
                        )
                          .bind(ticker, now)
                          .run();
                      } catch (logErr: unknown) {
                        if (!isMissingTableError(logErr, "sync_logs")) throw logErr;
                      }
                    }
                    clearMemoryCache("calc:");
                    return { ticker, status: "synced", count: series.length, lastSynced: now };
                  }

                  // Fallback for an unmigrated database: use legacy chunked stock_prices.
                  const CHUNK_SIZE = 25;
                  const insertStatements: D1PreparedStatement[] = [];
                  for (let c = 0; c < series.length; c += CHUNK_SIZE) {
                    const slice = series.slice(c, c + CHUNK_SIZE);
                    const placeholders = slice.map(() => "(?, ?, ?)").join(", ");
                    const params: (string | number)[] = [];
                    for (const p of slice) {
                      params.push(ticker, p.date, p.close);
                    }
                    insertStatements.push(
                      env.DB.prepare(
                        `INSERT OR REPLACE INTO stock_prices (ticker, date, price) VALUES ${placeholders}`,
                      ).bind(...params),
                    );
                  }
                  try {
                    await env.DB.batch([
                      env.DB.prepare("DELETE FROM stock_prices WHERE ticker = ?").bind(ticker),
                      ...insertStatements,
                      env.DB.prepare(
                        "INSERT OR REPLACE INTO sync_logs (ticker, last_synced_at) VALUES (?, ?)",
                      ).bind(ticker, now),
                    ]);
                  } catch (fallbackErr: unknown) {
                    if (isMissingTableError(fallbackErr, "sync_logs")) {
                      await env.DB.batch([
                        env.DB.prepare("DELETE FROM stock_prices WHERE ticker = ?").bind(ticker),
                        ...insertStatements,
                      ]);
                    } else {
                      throw fallbackErr;
                    }
                  }
                  clearMemoryCache("calc:");
                  return { ticker, status: "synced", count: series.length, lastSynced: now };
                }
                // Record a short-lived negative cache marker. Using a positive
                // "last synced" timestamp here would falsely declare stale or
                // missing prices fresh for an entire market-cache window.
                try {
                  await env.DB.prepare(
                    "INSERT OR REPLACE INTO sync_logs (ticker, last_synced_at) VALUES (?, ?)",
                  )
                    .bind(ticker, -now)
                    .run();
                } catch (logErr: unknown) {
                  if (!isMissingTableError(logErr, "sync_logs")) throw logErr;
                }
                return { ticker, status: "failed" };
              }),
            );

            for (const [idx, r] of batchResults.entries()) {
              if (r.status === "fulfilled") {
                results.push(r.value);
              } else {
                results.push({ ticker: batch[idx], status: "failed" });
              }
            }
          }

          return json({ ok: true, results }, 200, request);
        } catch (err) {
          console.error("API Error [sync-prices]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 独自指数の計算（D1キャッシュ優先）
      if (url.pathname === "/api/calculate" && request.method === "POST") {
        try {
          const ip = getClientIp(request);
          const allowed = await checkRateLimit(env, ip, "calculate", RATE_LIMIT_MAX, false, ctx);
          if (!allowed) {
            return json({ error: "Rate limit exceeded. Please try again later." }, 429, request);
          }

          const parsedCalc = await parseJsonBody(request);
          if (!parsedCalc.ok) return parsedCalc.response;
          const body = parsedCalc.body;
          const basket = Array.isArray(body.basket) ? body.basket : [];
          const rawBaseValue = body.baseValue;
          if (
            rawBaseValue !== undefined &&
            (typeof rawBaseValue !== "number" ||
              !Number.isFinite(rawBaseValue) ||
              rawBaseValue <= 0 ||
              rawBaseValue > 1000000)
          ) {
            return json({ error: "Invalid baseValue" }, 400, request);
          }
          const baseValue = typeof rawBaseValue === "number" ? rawBaseValue : 1000;
          if (!Array.isArray(basket) || basket.length === 0) {
            return json({ error: "Invalid basket: must contain at least 1 item" }, 400, request);
          }
          if (basket.length > MAX_BASKET_ITEMS) {
            return json(
              { error: `Invalid basket: must contain at most ${MAX_BASKET_ITEMS} items` },
              400,
              request,
            );
          }

          // Strict basket validation: fail on any invalid entry. Every
          // field is mandatory: the frontend always sends a theme
          // (defaulting to "カスタム"), so a missing theme is a malformed
          // request, not an implicit default. The stock endpoints differ
          // deliberately: their single-item form predates the contract and
          // defaults an absent theme for compatibility.
          const seenCalcTickers = new Set<string>();
          for (const item of basket) {
            if (!item || typeof item !== "object") {
              return json({ error: "Invalid basket item" }, 400, request);
            }
            const r = item as Record<string, unknown>;
            if (
              typeof r.ticker !== "string" ||
              r.ticker.trim().length === 0 ||
              r.ticker.trim().length > 20 ||
              !/^[A-Za-z0-9.-]+$/.test(r.ticker.trim())
            ) {
              return json({ error: "Invalid basket item: ticker" }, 400, request);
            }
            const ticker = r.ticker.trim().toUpperCase();
            if (seenCalcTickers.has(ticker)) {
              return json({ error: `Duplicate ticker in basket: ${ticker}` }, 400, request);
            }
            seenCalcTickers.add(ticker);

            if (
              typeof r.name !== "string" ||
              r.name.trim().length === 0 ||
              r.name.trim().length > 100
            ) {
              return json({ error: "Invalid basket item: name" }, 400, request);
            }
            if (typeof r.theme !== "string" || r.theme.trim().length > 100) {
              return json({ error: "Invalid basket item: theme" }, 400, request);
            }
            if (
              typeof r.weight !== "number" ||
              !Number.isFinite(r.weight) ||
              r.weight <= 0 ||
              r.weight > 100
            ) {
              return json(
                { error: "Invalid basket item: weight must be > 0 and <= 100" },
                400,
                request,
              );
            }
          }
          const validatedBasket: BasketItemInput[] = (basket as BasketItemInput[]).map((item) => ({
            ticker: (item.ticker as string).trim().toUpperCase(),
            name: (item.name as string).trim(),
            theme: (item.theme as string).trim(),
            weight: item.weight,
          }));

          // In-memory cache check: identical basket and baseValue returns immediately,
          // saving both expensive D1 reads and calculation CPU time.
          // The response contains the full basket and stock metadata, not only
          // numerical values. Include every response-affecting basket field in
          // the cache fingerprint so a renamed ticker/theme never receives a
          // stale payload from a previous calculation.
          const calcCacheFingerprint = await generateETag(
            JSON.stringify({
              baseValue,
              basket: validatedBasket,
            }),
          );
          const calcCacheKey = `calc:${calcCacheFingerprint}`;
          const bypassCalcCache = requestsFreshCalculation(request);

          const cachedCalc = bypassCalcCache ? null : getMemoryCache<unknown>(calcCacheKey);
          if (cachedCalc) {
            return json(cachedCalc, 200, request, {
              "x-cache": "HIT",
            });
          }

          // 1. D1から全銘柄の履歴をチャンクに分けて取得 (SQL変数制限回避)
          // Note: 最新価格はD1キャッシュの最新エントリを使用。
          // Yahoo Finance v7 quote APIは認証必須のため利用不可。
          const fullStockUniverse: StockSeries[] = [];
          const tickers = validatedBasket.map((b) => b.ticker);
          const pricesByTicker = new Map<string, PricePoint[]>();

          const SQL_CHUNK_SIZE = 50;
          for (let i = 0; i < tickers.length; i += SQL_CHUNK_SIZE) {
            const chunk = tickers.slice(i, i + SQL_CHUNK_SIZE);
            try {
              const { results: seriesRows } = await env.DB.prepare(
                `SELECT ticker, prices FROM stock_series WHERE ticker IN (${chunk.map(() => "?").join(",")})`,
              )
                .bind(...chunk)
                .all();

              for (const row of seriesRows as { ticker: string; prices: string }[]) {
                if (row.ticker && row.prices) {
                  try {
                    const parsedSeries = sanitizePriceSeries(JSON.parse(row.prices));
                    if (parsedSeries.length > 0) {
                      pricesByTicker.set(row.ticker.trim().toUpperCase(), parsedSeries);
                    }
                  } catch {
                    // malformed json
                  }
                }
              }
            } catch (seriesErr: unknown) {
              if (!isMissingTableError(seriesErr, "stock_series")) throw seriesErr;
              // stock_series table might not exist yet
            }

            // Fallback to legacy stock_prices for any tickers not found in stock_series
            const missingTickers = chunk.filter((t) => !pricesByTicker.has(t));
            if (missingTickers.length > 0) {
              try {
                const { results: dbPrices } = await env.DB.prepare(
                  `
                SELECT ticker, date, price FROM stock_prices
                WHERE ticker IN (${missingTickers.map(() => "?").join(",")})
                ORDER BY date ASC
              `,
                )
                  .bind(...missingTickers)
                  .all();

                (dbPrices as { ticker: string; date: string; price: number }[]).forEach((row) => {
                  const ticker =
                    typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
                  if (!ticker) return;
                  if (!pricesByTicker.has(ticker)) pricesByTicker.set(ticker, []);
                  pricesByTicker.get(ticker)!.push({ date: row.date, close: row.price });
                });
              } catch (legacyErr: unknown) {
                if (!isMissingTableError(legacyErr, "stock_prices")) throw legacyErr;
                // legacy table might not exist yet
              }
            }
          }

          for (const [ticker, rawSeries] of pricesByTicker) {
            const series = sanitizePriceSeries(rawSeries);
            if (series.length > 0) {
              pricesByTicker.set(ticker, series);
            } else {
              pricesByTicker.delete(ticker);
            }
          }

          // 3. データを整形
          for (const item of validatedBasket) {
            const series = pricesByTicker.get(item.ticker) || [];
            fullStockUniverse.push({
              ticker: item.ticker,
              name: item.name,
              theme: item.theme,
              sector: "Unknown",
              latestPrice: series.length > 0 ? series[series.length - 1].close : 0,
              series,
            });
          }

          const series = calculateCustomIndex(validatedBasket, fullStockUniverse, baseValue);

          const responseData = {
            ok: true,
            baseValue,
            basket: validatedBasket,
            series,
            stockUniverse: fullStockUniverse,
            latest: series[series.length - 1] ?? null,
            syncStatus: {
              total: validatedBasket.length,
              found: Array.from(pricesByTicker.keys()).length,
            },
          };

          if (series.length > 0) {
            setMemoryCache(calcCacheKey, responseData, 300); // 5 minutes cache
          }

          return json(responseData, 200, request);
        } catch (err) {
          console.error("API Error [calculate]:", err);
          return json({ error: "Internal server error" }, 500, request);
        }
      }

      // 未知のAPIエンドポイントは404 JSONを返却（静的アセットへのフォールスルーを防止）
      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Endpoint not found" }, 404, request);
      }

      // 静的アセットの配信（Cloudflare Assets）
      if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
        try {
          const assetRes = await env.ASSETS.fetch(request);
          const pathname = url.pathname;
          const headers = new Headers(assetRes.headers);
          const contentType = headers.get("content-type") || "";

          // HTML は常に最新を取得させ、ハッシュ付きアセットは長期キャッシュ。
          // 判定はパスではなくレスポンスの Content-Type で行う。SPA フォールバック
          // (not_found_handling: single-page-application) は /admin のような任意の
          // ディープリンクでも index.html を返すため、パス一致では取りこぼす。
          if (contentType.includes("text/html")) {
            headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
          } else if (pathname.startsWith("/assets/")) {
            headers.set("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
          }

          headers.set("X-Content-Type-Options", "nosniff");
          headers.set("X-Frame-Options", "SAMEORIGIN");
          headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
          headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
          headers.set(
            "Content-Security-Policy",
            "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline' https://s3.tradingview.com https://*.tradingview.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.tradingview.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://s3.tradingview.com https://*.tradingview.com; frame-src 'self' https://www.tradingview-widget.com https://s.tradingview.com https://*.tradingview.com https://challenges.cloudflare.com; connect-src 'self' https://*.tradingview.com https://*.tradingview-widget.com wss://*.tradingview.com https://challenges.cloudflare.com",
          );
          headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");

          const isNullBodyStatus =
            assetRes.status === 204 || assetRes.status === 205 || assetRes.status === 304;
          return new Response(isNullBodyStatus ? null : assetRes.body, {
            status: assetRes.status,
            statusText: assetRes.statusText,
            headers,
          });
        } catch (assetErr) {
          console.error("Failed to fetch static asset from env.ASSETS:", assetErr);
          return json(
            { error: "Failed to load static asset from Cloudflare Assets" },
            502,
            request,
          );
        }
      }

      return json({ error: "Static asset handler not available" }, 404, request);
    } catch (unhandledErr) {
      console.error("Unhandled Worker error:", unhandledErr);
      return json({ error: "Internal server error" }, 500, request);
    }
  },
};
