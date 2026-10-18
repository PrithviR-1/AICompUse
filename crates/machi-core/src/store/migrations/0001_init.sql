-- Machi schema v1: conversations, message trees, attachments, settings, model cache, telemetry.

CREATE TABLE conversations (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT '',
    title_source    TEXT NOT NULL DEFAULT 'auto',
    pinned          INTEGER NOT NULL DEFAULT 0,
    temporary       INTEGER NOT NULL DEFAULT 0,
    current_leaf_id TEXT,
    compare_json    TEXT,
    settings_json   TEXT NOT NULL DEFAULT '{}',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX conversations_updated ON conversations(temporary, pinned, updated_at);

-- Messages form a tree per conversation: edits and regenerations create siblings.
CREATE TABLE messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    parent_id       TEXT REFERENCES messages(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL DEFAULT '',
    model_key       TEXT,
    status          TEXT NOT NULL,
    error_json      TEXT,
    tokens_in       INTEGER,
    tokens_out      INTEGER,
    cost_usd        REAL,
    elapsed_ms      INTEGER,
    created_at      INTEGER NOT NULL
);
CREATE INDEX messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX messages_parent ON messages(parent_id);

CREATE TABLE attachments (
    id         TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    name       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    data       TEXT NOT NULL
);
CREATE INDEX attachments_message ON attachments(message_id, position);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Live model IDs per provider (§11.4): cached 24 h; first_seen_at drives the "NEW" badge.
CREATE TABLE model_cache (
    provider      TEXT NOT NULL,
    id            TEXT NOT NULL,
    owned_by      TEXT,
    first_seen_at INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    PRIMARY KEY (provider, id)
);

CREATE TABLE model_cache_meta (
    provider   TEXT PRIMARY KEY,
    fetched_at INTEGER NOT NULL
);

-- Local-only request metrics (§1.3 telemetry). No message content, no keys.
CREATE TABLE telemetry (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    model_key  TEXT,
    tokens_in  INTEGER,
    tokens_out INTEGER,
    cost_usd   REAL,
    ms         INTEGER,
    ok         INTEGER NOT NULL,
    error_kind TEXT
);
