-- Migration: bring legacy databases up to the canonical schema.sql revision.
--
-- RUN ORDER AND SAFETY:
--   1. Fresh deployments: run schema.sql ONLY. It already contains every
--      column below. Do NOT run this file afterwards (SQLite has no
--      IF NOT EXISTS for ALTER TABLE ADD COLUMN, so re-adding an existing
--      column aborts the whole D1 batch -- the file is intentionally once-only).
--   2. Legacy databases (created before owner_token_hash/created_at/creator_id
--      /max_indices existed): run this file EXACTLY ONCE, BEFORE any fresh
--      schema.sql re-application. Verify missing columns first with:
--        SELECT sql FROM sqlite_master WHERE name IN ('indices','access_passwords');
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

-- Legacy releases stored issued passwords in plain text. Scrub those values
-- before enabling the password-management API on an existing database.
-- Keep the legacy column for compatibility with old schemas; application code
-- must never read from or write to it.
--
-- OPT-IN: uncomment the next line ONLY if PRAGMA table_info(access_passwords)
-- shows a plain_password column. It is absent from schema.sql and from many
-- intermediate revisions; running it unconditionally aborts this migration.
-- UPDATE access_passwords SET plain_password = NULL WHERE plain_password IS NOT NULL;
