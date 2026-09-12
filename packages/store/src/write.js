/**
 * The write path: one analysed turn goes in, atomically.
 *
 * Everything here is idempotent on the turn id, which is the capture id.
 * Re-ingesting the same capture file changes nothing, so a crashed ingest can
 * simply be run again.
 *
 * @module
 */

/** @typedef {import('better-sqlite3').Database} Db */

/**
 * @typedef {Object} SessionInput
 * @property {string} id
 * @property {string} [tool]
 * @property {string} [provider]
 * @property {string} [apiFormat]
 * @property {string} [model]
 * @property {string} [sessionTag]
 * @property {string} [transport]
 * @property {string} [projectPath]
 * @property {string} [projectName]
 * @property {number} [contextLimit]
 * @property {string} [billingMode]
 * @property {string} [mainAgentKey]
 * @property {string} [fingerprint]
 */

/**
 * @typedef {Object} TurnInput
 * @property {string} id
 * @property {string} sessionId
 * @property {number} capturedAt      epoch ms
 * @property {string} [capturedDay]   local YYYY-MM-DD; derived if absent
 * @property {string} [tool]
 * @property {string} [provider]
 * @property {string} [apiFormat]
 * @property {string} [model]
 * @property {string} [transport]
 * @property {number} [status]
 * @property {boolean} [streaming]
 * @property {string} [stopReason]
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 * @property {number} [cacheReadTokens]
 * @property {number} [cacheWriteTokens]
 * @property {number} [thinkingTokens]
 * @property {number} [contextTokens]
 * @property {number} [systemTokens]
 * @property {number} [toolsTokens]
 * @property {number} [messagesTokens]
 * @property {number} [costUsd]
 * @property {number} [equivalentCostUsd]
 * @property {string} [agentKey]
 * @property {boolean} [isSubagent]
 * @property {number} [firstByteMs]
 * @property {number} [completedMs]
 * @property {number} [requestBytes]
 * @property {number} [responseBytes]
 */

/**
 * @typedef {Object} BlockInput
 * @property {string} hash
 * @property {string} category
 * @property {number} messageIndex
 * @property {string} [role]
 * @property {string} [blockType]
 * @property {string} [toolName]
 * @property {string} [toolUseId]
 * @property {string} [filePath]
 * @property {string} [mcpServer]
 * @property {number} [tokens]           share of what was billed
 * @property {number} [tokensEstimated] counted in this block's own text
 * @property {number} [chars]
 * @property {boolean} [isImage]
 * @property {string} [text]
 * @property {string} [preview]
 */

/**
 * @typedef {Object} TurnRecord
 * @property {SessionInput} session
 * @property {TurnInput} turn
 * @property {BlockInput[]} [blocks]
 * @property {{ category: string, tokens: number, percent?: number }[]} [composition]
 * @property {{ kind: string, label: string, tokens: number, hash?: string,
 *              preview?: string }[]} [systemSegments]
 * @property {{ entityType: string, entityName: string, tokens?: number,
 *              costUsd?: number, calls?: number, definitionTokens?: number,
 *              callTokens?: number, resultTokens?: number }[]} [attribution]
 */

/**
 * Local calendar day, which is what "spend today" means to a person.
 *
 * @param {number} epochMs
 * @returns {string} YYYY-MM-DD
 */
