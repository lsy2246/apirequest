CREATE TABLE IF NOT EXISTS store_values (
    scope TEXT NOT NULL,
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL CHECK (json_valid(value)),
    PRIMARY KEY (scope, namespace, key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS history (
    id TEXT NOT NULL PRIMARY KEY,
    request_id TEXT,
    protocol TEXT NOT NULL CHECK (protocol IN ('rest', 'graphql')),
    executed_at INTEGER NOT NULL,
    entry TEXT NOT NULL CHECK (json_valid(entry)),
    starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1))
);
CREATE INDEX IF NOT EXISTS history_by_protocol ON history(protocol, executed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS history_results (
    history_id TEXT NOT NULL PRIMARY KEY REFERENCES history(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('json', 'text', 'image', 'video', 'file')),
    metadata TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
    saved_at INTEGER NOT NULL,
    cleaned_at INTEGER
);
CREATE INDEX IF NOT EXISTS history_cleanup ON history_results(cleaned_at, saved_at, kind);

CREATE TABLE IF NOT EXISTS history_files (
    id TEXT NOT NULL PRIMARY KEY,
    history_id TEXT NOT NULL REFERENCES history_results(history_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes >= 0),
    is_body INTEGER NOT NULL CHECK (is_body IN (0, 1)),
    sha256 TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS history_body ON history_files(history_id) WHERE is_body = 1;

CREATE TABLE IF NOT EXISTS pending_file_removal (id TEXT NOT NULL PRIMARY KEY) WITHOUT ROWID;
CREATE TRIGGER IF NOT EXISTS queue_history_file_removal AFTER DELETE ON history_files
BEGIN
    INSERT OR IGNORE INTO pending_file_removal(id) VALUES (OLD.id);
END;

CREATE TABLE IF NOT EXISTS history_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    auto_cleanup INTEGER NOT NULL DEFAULT 0 CHECK (auto_cleanup IN (0, 1)),
    retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 36500),
    last_auto_cleanup INTEGER,
    last_cleanup_at INTEGER,
    last_cleanup_count INTEGER,
    last_cleanup_bytes INTEGER
);
INSERT OR IGNORE INTO history_policy(id) VALUES(1);

CREATE TABLE IF NOT EXISTS history_cleanup_exclusions (
    request_id TEXT NOT NULL PRIMARY KEY
) WITHOUT ROWID;
