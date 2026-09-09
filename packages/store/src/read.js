/**
 * The read path: everything the CLI and the dashboard ask for.
 *
 * @module
 */

/** @typedef {import('better-sqlite3').Database} Db */

/**
 * better-sqlite3 types every row as `unknown`, because it cannot know your
 * schema. We do know it, so the cast lives here once instead of at every call
 * site. Column names are still unchecked — that is what the tests are for.
 *
 * @param {Db} db
 * @param {string} sql
 * @returns {import('better-sqlite3').Statement<any[], Record<string, unknown>>}
 */
function prepare(db, sql) {
  return /** @type {any} */ (db.prepare(sql))
}

/**
 * Escape a user's search string for FTS5.
 *
 * FTS5 MATCH has its own syntax, so an unescaped apostrophe or a stray `*`
 * throws a parse error at the user instead of finding their text. Quoting each
 * bare word makes the whole thing a literal AND-of-terms.
 *
 * @param {string} query
 * @returns {string}
 */
export function escapeFtsQuery(query) {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
  return terms.join(' ')
}

/**
 * Full-text search across captured content.
 *
 * @param {Db} db
 * @param {string} query
 * @param {{ limit?: number, sessionId?: string, category?: string }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function searchBlocks(db, query, options = {}) {
  const match = escapeFtsQuery(query)
  if (!match) return []

  return prepare(
    db,
    `
      SELECT
        b.id, b.session_id, b.category, b.role, b.tool_name, b.file_path,
        b.tokens, b.first_seen_at,
        s.tool, s.project_name, s.model,
        snippet(blocks_fts, 0, '[', ']', ' … ', 24) AS snippet,
        (SELECT COUNT(*) FROM turn_blocks tb WHERE tb.block_id = b.id) AS resent_turns
      FROM blocks_fts
      JOIN blocks   b ON b.id = blocks_fts.rowid
      JOIN sessions s ON s.id = b.session_id
      WHERE blocks_fts MATCH @match
        AND (@sessionId IS NULL OR b.session_id = @sessionId)
        AND (@category  IS NULL OR b.category   = @category)
      ORDER BY bm25(blocks_fts), b.first_seen_at DESC
      LIMIT @limit
    `,
  ).all({
    match,
    sessionId: options.sessionId ?? null,
    category: options.category ?? null,
    limit: options.limit ?? 50,
  })
}

/**
 * Sessions, newest first, for the sessions screen.
 *
 * @param {Db} db
 * @param {{ limit?: number, offset?: number, tool?: string, project?: string,
 *           since?: number }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function listSessions(db, options = {}) {
  return prepare(
    db,
    `
      SELECT s.*,
        (SELECT COUNT(*) FROM findings f WHERE f.session_id = s.id) AS finding_count,
        (SELECT COALESCE(SUM(f.wasted_cost_usd), 0) FROM findings f
          WHERE f.session_id = s.id) AS wasted_cost_usd
      FROM sessions s
      WHERE (@tool    IS NULL OR s.tool = @tool)
        AND (@project IS NULL OR s.project_path = @project)
        AND (@since   IS NULL OR s.last_seen_at >= @since)
      ORDER BY s.last_seen_at DESC
      LIMIT @limit OFFSET @offset
    `,
  ).all({
    tool: options.tool ?? null,
    project: options.project ?? null,
    since: options.since ?? null,
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
  })
}

/**
 * @param {Db} db
 * @param {string} sessionId
 * @returns {Record<string, unknown> | undefined}
 */
export function getSession(db, sessionId) {
  return /** @type {Record<string, unknown> | undefined} */ (
    prepare(db, 'SELECT * FROM sessions WHERE id = ?').get(sessionId)
  )
}

/**
 * @param {Db} db
 * @param {string} sessionId
 * @returns {Record<string, unknown>[]}
 */
export function listTurns(db, sessionId) {
  return prepare(db, 'SELECT * FROM turns WHERE session_id = ? ORDER BY seq').all(
    sessionId,
  )
}

/**
 * Composition for one turn, or summed across a session.
 *
 * @param {Db} db
 * @param {{ turnId?: string, sessionId?: string }} scope
 * @returns {Record<string, unknown>[]}
 */
export function getComposition(db, scope) {
  if (scope.turnId) {
    return prepare(
      db,
      'SELECT category, tokens, percent FROM composition WHERE turn_id = ? ORDER BY tokens DESC',
    ).all(scope.turnId)
  }
  return prepare(
    db,
    `
      SELECT c.category, SUM(c.tokens) AS tokens
      FROM composition c
      JOIN turns t ON t.id = c.turn_id
      WHERE t.session_id = ?
      GROUP BY c.category
      ORDER BY tokens DESC
    `,
  ).all(scope.sessionId)
}