export function localDay(epochMs) {
  const date = new Date(epochMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Store one analysed turn.
 *
 * @param {Db} db
 * @param {TurnRecord} record
 * @returns {{ inserted: boolean, seq: number }}
 */
export function recordTurn(db, record) {
  return db.transaction(() => {
    const { session, turn } = record
    const day = turn.capturedDay ?? localDay(turn.capturedAt)

    db.prepare(`
      INSERT INTO sessions (
        id, tool, provider, api_format, model, session_tag, transport,
        project_path, project_name, started_at, last_seen_at, started_day,
        context_limit, billing_mode, main_agent_key, fingerprint
      ) VALUES (
        @id, @tool, @provider, @apiFormat, @model, @sessionTag, @transport,
        @projectPath, @projectName, @startedAt, @lastSeenAt, @startedDay,
        @contextLimit, @billingMode, @mainAgentKey, @fingerprint
      )
      ON CONFLICT(id) DO UPDATE SET
        -- Later turns fill in what the first one could not yet know.
        tool           = COALESCE(excluded.tool, sessions.tool),
        model          = COALESCE(excluded.model, sessions.model),
        project_path   = COALESCE(excluded.project_path, sessions.project_path),
        project_name   = COALESCE(excluded.project_name, sessions.project_name),
        context_limit  = COALESCE(excluded.context_limit, sessions.context_limit),
        main_agent_key = COALESCE(excluded.main_agent_key, sessions.main_agent_key),
        billing_mode   = CASE WHEN sessions.billing_mode = 'unknown'
                              THEN excluded.billing_mode ELSE sessions.billing_mode END
    `).run({
      id: session.id,
      tool: session.tool ?? null,
      provider: session.provider ?? null,
      apiFormat: session.apiFormat ?? null,
      model: session.model ?? null,
      sessionTag: session.sessionTag ?? null,
      transport: session.transport ?? null,
      projectPath: session.projectPath ?? null,
      projectName: session.projectName ?? null,
      startedAt: turn.capturedAt,
      lastSeenAt: turn.capturedAt,
      startedDay: day,
      contextLimit: session.contextLimit ?? null,
      billingMode: session.billingMode ?? 'unknown',
      mainAgentKey: session.mainAgentKey ?? null,
      fingerprint: session.fingerprint ?? null,
    })

    const existing = db.prepare('SELECT seq FROM turns WHERE id = ?').get(turn.id)
    if (existing) {
      return { inserted: false, seq: /** @type {{ seq: number }} */ (existing).seq }
    }

    const countRow = db
      .prepare('SELECT COUNT(*) AS n FROM turns WHERE session_id = ?')
      .get(turn.sessionId)
    const seq = /** @type {{ n: number }} */ (countRow).n

    db.prepare(`
      INSERT INTO turns (
        id, session_id, seq, captured_at, captured_day, tool, provider,
        api_format, model, transport, status, streaming, stop_reason,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        thinking_tokens, context_tokens, system_tokens, tools_tokens,
        messages_tokens, cost_usd, equivalent_cost_usd, agent_key, is_subagent,
        first_byte_ms, completed_ms, request_bytes, response_bytes
      ) VALUES (
        @id, @sessionId, @seq, @capturedAt, @capturedDay, @tool, @provider,
        @apiFormat, @model, @transport, @status, @streaming, @stopReason,
        @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens,
        @thinkingTokens, @contextTokens, @systemTokens, @toolsTokens,
        @messagesTokens, @costUsd, @equivalentCostUsd, @agentKey, @isSubagent,
        @firstByteMs, @completedMs, @requestBytes, @responseBytes
      )
    `).run({
      id: turn.id,
      sessionId: turn.sessionId,
      seq,
      capturedAt: turn.capturedAt,
      capturedDay: day,
      tool: turn.tool ?? null,
      provider: turn.provider ?? null,
      apiFormat: turn.apiFormat ?? null,
      model: turn.model ?? null,
      transport: turn.transport ?? null,
      status: turn.status ?? null,
      streaming: turn.streaming ? 1 : 0,
      stopReason: turn.stopReason ?? null,
      inputTokens: turn.inputTokens ?? 0,
      outputTokens: turn.outputTokens ?? 0,
      cacheReadTokens: turn.cacheReadTokens ?? 0,
      cacheWriteTokens: turn.cacheWriteTokens ?? 0,
      thinkingTokens: turn.thinkingTokens ?? 0,
      contextTokens: turn.contextTokens ?? 0,
      systemTokens: turn.systemTokens ?? 0,
      toolsTokens: turn.toolsTokens ?? 0,
      messagesTokens: turn.messagesTokens ?? 0,
      costUsd: turn.costUsd ?? 0,
      equivalentCostUsd: turn.equivalentCostUsd ?? 0,
      agentKey: turn.agentKey ?? null,
      isSubagent: turn.isSubagent ? 1 : 0,
      firstByteMs: turn.firstByteMs ?? null,
      completedMs: turn.completedMs ?? null,
      requestBytes: turn.requestBytes ?? null,
      responseBytes: turn.responseBytes ?? null,
    })

    insertBlocks(db, turn, record.blocks ?? [])

    const composition = db.prepare(
      'INSERT INTO composition (turn_id, category, tokens, percent) VALUES (?, ?, ?, ?)',
    )
    for (const row of record.composition ?? []) {
      composition.run(turn.id, row.category, row.tokens, row.percent ?? 0)
    }

    const segment = db.prepare(`
      INSERT INTO system_segments
        (turn_id, session_id, kind, label, tokens, position, hash, preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    ;(record.systemSegments ?? []).forEach((row, index) => {
      segment.run(
        turn.id,
        turn.sessionId,
        row.kind,
        row.label,
        row.tokens,
        index,
        row.hash ?? null,
        row.preview ?? null,
      )
    })

    const attribution = db.prepare(`
      INSERT INTO attribution
        (turn_id, session_id, entity_type, entity_name, tokens, cost_usd, calls,
         definition_tokens, call_tokens, result_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of record.attribution ?? []) {
      attribution.run(
        turn.id,
        turn.sessionId,
        row.entityType,
        row.entityName,
        row.tokens ?? 0,
        row.costUsd ?? 0,
        row.calls ?? 0,
        row.definitionTokens ?? 0,
        row.callTokens ?? 0,
        row.resultTokens ?? 0,
      )
    }

    refreshSessionTotals(db, turn.sessionId)
    return { inserted: true, seq }
  })()
}

/**
 * Insert this turn's blocks, reusing rows the session has already seen.
 *
 * @param {Db} db
 * @param {TurnInput} turn
 * @param {BlockInput[]} blocks
 * @returns {void}
 */
function insertBlocks(db, turn, blocks) {
  const insert = db.prepare(`
    INSERT INTO blocks (
      session_id, hash, role, block_type, category, tool_name, tool_use_id,
      file_path, mcp_server, tokens, tokens_estimated, chars, is_image, text,
      preview, first_seen_turn, first_seen_at
    ) VALUES (
      @sessionId, @hash, @role, @blockType, @category, @toolName, @toolUseId,
      @filePath, @mcpServer, @tokens, @tokensEstimated, @chars, @isImage, @text,
      @preview, @firstSeenTurn, @firstSeenAt
    )
    ON CONFLICT(session_id, hash) DO NOTHING
  `)
  const find = db.prepare('SELECT id FROM blocks WHERE session_id = ? AND hash = ?')
  const link = db.prepare(`
    INSERT INTO turn_blocks (turn_id, block_id, position, message_index)
    VALUES (?, ?, ?, ?)
  `)

  blocks.forEach((block, position) => {
    insert.run({
      sessionId: turn.sessionId,
      hash: block.hash,
      role: block.role ?? null,
      blockType: block.blockType ?? null,
      category: block.category,
      toolName: block.toolName ?? null,
      toolUseId: block.toolUseId ?? null,
      filePath: block.filePath ?? null,
      mcpServer: block.mcpServer ?? null,
      tokens: block.tokens ?? 0,
      tokensEstimated: block.tokensEstimated ?? block.tokens ?? 0,
      chars: block.chars ?? 0,
      isImage: block.isImage ? 1 : 0,
      text: block.text ?? null,
      preview: block.preview ?? null,
      firstSeenTurn: turn.id,
      firstSeenAt: turn.capturedAt,
    })
    const row = find.get(turn.sessionId, block.hash)
    link.run(
      turn.id,
      /** @type {{ id: number }} */ (row).id,
      position,
      block.messageIndex,
    )
  })
}

/**
 * Recompute a session's totals from its turns.
 *
 * Derived rather than incremented, so re-ingesting or deleting a turn can
 * never leave the session row disagreeing with the turns underneath it.
 *
 * @param {Db} db
 * @param {string} sessionId
 * @returns {void}
 */
export function refreshSessionTotals(db, sessionId) {
  db.prepare(`
    UPDATE sessions SET
      turn_count          = t.n,
      started_at          = t.started_at,
      last_seen_at        = t.last_seen_at,
      started_day         = t.started_day,
      input_tokens        = t.input_tokens,
      output_tokens       = t.output_tokens,
      cache_read_tokens   = t.cache_read_tokens,
      cache_write_tokens  = t.cache_write_tokens,
      peak_context_tokens = t.peak_context,
      cost_usd            = t.cost_usd,
      equivalent_cost_usd = t.equivalent_cost_usd,
      model               = COALESCE(t.last_model, sessions.model)
    FROM (
      SELECT
        COUNT(*)                     AS n,
        MIN(captured_at)             AS started_at,
        MAX(captured_at)             AS last_seen_at,
        MIN(captured_day)            AS started_day,
        SUM(input_tokens)            AS input_tokens,
        SUM(output_tokens)           AS output_tokens,
        SUM(cache_read_tokens)       AS cache_read_tokens,
        SUM(cache_write_tokens)      AS cache_write_tokens,
        MAX(context_tokens)          AS peak_context,
        SUM(cost_usd)                AS cost_usd,
        SUM(equivalent_cost_usd)     AS equivalent_cost_usd,
        (SELECT model FROM turns WHERE session_id = @id AND model IS NOT NULL
          ORDER BY seq DESC LIMIT 1) AS last_model
      FROM turns WHERE session_id = @id
    ) AS t
    WHERE sessions.id = @id
  `).run({ id: sessionId })
}

/**
 * Replace a session's findings with a freshly computed set.
 *
 * Findings are derived from deterministic rules, so the old set is never worth
 * merging — recompute and swap.
 *
 * @param {Db} db
 * @param {string} sessionId
 * @param {{ rule: string, title: string, severity?: string, detail?: string,
 *           fix?: string, wastedTokens?: number, wastedCostUsd?: number,
 *           evidence?: unknown }[]} findings
 * @returns {number} how many were written
 */
export function replaceFindings(db, sessionId, findings) {
  return db.transaction(() => {
    db.prepare('DELETE FROM findings WHERE session_id = ?').run(sessionId)
    const insert = db.prepare(`
      INSERT INTO findings (
        session_id, rule, severity, title, detail, fix,
        wasted_tokens, wasted_cost_usd, evidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, rule, title) DO NOTHING
    `)
    const now = Date.now()
    for (const finding of findings) {
      insert.run(
        sessionId,
        finding.rule,
        finding.severity ?? 'info',
        finding.title,
        finding.detail ?? null,
        finding.fix ?? null,
        finding.wastedTokens ?? 0,
        finding.wastedCostUsd ?? 0,
        finding.evidence === undefined ? null : JSON.stringify(finding.evidence),
        now,
      )
    }
    return findings.length
  })()
}
