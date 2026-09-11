/**
 * Turning stored sessions into a portable document.
 *
 * `format` does the shaping and knows nothing about SQLite; `store` holds the
 * rows and knows nothing about the format. This is the seam between them.
 *
 * @module
 */

import { runRules } from '@contextlab/core/prescribe'
import { buildDocument, session as shapeSession } from '@contextlab/format'
import {
  attributionFor,
  getComposition,
  getSession,
  listBlocksForTurn,
  listFindings,
  listSessions,
  listTurns,
  systemSegments,
} from '@contextlab/store'
import { currentPriceTable } from './pricing.js'
import { toCamel, toCamelAll } from './serialize.js'
import { buildSessionSummary } from './summary.js'

/** @typedef {import('better-sqlite3').Database} Db */

/**
 * @param {Db} db
 * @param {{ sessionId?: string, limit?: number, content?: string,
 *           version?: string }} [options]
 * @returns {Record<string, unknown>}
 */
export function buildExport(db, options = {}) {
  const ids = options.sessionId
    ? [options.sessionId]
    : /** @type {any[]} */ (listSessions(db, { limit: options.limit ?? 50 })).map((row) =>
        String(row.id),
      )

  const table = currentPriceTable(db)

  const sessions = []
  for (const id of ids) {
    const row = /** @type {any} */ (toCamel(/** @type {any} */ (getSession(db, id))))
    if (!row) continue

    const turns = /** @type {any[]} */ (
      toCamelAll(/** @type {any[]} */ (listTurns(db, id)))
    )

    for (const turn of turns) {
      const turnId = String(turn.id)
      turn.contextLimit = row.contextLimit
      turn.composition = toCamelAll(/** @type {any[]} */ (getComposition(db, { turnId })))
      turn.systemSegments = toCamelAll(/** @type {any[]} */ (systemSegments(db, turnId)))
      turn.attribution = toCamelAll(
        /** @type {any[]} */ (attributionFor(db, id, { turnId, limit: 200 })),
      )

      if (options.content !== 'none') {
        turn.messages = groupBlocks(
          toCamelAll(/** @type {any[]} */ (listBlocksForTurn(db, turnId))),
        )
      }
    }

    row.turns = turns

    const stored = toCamelAll(/** @type {any[]} */ (listFindings(db, id))).map(
      (finding) => ({
        ...finding,
        evidence: parseEvidence(finding.evidence),
      }),
    )

    // Findings are cached when a screen asks for them, so a session nobody has
    // opened has none stored. An export should be complete regardless of which
    // screens happened to be visited, and the rules are cheap and pure.
    if (stored.length === 0) {
      const summary = buildSessionSummary(db, id)
      row.findings = summary ? runRules(summary) : []
    } else {
      row.findings = stored
    }

    sessions.push(shapeSession(row, { content: options.content }))
  }

  return buildDocument(sessions, {
    content: /** @type {any} */ (options.content),
    producer: { name: 'contextlab', version: options.version ?? '0.1.0' },
    pricing: { source: table.source, updatedAt: table.updatedAt },
  })
}

/**
 * @param {any[]} blocks
 * @returns {any[]}
 */
function groupBlocks(blocks) {
  /** @type {Map<number, any>} */
  const messages = new Map()
  for (const block of blocks) {
    const index = Number(block.messageIndex)
    const message = messages.get(index) ?? {
      index,
      role: block.role,
      tokens: 0,
      blocks: [],
    }
    message.tokens += Number(block.tokens) || 0
    message.blocks.push(block)
    messages.set(index, message)
  }
  return [...messages.values()].sort((a, b) => a.index - b.index)
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | undefined}
 */
function parseEvidence(value) {
  if (value && typeof value === 'object') return /** @type {any} */ (value)
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}
