/**
 * `contextlab why` — why was my last turn expensive?
 *
 * Answers with the composition of the most recent turn, what changed since the
 * turn before it, and the named things that cost the most. The delta is the
 * part that matters: a context window is always large, and what a user wants to
 * know is what made *this* turn larger than the last one.
 *
 * @module
 */

import {
  attributionFor,
  getComposition,
  getSession,
  listSessions,
  listTurns,
} from '@contextlab/store'
import { open } from '../context.js'
import {
  bar,
  color,
  heading,
  pad,
  percent,
  tokens,
  truncate,
  usd,
  when,
} from '../format.js'

/**
 * @param {{ session?: string, json?: boolean }} [options]
 * @returns {void}
 */
export function why(options = {}) {
  const { db } = open()

  const sessionId =
    options.session ?? /** @type {any} */ (listSessions(db, { limit: 1 })[0])?.id
  if (!sessionId) {
    console.log(
      color.gray('\nNothing recorded yet. Run an agent through the proxy first:'),
    )
    console.log(color.gray('  contextlab claude\n'))
    return
  }

  const session = /** @type {any} */ (getSession(db, sessionId))
  const turns = /** @type {any[]} */ (listTurns(db, sessionId))
  const last = turns[turns.length - 1]
  const previous = turns[turns.length - 2]
  if (!last) {
    console.log(color.gray('\nThat session has no turns.\n'))
    return
  }

  const composition = /** @type {any[]} */ (getComposition(db, { turnId: last.id }))
  // Scoped to this turn: session totals next to one turn's context would read
  // as though the parts were bigger than the whole.
  const attribution = /** @type {any[]} */ (
    attributionFor(db, sessionId, { turnId: last.id, limit: 40 })
  )

  if (options.json) {
    console.log(
      JSON.stringify({ session, turn: last, composition, attribution }, null, 2),
    )
    return
  }

  const contextTokens = Number(last.context_tokens) || 0
  const limit = Number(session?.context_limit) || 0

  console.log(
    heading(
      `Turn ${Number(last.seq) + 1} of ${turns.length}  ${color.gray(
        `${session?.tool || 'unknown tool'} · ${last.model} · ${when(Number(last.captured_at))}`,
      )}`,
    ),
  )

  const fill = limit > 0 ? contextTokens / limit : 0
  console.log(
    `  ${tokens(contextTokens)} tokens` +
      (limit > 0 ? `  ${bar(fill, 20)} ${percent(fill)} of ${tokens(limit)}` : '') +
      `  ${usd(Number(last.equivalent_cost_usd) || 0)}`,
  )

  if (previous) {
    // The useful question is not "is this large" but "what grew".
    const delta = contextTokens - (Number(previous.context_tokens) || 0)
    const sign = delta >= 0 ? '+' : '−'
    const paint = delta > 0 ? color.yellow : color.green
    console.log(`  ${paint(`${sign}${tokens(Math.abs(delta))}`)} since the previous turn`)
  }

  console.log(heading('What is in the window'))
  for (const row of composition) {
    const share = contextTokens > 0 ? Number(row.tokens) / contextTokens : 0
    console.log(
      `  ${pad(String(row.category), 19)}${pad(tokens(Number(row.tokens)), 8)}${bar(share, 20)} ${percent(share)}`,
    )
  }

  const interesting = attribution.filter((row) => Number(row.tokens) > 0).slice(0, 8)

  if (interesting.length > 0) {
    console.log(heading('Where it came from'))
    for (const row of interesting) {
      const calls = Number(row.calls)
      const callable = row.entity_type === 'tool' || row.entity_type === 'mcp_server'
      const note = !callable
        ? color.gray('')
        : calls === 0
          ? color.red('never called')
          : color.gray(`${calls} call${calls === 1 ? '' : 's'}`)
      console.log(
        `  ${pad(color.gray(String(row.entity_type)), 16)}${pad(truncate(String(row.entity_name), 30), 32)}${pad(tokens(Number(row.tokens)), 8)}${note}`,
      )
    }
  }

  console.log(color.gray('\n  contextlab optimize   for what to change\n'))
}
