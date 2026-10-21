-- Migration: bring legacy databases up to the canonical schema.sql revision.
--
-- RUN ORDER AND SAFETY:
--   1. Recommended: use `npm run db:migrate:columns` (or `db:migrate:columns:local`),
--      which executes scripts/apply-migrations.mjs to probe table_info and apply
--      only missing columns/tables/indexes idempotently without duplicate column errors.
--   2. Direct raw SQL execution:
--      - Fresh deployments: run schema.sql ONLY. It already contains every column below.
--      - Legacy databases: run this file EXACTLY ONCE, BEFORE any fresh schema.sql re-application.
--   3. The plaintext-password scrub at the bottom is OPT-IN (uncomment only
--      when that legacy column exists). Application code never reads or
--      writes plain_password, so scrubbing is hygiene, not functional, and it
--      must not abort the structural migration on databases that never had it.

-- Legacy releases lacked these indices columns.
-- SQLite does not support IF NOT EXISTS in ALTER TABLE ADD COLUMN.
ALTER TABLE indices ADD COLUMN owner_token_hash TEXT;
ALTER TABLE indices ADD COLUMN created_at INTEGER;
ALTER TABLE indices ADD COLUMN sort_order INTEGER DEFAULT 99;

-- Migration: Add max_indices to access_passwords and creator_id to indices table
ALTER TABLE access_passwords ADD COLUMN max_indices INTEGER DEFAULT NULL;
ALTER TABLE indices ADD COLUMN creator_id TEXT;
CREATE INDEX IF NOT EXISTS idx_indices_creator_id ON indices(creator_id);

-- Migration: owner tokens are no longer valid forever. Every write that sets
-- owner_token_hash must also set owner_token_issued_at. Rows migrated here had
-- no issue date, so the API treats a missing date as "grandfathered" and keeps
-- them usable; the backfill below records the migration time so those rows
-- enter the normal rotation window instead of an eternal exemption.
ALTER TABLE indices ADD COLUMN owner_token_issued_at INTEGER;
UPDATE indices
   SET owner_token_issued_at = CAST(strftime('%s','now') AS INTEGER)
 WHERE owner_token_issued_at IS NULL
   AND owner_token_hash IS NOT NULL;

-- Migration: Add admin_login_attempts table and secret_code_hash to access_passwords.
CREATE TABLE IF NOT EXISTS admin_login_attempts (
    ip TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    last_failed_at INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0
);
-- Note: the Worker automatically provisions secret_code_hash at runtime via ensurePasswordTable(),
-- but if applying migrations manually to a pre-existing database lacking the column, uncomment:
-- ALTER TABLE access_passwords ADD COLUMN secret_code_hash TEXT;

-- Migration: administrator 2FA sessions (only the SHA-256 of the token is stored).
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_account_id ON admin_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

-- Migration: per-IP daily ticker budget for the unauthenticated /api/sync-prices.
CREATE TABLE IF NOT EXISTS sync_quota (
    ip TEXT NOT NULL,
    day TEXT NOT NULL,
    tickers INTEGER NOT NULL,
    PRIMARY KEY (ip, day)
);
CREATE INDEX IF NOT EXISTS idx_sync_quota_day ON sync_quota(day);

-- Migration: the expired-window purge of rate_limits filters on window_start,
-- which the (ip, endpoint) primary key does not cover. Without this index the
-- purge is a full table scan on a write-quota-limited database.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);

-- Migration: drop indexes that only duplicated an existing one. idx_basket_items_index_id
-- repeats the prefix of UNIQUE(index_id, ticker); idx_access_passwords_hash backed a
-- lookup that is never used (password hashes are salted, so they are never searched).
DROP INDEX IF EXISTS idx_basket_items_index_id;
DROP INDEX IF EXISTS idx_access_passwords_hash;


-- Legacy releases stored issued passwords in plain text. Scrub those values
-- before enabling the password-management API on an existing database.
-- Keep the legacy column for compatibility with old schemas; application code
-- must never read from or write to it.
--
-- OPT-IN: uncomment the next line ONLY if PRAGMA table_info(access_passwords)
-- shows a plain_password column. It is absent from schema.sql and from many
-- intermediate revisions; running it unconditionally aborts this migration.
-- UPDATE access_passwords SET plain_password = NULL WHERE plain_password IS NOT NULL;
