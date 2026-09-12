/**
 * Schema migrations.
 *
 * Each migration is a version number and a block of SQL, applied in order
 * inside a transaction. `schema_migrations` records what has run, so opening
 * an existing database only applies what is new.
 *
 * Never edit a migration that has shipped. Add another one.
 *
 * @module
 */

/**
 * @typedef {Object} Migration
 * @property {number} version
 * @property {string} name
 * @property {string} sql
 */

const INITIAL = `
-- ---------------------------------------------------------------------------
-- sessions: one conversation, grouped from many independent API calls.
-- Grouping happens in core (WIRE-FORMATS section 5); this table just holds it.
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  tool                TEXT,
  provider            TEXT,
  api_format          TEXT,
  model               TEXT,
  session_tag         TEXT,
  transport           TEXT,

  project_path        TEXT,
  project_name        TEXT,

  started_at          INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL,
  started_day         TEXT NOT NULL,

  turn_count          INTEGER NOT NULL DEFAULT 0,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER NOT NULL DEFAULT 0,

  peak_context_tokens INTEGER NOT NULL DEFAULT 0,
  context_limit       INTEGER,

  cost_usd            REAL NOT NULL DEFAULT 0,
  equivalent_cost_usd REAL NOT NULL DEFAULT 0,
  billing_mode        TEXT NOT NULL DEFAULT 'unknown',

  main_agent_key      TEXT,
  fingerprint         TEXT
);

CREATE INDEX sessions_last_seen  ON sessions(last_seen_at DESC);
CREATE INDEX sessions_day        ON sessions(started_day);
CREATE INDEX sessions_project    ON sessions(project_path);
CREATE INDEX sessions_tool       ON sessions(tool);
CREATE INDEX sessions_fingerprint ON sessions(fingerprint);

-- ---------------------------------------------------------------------------
-- turns: one captured API request/response pair.
-- id is the capture id, which makes re-ingesting the same file a no-op.
-- ---------------------------------------------------------------------------
CREATE TABLE turns (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq                 INTEGER NOT NULL,

  captured_at         INTEGER NOT NULL,
  captured_day        TEXT NOT NULL,
  tool                TEXT,
  provider            TEXT,
  api_format          TEXT,
  model               TEXT,
  transport           TEXT,

  status              INTEGER,
  streaming           INTEGER NOT NULL DEFAULT 0,
  stop_reason         TEXT,

  -- What the provider billed us for.
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
  thinking_tokens     INTEGER NOT NULL DEFAULT 0,

  -- What was in the window. These three must sum to context_tokens; core
  -- rescales them against the provider's real count before they get here.
  context_tokens      INTEGER NOT NULL DEFAULT 0,
  system_tokens       INTEGER NOT NULL DEFAULT 0,
  tools_tokens        INTEGER NOT NULL DEFAULT 0,
  messages_tokens     INTEGER NOT NULL DEFAULT 0,

  cost_usd            REAL NOT NULL DEFAULT 0,
  equivalent_cost_usd REAL NOT NULL DEFAULT 0,

  agent_key           TEXT,
  is_subagent         INTEGER NOT NULL DEFAULT 0,

  first_byte_ms       INTEGER,
  completed_ms        INTEGER,
  request_bytes       INTEGER,
  response_bytes      INTEGER
);

CREATE INDEX turns_session ON turns(session_id, seq);
CREATE INDEX turns_day     ON turns(captured_day);
CREATE INDEX turns_time    ON turns(captured_at DESC);
CREATE INDEX turns_model   ON turns(model);

-- ---------------------------------------------------------------------------
-- blocks: the atomic unit of context — one text, tool call, result or image.
--
-- Stored once per session, not once per turn. Agents resend the entire history
-- every turn, so a 50-turn session would otherwise store the same 60K-token
-- npm log fifty times. Deduplicating by hash is what makes "this result has
-- been re-sent 34 times" a COUNT(*) instead of a scan.
-- ---------------------------------------------------------------------------
CREATE TABLE blocks (
  id                  INTEGER PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  hash                TEXT NOT NULL,

  role                TEXT,
  block_type          TEXT,
  category            TEXT NOT NULL,

  tool_name           TEXT,
  tool_use_id         TEXT,
  file_path           TEXT,
  mcp_server          TEXT,

  tokens              INTEGER NOT NULL DEFAULT 0,
  chars               INTEGER NOT NULL DEFAULT 0,
  is_image            INTEGER NOT NULL DEFAULT 0,

  text                TEXT,
  preview             TEXT,

  first_seen_turn     TEXT REFERENCES turns(id) ON DELETE SET NULL,
  first_seen_at       INTEGER NOT NULL,
  UNIQUE(session_id, hash)
);

CREATE INDEX blocks_session   ON blocks(session_id);
CREATE INDEX blocks_category  ON blocks(session_id, category);
CREATE INDEX blocks_tool      ON blocks(session_id, tool_name);
CREATE INDEX blocks_mcp       ON blocks(session_id, mcp_server);
CREATE INDEX blocks_file      ON blocks(session_id, file_path);

-- Which blocks were in which turn, and in what order. The row count per block
-- is exactly "how many turns re-sent this".
CREATE TABLE turn_blocks (
  turn_id             TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  block_id            INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  message_index       INTEGER NOT NULL,
  PRIMARY KEY (turn_id, position)
);

CREATE INDEX turn_blocks_block ON turn_blocks(block_id);

-- ---------------------------------------------------------------------------
-- composition: the 11 categories, per turn. WIRE-FORMATS section 7.
-- ---------------------------------------------------------------------------
CREATE TABLE composition (
  turn_id             TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  category            TEXT NOT NULL,
  tokens              INTEGER NOT NULL DEFAULT 0,
  percent             REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (turn_id, category)
);

-- ---------------------------------------------------------------------------
-- system_segments: the system prompt split into pieces the user can act on —
-- base prompt, CLAUDE.md, one row per MCP server, skills.
-- ---------------------------------------------------------------------------
CREATE TABLE system_segments (
  id                  INTEGER PRIMARY KEY,
  turn_id             TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  label               TEXT NOT NULL,
  tokens              INTEGER NOT NULL DEFAULT 0,
  position            INTEGER NOT NULL DEFAULT 0,
  hash                TEXT,
  preview             TEXT
);

CREATE INDEX system_segments_turn    ON system_segments(turn_id);
CREATE INDEX system_segments_session ON system_segments(session_id, kind);

-- ---------------------------------------------------------------------------
-- attribution: tokens and money traced to a named thing the user controls.
-- ---------------------------------------------------------------------------
CREATE TABLE attribution (
  id                  INTEGER PRIMARY KEY,
  turn_id             TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  entity_type         TEXT NOT NULL,
  entity_name         TEXT NOT NULL,
  tokens              INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL NOT NULL DEFAULT 0,
  calls               INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX attribution_turn    ON attribution(turn_id);
CREATE INDEX attribution_session ON attribution(session_id, entity_type, entity_name);

-- ---------------------------------------------------------------------------
-- findings: what the rules engine concluded. Deterministic, so a finding can
-- always be recomputed — this table is a cache with a fix string attached.
-- ---------------------------------------------------------------------------
CREATE TABLE findings (
  id                  INTEGER PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  rule                TEXT NOT NULL,
  severity            TEXT NOT NULL DEFAULT 'info',
  title               TEXT NOT NULL,
  detail              TEXT,
  fix                 TEXT,
  wasted_tokens       INTEGER NOT NULL DEFAULT 0,
  wasted_cost_usd     REAL NOT NULL DEFAULT 0,
  evidence            TEXT,
  created_at          INTEGER NOT NULL,
  UNIQUE(session_id, rule, title)
);

CREATE INDEX findings_session ON findings(session_id);
CREATE INDEX findings_waste   ON findings(wasted_cost_usd DESC);

-- ---------------------------------------------------------------------------
-- Full-text search over block text. External-content table: FTS5 stores only
-- the index and reads the text back from blocks, so nothing is duplicated.
-- The triggers keep the two in step.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE blocks_fts USING fts5(
  text,
  content='blocks',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER blocks_fts_insert AFTER INSERT ON blocks BEGIN
  INSERT INTO blocks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER blocks_fts_delete AFTER DELETE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER blocks_fts_update AFTER UPDATE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO blocks_fts(rowid, text) VALUES (new.id, new.text);
END;
`

