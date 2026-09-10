/**
 * Rebuilding a SessionSummary from what is stored.
 *
 * The rules engine is pure and knows nothing about SQLite. Ingest could hand it
 * a summary built from live compositions, but `contextlab optimize` runs long
 * after the captures are gone — so the summary has to be reconstructible from
 * the database alone. This file is that reconstruction.
 *
 * @module
 */

import {
  attributionFor,
  findRepeatedBlocks,
  findRepeatedCalls,
  getComposition,
  getSession,
  listTurns,
} from '@contextlab/store'

/** @typedef {import('better-sqlite3').Database} Db */
/** @typedef {import('@contextlab/core/prescribe').SessionSummary} SessionSummary */

/**
 * @param {Db} db
 * @param {string} sessionId
 * @param {{ inputPricePerMillion?: number }} [options]
 * @returns {SessionSummary | null}
 */
export function buildSessionSummary(db, sessionId, options = {}) {
  const session = /** @type {any} */ (getSession(db, sessionId))
  if (!session) return null

  const turns = /** @type {any[]} */ (listTurns(db, sessionId))
  const composition = /** @type {any[]} */ (getComposition(db, { sessionId }))
  const attribution = /** @type {any[]} */ (attributionFor(db, sessionId, { limit: 200 }))
  const repeatedBlocks = /** @type {any[]} */ (
    findRepeatedBlocks(db, sessionId, { minTurns: 2, minTokens: 1, limit: 100 })
  )
  const repeatedCalls = /** @type {any[]} */ (
    findRepeatedCalls(db, sessionId, { minCount: 2, limit: 50 })
  )

  /** @type {Record<string, number>} */
  const categories = {}
  for (const row of composition) categories[row.category] = Number(row.tokens) || 0

  const rate =
    options.inputPricePerMillion ??
    inferRate(Number(session.cost_usd) || Number(session.equivalent_cost_usd) || 0, turns)

  return {
    sessionId,
    tool: session.tool ?? '',
    model: session.model ?? 'unknown',
    provider: session.provider ?? '',
    billingMode: session.billing_mode ?? 'unknown',
    turnCount: turns.length,
    contextLimit: session.context_limit ?? null,
    inputPricePerMillion: rate,
    peakContextTokens: Number(session.peak_context_tokens) || 0,
    firstContextTokens: Number(turns[0]?.context_tokens) || 0,
    lastContextTokens: Number(turns[turns.length - 1]?.context_tokens) || 0,
    totalCostUsd: Number(session.equivalent_cost_usd) || 0,
    categories,
    usage: {
      inputTokens: Number(session.input_tokens) || 0,
      outputTokens: Number(session.output_tokens) || 0,
      cacheReadTokens: Number(session.cache_read_tokens) || 0,
      cacheWriteTokens: Number(session.cache_write_tokens) || 0,
      thinkingTokens: sumOf(turns, 'thinking_tokens'),
    },
    attribution: {
      entries: attribution.map((row) => ({
        entityType: row.entity_type,
        entityName: row.entity_name,
        tokens: Number(row.tokens) || 0,
        definitionTokens: Number(row.definition_tokens) || 0,
        callTokens: Number(row.call_tokens) || 0,
        resultTokens: Number(row.result_tokens) || 0,
        calls: Number(row.calls) || 0,
        costUsd: Number(row.cost_usd) || 0,
        share: 0,
      })),
      totalTokens: Number(session.peak_context_tokens) || 0,
      attributedTokens: 0,
    },
    repeatedBlocks: repeatedBlocks.map((row) => ({
      key: String(row.id),
      category: row.category,
      tokens: Number(row.tokens) || 0,
      turnsPresent: Number(row.turns_present) || 0,
      tokensResent: Number(row.tokens_resent) - Number(row.tokens) || 0,
      ...(row.tool_name ? { toolName: row.tool_name } : {}),
      ...(row.file_path ? { filePath: row.file_path } : {}),
      ...(row.preview ? { preview: row.preview } : {}),
    })),
    repeatedCalls: repeatedCalls.map((row) => ({
      name: row.tool_name ?? 'unknown tool',
      signature: `${row.tool_name ?? 'unknown'}(${row.preview ?? ''})`,
      count: Number(row.count) || 0,
      tokens: Number(row.tokens) || 0,
      ...(row.file_path ? { filePath: row.file_path } : {}),
    })),
    turns: turns.map((turn, seq) => ({
      seq,
      contextTokens: Number(turn.context_tokens) || 0,
    })),
    imageTokensPerTurn: imageTokensPerTurn(categories, turns.length),
    turnsWithImages: (categories.images ?? 0) > 0 ? turns.length : 0,
  }
}

/**
 * @param {any[]} rows
 * @param {string} column
 * @returns {number}
 */
function sumOf(rows, column) {
  return rows.reduce((total, row) => total + (Number(row[column]) || 0), 0)
}

/**
 * Recover the effective input rate from what we already stored.
 *
 * Prices can change between the turn being recorded and `optimize` being run;
 * using the rate the session was actually costed at keeps a finding's numbers
 * consistent with the session totals shown next to it.
 *
 * @param {number} costUsd
 * @param {any[]} turns
 * @returns {number}
 */
function inferRate(costUsd, turns) {
  const inputTokens = sumOf(turns, 'input_tokens') + sumOf(turns, 'cache_read_tokens')
  if (inputTokens <= 0 || costUsd <= 0) return 0
  return (costUsd / inputTokens) * 1_000_000
}

/**
 * @param {Record<string, number>} categories
 * @param {number} turnCount
 * @returns {number}
 */
function imageTokensPerTurn(categories, turnCount) {
  const images = categories.images ?? 0
  return turnCount > 0 ? Math.round(images / turnCount) : 0
}
