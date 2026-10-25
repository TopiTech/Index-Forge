-- Migration: bring legacy databases up to the canonical schema.sql revision.
--
-- GENERATED FILE — do not edit. `npm run db:schema:generate` rewrites it from
-- schema.sql, which is the single source of truth.
--
-- RUN ORDER AND SAFETY:
--   1. Recommended: `npm run db:migrate:columns` (or
--      `db:migrate:columns:local`), which runs scripts/apply-migrations.mjs.
--      It probes sqlite_master and PRAGMA table_info and applies only what is
--      missing, so it is safe to re-run and safe on an already provisioned
--      database.
--   2. This file is for a legacy database that predates the current columns.
--      Run it EXACTLY ONCE, BEFORE re-applying schema.sql. Its CREATE/INDEX/DROP
--      statements are idempotent, but SQLite has no ADD COLUMN IF NOT EXISTS, so
--      a second run fails on the first column that already exists.
--   3. `schema.sql` alone is for a fresh deployment: it already contains every
--      column below.
--
-- Legacy releases stored issued passwords in plain text. Application code never
-- reads or writes `plain_password`, so scrubbing is hygiene, not functional.
-- Run it manually only when PRAGMA table_info(access_passwords) shows the
-- column (it is absent from schema.sql, so it cannot be part of this file):
--   UPDATE access_passwords SET plain_password = NULL WHERE plain_password IS NOT NULL;

-- Tables (idempotent: a database created by an older release may be missing later additions).

CREATE TABLE IF NOT EXISTS indices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    base_value REAL DEFAULT 1000,
    -- @legacy-add
    sort_order INTEGER DEFAULT 99,
    -- @legacy-add
    owner_token_hash TEXT,
    -- Unix seconds of the last owner-token issue/replacement. Owner tokens are
    -- rejected by the API once they are older than 90 days, so every path that
    -- writes owner_token_hash must also write this column.
    -- @legacy-add
    owner_token_issued_at INTEGER,
    -- @legacy-add
    creator_id TEXT,
    -- @legacy-add
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS basket_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    index_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    name TEXT NOT NULL,
    weight REAL NOT NULL,
    theme TEXT,
    FOREIGN KEY (index_id) REFERENCES indices (id) ON DELETE CASCADE,
    UNIQUE(index_id, ticker)
);

CREATE TABLE IF NOT EXISTS stock_series (
    ticker TEXT PRIMARY KEY,
    prices TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_prices (
    ticker TEXT NOT NULL,
    date TEXT NOT NULL,
    price REAL NOT NULL,
    PRIMARY KEY (ticker, date)
);

CREATE TABLE IF NOT EXISTS sync_logs (
    ticker TEXT PRIMARY KEY,
    last_synced_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    cached_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_cache (
    symbol TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    cached_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
    ip TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    request_count INTEGER DEFAULT 1,
    window_start INTEGER NOT NULL,
    PRIMARY KEY (ip, endpoint)
);

CREATE TABLE IF NOT EXISTS access_passwords (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    -- @legacy-add
    secret_code_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    max_stocks INTEGER DEFAULT 10,
    -- @legacy-add
    max_indices INTEGER DEFAULT NULL,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
    ip TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    last_failed_at INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_quota (
    ip TEXT NOT NULL,
    day TEXT NOT NULL,
    tickers INTEGER NOT NULL,
    PRIMARY KEY (ip, day)
);

-- Columns added after the first release. Run this section exactly once.

ALTER TABLE indices ADD COLUMN sort_order INTEGER DEFAULT 99;

ALTER TABLE indices ADD COLUMN owner_token_hash TEXT;

ALTER TABLE indices ADD COLUMN owner_token_issued_at INTEGER;

ALTER TABLE indices ADD COLUMN creator_id TEXT;

ALTER TABLE indices ADD COLUMN created_at INTEGER;

ALTER TABLE access_passwords ADD COLUMN secret_code_hash TEXT;

ALTER TABLE access_passwords ADD COLUMN max_indices INTEGER DEFAULT NULL;

-- Indexes (idempotent).

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);

CREATE INDEX IF NOT EXISTS idx_indices_creator_id ON indices(creator_id);

CREATE INDEX IF NOT EXISTS idx_access_passwords_created_at ON access_passwords(created_at);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_purge ON admin_login_attempts(last_failed_at, locked_until);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_account_id ON admin_sessions(account_id);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_sync_quota_day ON sync_quota(day);

-- Obsolete indexes replaced by UNIQUE(index_id, ticker) / never looked up.

DROP INDEX IF EXISTS idx_basket_items_index_id;

DROP INDEX IF EXISTS idx_access_passwords_hash;

-- Grandfathered owner tokens: record the migration time so those rows enter
-- the normal 90-day rotation window instead of an eternal exemption.
UPDATE indices SET owner_token_issued_at = CAST(strftime('%s','now') AS INTEGER) WHERE owner_token_issued_at IS NULL AND owner_token_hash IS NOT NULL;
