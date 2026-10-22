CREATE TABLE IF NOT EXISTS indices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    base_value REAL DEFAULT 1000,
    sort_order INTEGER DEFAULT 99,
    owner_token_hash TEXT,
    -- Unix seconds of the last owner-token issue/replacement. Owner tokens are
    -- rejected by the API once they are older than 90 days, so every path that
    -- writes owner_token_hash must also write this column.
    owner_token_issued_at INTEGER,
    creator_id TEXT,
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

-- The Worker purges expired windows with
--   DELETE FROM rate_limits WHERE window_start < ?
-- which is a full table scan without this index. The table grows with the
-- number of distinct client IPs of a public deployment, and the purge runs on
-- a write-quota-limited D1 database.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);

-- (index_id) is already covered by UNIQUE(index_id, ticker); a separate index
-- only duplicates that prefix and adds a write per basket row.
CREATE INDEX IF NOT EXISTS idx_indices_creator_id ON indices(creator_id);

CREATE TABLE IF NOT EXISTS access_passwords (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    secret_code_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    max_stocks INTEGER DEFAULT 10,
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
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_purge ON admin_login_attempts(last_failed_at, locked_until);

-- Short-lived administrator sessions. Only the SHA-256 of the bearer token is
-- stored, so a database leak does not yield usable admin credentials.
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_account_id ON admin_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

-- Per-IP, per-UTC-day budget for /api/sync-prices. The endpoint is
-- unauthenticated and each ticker costs an external fetch plus D1 writes, so it
-- needs a bound that survives isolate restarts (unlike the in-memory limiter).
CREATE TABLE IF NOT EXISTS sync_quota (
    ip TEXT NOT NULL,
    day TEXT NOT NULL,
    tickers INTEGER NOT NULL,
    PRIMARY KEY (ip, day)
);

CREATE INDEX IF NOT EXISTS idx_sync_quota_day ON sync_quota(day);

