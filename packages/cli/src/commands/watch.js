/**
 * `contextlab watch` — a live gauge in the terminal.
 *
 * Ink, written with `createElement` rather than JSX. The project ships plain
 * JavaScript with no build step, and JSX would mean adding one for a single
 * screen. The tree is shallow enough that this stays readable.
 *
 * @module
 */

import { join } from 'node:path'
import { ingestDirectory } from '@contextlab/server'
import { getComposition, listSessions, listTurns, openDatabase } from '@contextlab/store'
import { Box, render, Text, useApp, useInput, useStdin } from 'ink'
import { createElement as h, useEffect, useState } from 'react'
import { contextlabHome } from '../context.js'
import { tokens, usd } from '../format.js'

const POLL_MS = 1000

/**
 * Colours for the composition bars.
 *
 * @type {Record<string, string>}
 */
const CATEGORY_COLOR = {
  system_prompt: 'blue',
  tool_definitions: 'magenta',
  tool_calls: 'cyan',
  tool_results: 'yellow',
  user_text: 'green',
  assistant_text: 'white',
  thinking: 'magenta',
  system_injections: 'gray',
  images: 'red',
  cache_markers: 'gray',
  other: 'gray',
}

/**
 * Read the current state straight from disk each tick.
 *
 * Polling rather than watching: this runs beside a live agent, and a poll that
 * costs a millisecond is simpler and more robust than filesystem events.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} capturesDir
 * @returns {any}
 */
function readState(db, capturesDir) {
  ingestDirectory(db, capturesDir)

  const session = /** @type {any} */ (listSessions(db, { limit: 1 })[0])
  if (!session) return { empty: true }

  const turns = /** @type {any[]} */ (listTurns(db, String(session.id)))
  const last = turns[turns.length - 1]
  const previous = turns[turns.length - 2]

  return {
    empty: false,
    session,
    turnCount: turns.length,
    contextTokens: Number(last?.context_tokens) || 0,
    delta:
      last && previous
        ? (Number(last.context_tokens) || 0) - (Number(previous.context_tokens) || 0)
        : 0,
    limit: Number(session.context_limit) || 0,
    cost: Number(session.equivalent_cost_usd) || 0,
    model: session.model ?? 'unknown',
    tool: session.tool ?? '',
    composition: last ? getComposition(db, { turnId: String(last.id) }) : [],
  }
}

/**
 * @param {{ share: number, width: number }} props
 * @returns {any}
 */
function Gauge({ share, width }) {
  const filled = Math.max(0, Math.min(width, Math.round(share * width)))
  const tone = share > 0.9 ? 'red' : share > 0.75 ? 'yellow' : 'green'
  return h(
    Text,
    null,
    h(Text, { color: tone }, '█'.repeat(filled)),
    h(Text, { dimColor: true }, '░'.repeat(width - filled)),
  )
}

/**
 * @param {{ db: any, capturesDir: string }} props
 * @returns {any}
 */
function Watch({ db, capturesDir }) {
  const { exit } = useApp()
  const { isRawModeSupported } = useStdin()
  const [state, setState] = useState(() => readState(db, capturesDir))

  // Keyboard input needs raw mode, which does not exist when stdout is piped
  // or stdin is not a terminal. Ink throws rather than degrading, so the hook
  // is disabled instead of skipped — hooks cannot be conditional.
  useInput(
    (input, key) => {
      if (input === 'q' || key.escape || (key.ctrl && input === 'c')) exit()
    },
    { isActive: isRawModeSupported },
  )

  useEffect(() => {
    const timer = setInterval(() => setState(readState(db, capturesDir)), POLL_MS)
    return () => clearInterval(timer)
  }, [db, capturesDir])

  if (state.empty) {
    return h(
      Box,
      { flexDirection: 'column', paddingX: 1 },
      h(Text, { bold: true }, 'contextlab watch'),
      h(
        Text,
        { dimColor: true },
        'Waiting for a turn. Start an agent through the proxy:',
      ),
      h(Text, { color: 'cyan' }, '  contextlab claude'),
      h(Text, { dimColor: true }, '\nq to quit'),
    )
  }

  const share = state.limit > 0 ? state.contextTokens / state.limit : 0
  const rows = /** @type {any[]} */ (state.composition).filter(
    (row) => Number(row.tokens) > 0,
  )

  return h(
    Box,
    { flexDirection: 'column', paddingX: 1 },
    h(
      Text,
      null,
      h(Text, { bold: true }, 'contextlab '),
      h(Text, { dimColor: true }, `${state.tool || 'agent'} · ${state.model}`),
    ),
    h(Box, { marginTop: 1 }, h(Gauge, { share, width: 34 })),
    h(
      Text,
      null,
      h(Text, { bold: true }, tokens(state.contextTokens)),
      state.limit > 0
        ? h(
            Text,
            { dimColor: true },
            ` / ${tokens(state.limit)}  ${Math.round(share * 100)}%`,
          )
        : null,
      h(Text, { dimColor: true }, `   turn ${state.turnCount}   ${usd(state.cost)}`),
    ),
    state.delta !== 0
      ? h(
          Text,
          { color: state.delta > 0 ? 'yellow' : 'green' },
          `${state.delta > 0 ? '+' : '−'}${tokens(Math.abs(state.delta))} since last turn`,
        )
      : null,
    h(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      rows.map((row) => {
        const rowShare =
          state.contextTokens > 0 ? Number(row.tokens) / state.contextTokens : 0
        const width = Math.max(0, Math.round(rowShare * 24))
        return h(
          Text,
          { key: String(row.category) },
          h(Text, { dimColor: true }, String(row.category).padEnd(18)),
          h(
            Text,
            { color: CATEGORY_COLOR[String(row.category)] ?? 'white' },
            '█'.repeat(width).padEnd(24),
          ),
          h(Text, { dimColor: true }, ` ${tokens(Number(row.tokens))}`),
        )
      }),
    ),
    h(Text, { dimColor: true }, '\nq to quit'),
  )
}

/**
 * @returns {Promise<void>}
 */
export async function watch() {
  const home = contextlabHome()
  const db = openDatabase(join(home, 'data.db'))
  const capturesDir = join(home, 'captures')

  // A live TUI needs a terminal: Ink takes over the screen and reads keys in
  // raw mode, neither of which exists in a pipe. Rather than crash on
  // `contextlab watch | tee`, print one snapshot and exit.
  if (!process.stdout.isTTY) {
    snapshot(readState(db, capturesDir))
    db.close()
    return
  }

  const app = render(h(Watch, { db, capturesDir }))
  await app.waitUntilExit()
  db.close()
}

/**
 * The same numbers as the TUI, as plain lines.
 *
 * @param {any} state
 * @returns {void}
 */
function snapshot(state) {
  if (state.empty) {
    console.log('contextlab watch: nothing captured yet. Try: contextlab claude')
    return
  }

  const share = state.limit > 0 ? state.contextTokens / state.limit : 0
  console.log(`contextlab  ${state.tool || 'agent'} · ${state.model}`)
  console.log(
    `${tokens(state.contextTokens)}` +
      (state.limit > 0 ? ` / ${tokens(state.limit)}  ${Math.round(share * 100)}%` : '') +
      `  turn ${state.turnCount}  ${usd(state.cost)}`,
  )
  for (const row of /** @type {any[]} */ (state.composition)) {
    if (Number(row.tokens) <= 0) continue
    console.log(`  ${String(row.category).padEnd(18)} ${tokens(Number(row.tokens))}`)
  }
}