/**
 * Blocks that keep being re-sent — the raw material for the biggest win the
 * product offers. A tool result that is large and present in many turns is
 * being paid for on every one of them.
 *
 * @param {Db} db
 * @param {string} sessionId
 * @param {{ minTurns?: number, minTokens?: number, limit?: number }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function findRepeatedBlocks(db, sessionId, options = {}) {
  return prepare(
    db,
    `
      SELECT
        b.id, b.category, b.tool_name, b.file_path, b.tokens, b.preview,
        COUNT(tb.turn_id)              AS turns_present,
        b.tokens * COUNT(tb.turn_id)   AS tokens_resent
      FROM blocks b
      JOIN turn_blocks tb ON tb.block_id = b.id
      WHERE b.session_id = @sessionId
      GROUP BY b.id
      HAVING turns_present >= @minTurns AND b.tokens >= @minTokens
      ORDER BY tokens_resent DESC
      LIMIT @limit
    `,
  ).all({
    sessionId,
    minTurns: options.minTurns ?? 2,
    minTokens: options.minTokens ?? 1000,
    limit: options.limit ?? 20,
  })
}

/**
 * Spend per day, for `contextlab cost`.
 *
 * @param {Db} db
 * @param {{ days?: number, project?: string }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function costByDay(db, options = {}) {
  return prepare(
    db,
    `
      SELECT
        t.captured_day                   AS day,
        COUNT(*)                         AS turns,
        COUNT(DISTINCT t.session_id)     AS sessions,
        SUM(t.input_tokens)              AS input_tokens,
        SUM(t.output_tokens)             AS output_tokens,
        SUM(t.cache_read_tokens)         AS cache_read_tokens,
        SUM(t.cost_usd)                  AS cost_usd,
        SUM(t.equivalent_cost_usd)       AS equivalent_cost_usd
      FROM turns t
      JOIN sessions s ON s.id = t.session_id
      WHERE (@project IS NULL OR s.project_path = @project)
      GROUP BY t.captured_day
      ORDER BY day DESC
      LIMIT @days
    `,
  ).all({ project: options.project ?? null, days: options.days ?? 30 })
}

/**
 * Spend per project, for `contextlab cost --by project`.
 *
 * @param {Db} db
 * @param {{ limit?: number }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function costByProject(db, options = {}) {
  return prepare(
    db,
    `
      SELECT
        COALESCE(s.project_name, s.project_path, '(unknown)') AS project,
        s.project_path,
        COUNT(DISTINCT s.id)             AS sessions,
        SUM(s.turn_count)                AS turns,
        SUM(s.cost_usd)                  AS cost_usd,
        SUM(s.equivalent_cost_usd)       AS equivalent_cost_usd
      FROM sessions s
      GROUP BY project
      ORDER BY equivalent_cost_usd DESC
      LIMIT @limit
    `,
  ).all({ limit: options.limit ?? 50 })
}

/**
 * Cost traced to named things — MCP servers, tools, files.
 *
 * @param {Db} db
 * @param {string} sessionId
 * @param {{ entityType?: string, limit?: number }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function attributionFor(db, sessionId, options = {}) {
  return prepare(
    db,
    `
      SELECT entity_type, entity_name,
        SUM(tokens)   AS tokens,
        SUM(cost_usd) AS cost_usd,
        SUM(calls)    AS calls
      FROM attribution
      WHERE session_id = @sessionId
        AND (@entityType IS NULL OR entity_type = @entityType)
      GROUP BY entity_type, entity_name
      ORDER BY cost_usd DESC, tokens DESC
      LIMIT @limit
    `,
  ).all({
    sessionId,
    entityType: options.entityType ?? null,
    limit: options.limit ?? 50,
  })
}

/**
 * @param {Db} db
 * @param {string} [sessionId] omit for every session, ranked by waste
 * @param {{ limit?: number }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function listFindings(db, sessionId, options = {}) {
  return prepare(
    db,
    `
      SELECT f.*, s.tool, s.project_name, s.model
      FROM findings f
      JOIN sessions s ON s.id = f.session_id
      WHERE (@sessionId IS NULL OR f.session_id = @sessionId)
      ORDER BY f.wasted_cost_usd DESC, f.wasted_tokens DESC
      LIMIT @limit
    `,
  ).all({ sessionId: sessionId ?? null, limit: options.limit ?? 50 })
}

/**
 * The system prompt broken into pieces, for the panel on the overview screen.
 *
 * @param {Db} db
 * @param {string} turnId
 * @returns {Record<string, unknown>[]}
 */
export function systemSegments(db, turnId) {
  return prepare(
    db,
    'SELECT * FROM system_segments WHERE turn_id = ? ORDER BY position',
  ).all(turnId)
}