const PRICING = `
-- ---------------------------------------------------------------------------
-- model_prices: the live price table, refreshed from models.dev.
--
-- It lives here rather than in a second JSON file because ARCHITECTURE.md is
-- explicit that ~/.contextlab holds one database and nothing else that needs
-- querying. Prices are USD per million tokens.
-- ---------------------------------------------------------------------------
CREATE TABLE model_prices (
  provider     TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  input        REAL NOT NULL,
  output       REAL NOT NULL DEFAULT 0,
  cache_read   REAL,
  cache_write  REAL,
  context      INTEGER,
  max_output   INTEGER,
  PRIMARY KEY (provider, model_id)
);

CREATE INDEX model_prices_model ON model_prices(model_id);

-- One row, holding where the table came from and when. The UI stamps every
-- cost figure with this date rather than implying the price is current.
CREATE TABLE pricing_meta (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  updated_at   TEXT NOT NULL,
  source       TEXT NOT NULL,
  unit         TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL
);
`

const ATTRIBUTION_BREAKDOWN = `
-- Split attributed tokens by where they came from. The distinction is the
-- product: a server whose tokens are ALL definitions and whose call count is
-- zero is pure waste, while the same total spent on results is work you asked
-- for.
ALTER TABLE attribution ADD COLUMN definition_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attribution ADD COLUMN call_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attribution ADD COLUMN result_tokens INTEGER NOT NULL DEFAULT 0;
`

const BLOCK_ESTIMATE = `
-- What we counted in this block's own text, as distinct from its share of what
-- the provider billed for the whole turn. Showing the share beside the text is
-- how a 19-character message came to be labelled 69 tokens.
ALTER TABLE blocks ADD COLUMN tokens_estimated INTEGER NOT NULL DEFAULT 0;
`

/** @type {Migration[]} */
export const MIGRATIONS = [
  { version: 1, name: 'initial schema', sql: INITIAL },
  { version: 2, name: 'model prices', sql: PRICING },
  { version: 3, name: 'attribution breakdown', sql: ATTRIBUTION_BREAKDOWN },
  { version: 4, name: 'estimated block tokens', sql: BLOCK_ESTIMATE },
]

/**
 * Apply every migration that has not run yet.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {number[]} versions applied by this call
 */
export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => /** @type {{ version: number }} */ (row).version),
  )

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  )

  /** @type {number[]} */
  const ran = []
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    // Each migration is all or nothing: a half-applied schema is worse than
    // no schema, because the next open would skip the rest of it.
    db.transaction(() => {
      db.exec(migration.sql)
      record.run(migration.version, migration.name, Date.now())
    })()
    ran.push(migration.version)
  }
  return ran
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {number} highest applied version, 0 if none
 */
export function schemaVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
  return /** @type {{ version: number | null }} */ (row)?.version ?? 0
}
