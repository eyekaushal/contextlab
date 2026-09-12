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
        (SELECT COUNT(DISTINCT tb.turn_id) FROM turn_blocks tb WHERE tb.block_id = b.id)
          AS resent_turns
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
 * @param {{ limit?: number, offset?: number, tool?: string, model?: string,
 *           project?: string, since?: number, until?: number }} [options]
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
        AND (@model   IS NULL OR s.model = @model)
        AND (@project IS NULL OR s.project_path = @project)
        AND (@since   IS NULL OR s.last_seen_at >= @since)
        AND (@until   IS NULL OR s.last_seen_at <= @until)
      ORDER BY s.last_seen_at DESC
      LIMIT @limit OFFSET @offset
    `,
  ).all({
    tool: options.tool ?? null,
    model: options.model ?? null,
    project: options.project ?? null,
    since: options.since ?? null,
    until: options.until ?? null,
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
        -- DISTINCT matters: the same content can appear several times inside a
        -- single turn. Counting rows instead of turns made a block present in
        -- 5 turns report as 15, and the waste rule multiplied by 14 rather
        -- than 4 — claiming more tokens than the session was ever billed.
        COUNT(DISTINCT tb.turn_id)            AS turns_present,
        b.tokens * COUNT(DISTINCT tb.turn_id) AS tokens_resent
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
 * Pass `turnId` to scope it to a single turn. `why` needs that: showing a
 * session's totals beside one turn's context makes the attribution look larger
 * than the window it is supposedly inside.
 *
 * @param {Db} db
 * @param {string} sessionId
 * @param {{ entityType?: string, turnId?: string, limit?: number }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function attributionFor(db, sessionId, options = {}) {
  return prepare(
    db,
    `
      SELECT entity_type, entity_name,
        SUM(tokens)            AS tokens,
        SUM(cost_usd)          AS cost_usd,
        SUM(calls)             AS calls,
        SUM(definition_tokens) AS definition_tokens,
        SUM(call_tokens)       AS call_tokens,
        SUM(result_tokens)     AS result_tokens
      FROM attribution
      WHERE session_id = @sessionId
        AND (@entityType IS NULL OR entity_type = @entityType)
        AND (@turnId IS NULL OR turn_id = @turnId)
      GROUP BY entity_type, entity_name
      ORDER BY cost_usd DESC, tokens DESC
      LIMIT @limit
    `,
  ).all({
    sessionId,
    entityType: options.entityType ?? null,
    turnId: options.turnId ?? null,
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

/**
 * Tool calls made more than once with identical arguments.
 *
 * A retry loop looks exactly like this: same tool, same input, several turns.
 * Grouping on the block hash means identical calls collapse to one row whose
 * count is the number of attempts.
 *
 * @param {Db} db
 * @param {string} sessionId
 * @param {{ minCount?: number, limit?: number }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function findRepeatedCalls(db, sessionId, options = {}) {
  return prepare(
    db,
    `
      SELECT
        b.tool_name,
        b.preview,
        b.file_path,
        SUM(b.tokens)         AS tokens,
        COUNT(tb.turn_id)     AS count
      FROM blocks b
      JOIN turn_blocks tb ON tb.block_id = b.id
      WHERE b.session_id = @sessionId AND b.block_type = 'tool_use'
      GROUP BY b.id
      HAVING count >= @minCount
      ORDER BY count DESC, tokens DESC
      LIMIT @limit
    `,
  ).all({
    sessionId,
    minCount: options.minCount ?? 2,
    limit: options.limit ?? 20,
  })
}

/**
 * Every content block in one turn, in the order it appeared.
 *
 * The Messages screen renders this. `turns_present` rides along because a block
 * that has been re-sent many times is the thing a reader most wants flagged.
 *
 * @param {Db} db
 * @param {string} turnId
 * @returns {Record<string, unknown>[]}
 */
export function listBlocksForTurn(db, turnId) {
  return prepare(
    db,
    `
      SELECT
        b.id, b.role, b.block_type, b.category, b.tool_name, b.tool_use_id,
        b.file_path, b.mcp_server, b.tokens, b.tokens_estimated, b.chars,
        b.is_image, b.preview, b.text, b.hash,
        tb.position, tb.message_index,
        (SELECT COUNT(DISTINCT x.turn_id) FROM turn_blocks x WHERE x.block_id = b.id)
          AS turns_present
      FROM turn_blocks tb
      JOIN blocks b ON b.id = tb.block_id
      WHERE tb.turn_id = ?
      ORDER BY tb.position
    `,
  ).all(turnId)
}

/**
 * What changed between two turns, by category.
 *
 * The prior tool drew two near-identical full bars and left the reader to spot
 * the difference. Returning only the delta is the fix — see docs/DESIGN.md.
 *
 * @param {Db} db
 * @param {string} turnId
 * @param {string} previousTurnId
 * @returns {{ category: string, tokens: number, previous: number, delta: number }[]}
 */
export function compositionDelta(db, turnId, previousTurnId) {
  const rows = prepare(
    db,
    `
      SELECT
        category,
        SUM(CASE WHEN turn_id = @turnId THEN tokens ELSE 0 END)     AS tokens,
        SUM(CASE WHEN turn_id = @previousId THEN tokens ELSE 0 END) AS previous
      FROM composition
      WHERE turn_id IN (@turnId, @previousId)
      GROUP BY category
    `,
  ).all({ turnId, previousId: previousTurnId })

  return rows
    .map((row) => ({
      category: String(row.category),
      tokens: Number(row.tokens) || 0,
      previous: Number(row.previous) || 0,
      delta: (Number(row.tokens) || 0) - (Number(row.previous) || 0),
    }))
    .filter((row) => row.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

/**
 * The distinct values worth offering as a filter.
 *
 * Read from what has actually been captured rather than from a hardcoded list,
 * so the dropdowns only ever offer choices that will return something.
 *
 * @param {Db} db
 * @returns {{ tools: string[], models: string[],
 *             projects: { path: string, name: string }[] }}
 */
export function listFilterOptions(db) {
  const tools = prepare(
    db,
    "SELECT DISTINCT tool FROM sessions WHERE tool IS NOT NULL AND tool != '' ORDER BY tool",
  ).all()

  const models = prepare(
    db,
    "SELECT DISTINCT model FROM sessions WHERE model IS NOT NULL AND model != '' ORDER BY model",
  ).all()

  const projects = prepare(
    db,
    `SELECT DISTINCT project_path AS path,
            COALESCE(project_name, project_path) AS name
     FROM sessions
     WHERE project_path IS NOT NULL AND project_path != ''
     ORDER BY name`,
  ).all()

  return {
    tools: tools.map((row) => String(row.tool)),
    models: models.map((row) => String(row.model)),
    projects: projects.map((row) => ({ path: String(row.path), name: String(row.name) })),
  }
}

/**
 * Context size per turn, for the trend sparkline on the sessions list.
 *
 * One query for every session on screen rather than one per row: fifty rows
 * would otherwise be fifty round trips for a chart that is sixty pixels wide.
 *
 * @param {Db} db
 * @param {string[]} sessionIds
 * @returns {Record<string, number[]>}
 */
export function contextTrends(db, sessionIds) {
  if (sessionIds.length === 0) return {}

  const placeholders = sessionIds.map(() => '?').join(',')
  const rows = prepare(
    db,
    `SELECT session_id, seq, context_tokens
     FROM turns
     WHERE session_id IN (${placeholders})
     ORDER BY session_id, seq`,
  ).all(...sessionIds)

  /** @type {Record<string, number[]>} */
  const trends = {}
  for (const row of rows) {
    const id = String(row.session_id)
    if (!trends[id]) trends[id] = []
    trends[id].push(Number(row.context_tokens) || 0)
  }
  return trends
}

/**
 * One block's full text.
 *
 * Kept out of the list endpoint on purpose: a single stuck tool result can be
 * eighty thousand characters, and shipping every block's text to draw a list of
 * previews is how a local dashboard starts feeling slow.
 *
 * @param {Db} db
 * @param {number | string} blockId
 * @returns {Record<string, unknown> | undefined}
 */
export function getBlock(db, blockId) {
  return /** @type {Record<string, unknown> | undefined} */ (
    prepare(
      db,
      `SELECT b.*,
              (SELECT COUNT(DISTINCT tb.turn_id) FROM turn_blocks tb
                WHERE tb.block_id = b.id) AS turns_present
       FROM blocks b WHERE b.id = ?`,
    ).get(blockId)
  )
}

/**
 * Spend against the periods a budget can cover.
 *
 * Equivalent cost, not actual: a budget should mean the same thing on a
 * subscription as on a metered key, or a subscription user's answer is zero
 * forever and the feature is useless to them.
 *
 * @param {Db} db
 * @param {{ day?: string, month?: string, sessionId?: string }} [scope]
 * @returns {{ daily: number, monthly: number, session: number }}
 */
export function spendTotals(db, scope = {}) {
  const day = scope.day ?? localDayString()
  const month = scope.month ?? day.slice(0, 7)

  const row = /** @type {any} */ (
    prepare(
      db,
      `SELECT
         COALESCE(SUM(CASE WHEN captured_day = @day THEN equivalent_cost_usd END), 0)
           AS daily,
         COALESCE(SUM(CASE WHEN captured_day LIKE @monthPrefix THEN equivalent_cost_usd END), 0)
           AS monthly,
         COALESCE(SUM(CASE WHEN session_id = @sessionId THEN equivalent_cost_usd END), 0)
           AS session
       FROM turns`,
    ).get({ day, monthPrefix: `${month}%`, sessionId: scope.sessionId ?? null })
  )

  return {
    daily: Number(row?.daily) || 0,
    monthly: Number(row?.monthly) || 0,
    session: Number(row?.session) || 0,
  }
}

/**
 * @returns {string} today, as the local calendar reckons it
 */
function localDayString() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
