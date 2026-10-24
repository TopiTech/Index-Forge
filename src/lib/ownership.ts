/**
 * Single-key owner-token store (`custom_index_owners`).
 *
 * SEC-08: an owner token used to be valid forever. The Worker now stores
 * `owner_token_issued_at` and rejects a token older than 90 days with a 403, so
 * the client has to know the age of its own tokens as well:
 *
 * - values are `{ token, issuedAt }` objects;
 * - a legacy string value (written by an older build) is read as
 *   `issuedAt = now` and rewritten in the new shape;
 * - `getIndexOwnerToken` returns `null` and prunes entries older than 90 days,
 *   so an expired token is never sent (which would only produce a 403).
 *
 * Everything stays behind this module (one localStorage key, one shape), so no
 * caller can read or write the store directly.
 */

const STORAGE_KEY = "custom_index_owners";

/** SEC-08: owner tokens expire 90 days after they were issued. */
export const OWNER_TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

interface OwnerEntry {
  token: string;
  /** Epoch milliseconds at which the token was issued/saved. */
  issuedAt: number;
}

interface OwnerStore {
  [indexId: string]: OwnerEntry;
}

/** Raw shape read from storage: the current object form or a legacy string. */
type RawOwnerStore = Record<string, unknown>;

function getEmptyStore(): OwnerStore {
  return Object.create(null);
}

/**
 * Write one owner entry as an own data property.
 *
 * `Object.defineProperty` is used instead of a plain assignment because an
 * assignment to `__proto__` on an object that *does* inherit from
 * `Object.prototype` would invoke the inherited setter and mutate the
 * prototype chain. `defineProperty` always creates an own property, so even
 * an index id of `__proto__` — which the Worker's id rule allows — stays an
 * ordinary entry.
 */
function defineOwnerEntry(store: OwnerStore, indexId: string, entry: OwnerEntry): void {
  Object.defineProperty(store, indexId, {
    value: entry,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function getSafeStorage(): Storage | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    return storage && typeof storage.getItem === "function" ? storage : null;
  } catch {
    return null;
  }
}

/**
 * Read the store and convert it to the current shape.
 *
 * Returns the store plus whether anything changed (a legacy string was
 * migrated, or an expired entry was pruned) so the caller can persist the
 * normalized copy.
 */
function readStore(now: number): { store: OwnerStore; changed: boolean } {
  const store = getEmptyStore();
  const storage = getSafeStorage();
  if (!storage) return { store, changed: false };
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { store, changed: false };
  }
  if (!raw) return { store, changed: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { store, changed: false };
  }
  // Corrupted or tampered storage ("null", "5", "[]", quoted strings) must
  // degrade to an empty store instead of throwing on later property access.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { store, changed: false };
  }

  let changed = false;
  for (const [key, value] of Object.entries(parsed as RawOwnerStore)) {
    // Index ids are validated by the Worker against `^[A-Za-z0-9._-]+$`, so
    // `constructor` and `prototype` are legal ids and their owner tokens have
    // to survive a save/read round trip. The previous guard dropped exactly
    // those ids on read while accepting them on write, so the creator of such
    // an index silently lost the ownership rights to it.
    //
    // `__proto__` is a legal id as well, so it cannot simply be skipped
    // either. The store is a null-prototype object and every write goes
    // through `Object.defineProperty`, which creates an own data property
    // instead of invoking an inherited setter — so none of these ids can
    // reach `Object.prototype`.
    if (key.length === 0) continue;

    const entry = parseEntry(value, now);
    if (!entry) {
      changed = true;
      continue;
    }
    if (entry.migrated) changed = true;
    if (now - entry.entry.issuedAt > OWNER_TOKEN_MAX_AGE_MS) {
      // Expired: the Worker would answer 403, so the entry is dropped here.
      changed = true;
      continue;
    }
    defineOwnerEntry(store, key, entry.entry);
  }
  return { store, changed };
}

/**
 * Normalize one stored value.
 *
 * A legacy `string` value predates `issuedAt`; it is read as issued now (the
 * Worker keeps accepting it for its own remaining lifetime) and rewritten.
 */
function parseEntry(
  value: unknown,
  now: number,
): { entry: OwnerEntry; migrated: boolean } | null {
  if (typeof value === "string") {
    return value ? { entry: { token: value, issuedAt: now }, migrated: true } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const token = typeof record.token === "string" ? record.token : "";
  if (!token) return null;
  let issuedAt =
    typeof record.issuedAt === "number" && Number.isFinite(record.issuedAt) && record.issuedAt > 0
      ? record.issuedAt
      : now;
  if (issuedAt > 0 && issuedAt < 1e11) {
    issuedAt = issuedAt * 1000;
  }
  return {
    entry: { token, issuedAt },
    // A missing/invalid or unmigrated seconds-based issuedAt is repaired on the next write.
    migrated:
      !(typeof record.issuedAt === "number" && Number.isFinite(record.issuedAt)) ||
      (typeof record.issuedAt === "number" && record.issuedAt < 1e11),
  };
}

function setStore(store: OwnerStore): void {
  const storage = getSafeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota/storage errors
  }
}

/** Read the normalized store, persisting migrations and pruned entries once. */
function getStore(now: number = Date.now()): OwnerStore {
  const { store, changed } = readStore(now);
  if (changed) setStore(store);
  return store;
}

/**
 * Save an owner token for a custom index. The issue time is recorded so the
 * token can expire (SEC-08).
 */
export function saveIndexOwnerToken(indexId: string, token: string, issuedAt?: number): void {
  if (!indexId || !token) return;
  const now = Date.now();
  const store = getStore(now);
  let resolvedIssuedAt = now;
  if (typeof issuedAt === "number" && Number.isFinite(issuedAt) && issuedAt > 0) {
    resolvedIssuedAt = issuedAt < 1e11 ? issuedAt * 1000 : issuedAt;
  }
  defineOwnerEntry(store, indexId, {
    token,
    issuedAt: resolvedIssuedAt,
  });
  setStore(store);
}

/**
 * Retrieve the owner token for a custom index.
 *
 * Returns `null` when the token is missing or older than 90 days; the expired
 * entry is pruned from storage.
 */
export function getIndexOwnerToken(indexId: string): string | null {
  if (!indexId) return null;
  const now = Date.now();
  const { store, changed } = readStore(now);
  if (changed) setStore(store);
  const entry = store[indexId];
  if (!entry) return null;
  if (now - entry.issuedAt > OWNER_TOKEN_MAX_AGE_MS) return null;
  return entry.token;
}

/**
 * Remove an owner token for a custom index.
 */
export function removeIndexOwnerToken(indexId: string): void {
  if (!indexId) return;
  const store = getStore();
  if (!(indexId in store)) return;
  delete store[indexId];
  setStore(store);
}

/**
 * Check whether the current browser is the owner/creator of the index.
 * An expired token no longer makes this browser the owner.
 */
export function isIndexOwner(indexId: string): boolean {
  if (!indexId) return false;
  return getIndexOwnerToken(indexId) !== null;
}
