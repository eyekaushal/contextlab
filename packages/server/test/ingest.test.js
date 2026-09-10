import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionTracker } from '@contextlab/core'
import {
  attributionFor,
  closeDatabase,
  findRepeatedBlocks,
  getComposition,
  listSessions,
  listTurns,
  openDatabase,
  searchBlocks,
} from '@contextlab/store'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ingestCapture, ingestDirectory } from '../src/ingest.js'

const npmLog = 'npm WARN deprecated thing@1.0.0 please upgrade\n'.repeat(400)

/**
 * @param {number} turn
 * @param {Partial<any>} [overrides]
 * @returns {any}
 */
function capture(turn, overrides = {}) {
  return {
    schemaVersion: 1,
    id: `cap-${turn}`,
    capturedAt: new Date(
      Date.parse('2026-09-10T10:00:00Z') + turn * 60_000,
    ).toISOString(),
    transport: 'reverse-proxy',
    tool: 'claude',
    sessionTag: 'a1b2c3d4',
    provider: 'anthropic',
    apiFormat: 'anthropic-messages',
    request: {
      method: 'POST',
      path: '/v1/messages',
      headers: { 'user-agent': 'claude-cli/1.2.3', 'x-api-key': '[redacted]' },
      body: {
        model: 'claude-opus-4-5',
        system:
          'You are Claude Code\nPrimary working directory: /repo/contextlab\n' +
          'Contents of /repo/contextlab/CLAUDE.md (project instructions):\n' +
          '# rules\n'.repeat(50),
        tools: [
          {
            name: 'Bash',
            description: 'Run a command',
            input_schema: { type: 'object' },
          },
          {
            name: 'mcp__playwright__click',
            description: 'Click something in a browser page by selector',
            input_schema: {
              type: 'object',
              properties: { selector: { type: 'string' } },
            },
          },
        ],
        messages: [
          { role: 'user', content: 'the build is failing' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'c1',
                name: 'Bash',
                input: { command: 'npm install' },
              },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'c1', content: npmLog }],
          },
        ],
      },
      bodyBytes: 5000,
    },
    response: {
      status: 200,
      streaming: false,
      headers: { 'content-type': 'application/json' },
      body: {
        model: 'claude-opus-4-5-20260101',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 40_000,
          output_tokens: 200,
          cache_read_input_tokens: 1000,
        },
      },
      bodyBytes: 900,
    },
    timing: { startedAt: Date.now(), firstByteMs: 300, completedMs: 2000 },
    ...overrides,
  }
}

describe('ingesting one capture', () => {
  /** @type {any} */
  let db

  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => closeDatabase(db))

  it('stores a turn with the whole pipeline applied', () => {
    const result = ingestCapture(db, capture(0))
    expect(result.status).toBe('stored')

    const [session] = /** @type {any[]} */ (listSessions(db))
    expect(session.tool).toBe('claude')
    // The response names the exact model served, and it wins over the request.
    expect(session.model).toBe('claude-opus-4-5-20260101')
    expect(session.project_path).toBe('/repo/contextlab')
    expect(session.project_name).toBe('contextlab')
    expect(Number(session.context_limit)).toBeGreaterThan(100_000)

    const [turn] = /** @type {any[]} */ (listTurns(db, String(session.id)))
    expect(Number(turn.input_tokens)).toBe(40_000)
    expect(Number(turn.cache_read_tokens)).toBe(1000)
    // Rescaled to what the provider actually billed: 40,000 + 1,000 cached.
    expect(Number(turn.context_tokens)).toBe(41_000)
    expect(
      Number(turn.system_tokens) +
        Number(turn.tools_tokens) +
        Number(turn.messages_tokens),
    ).toBe(41_000)
    expect(Number(turn.equivalent_cost_usd)).toBeGreaterThan(0)
  })

  it('records composition, attribution and searchable content', () => {
    ingestCapture(db, capture(0))
    const [session] = /** @type {any[]} */ (listSessions(db))

    const composition = /** @type {any[]} */ (
      getComposition(db, { sessionId: session.id })
    )
    expect(composition.map((row) => row.category)).toContain('tool_results')

    const attribution = /** @type {any[]} */ (attributionFor(db, String(session.id)))
    const server = attribution.find((row) => row.entity_type === 'mcp_server')
    expect(server?.entity_name).toBe('playwright')
    expect(Number(server?.calls)).toBe(0)

    // Tool call arguments go into the index, so a command is searchable.
    expect(searchBlocks(db, 'npm install').length).toBeGreaterThan(0)
  })

  it('is a no-op the second time the same capture arrives', () => {
    expect(ingestCapture(db, capture(0)).status).toBe('stored')
    expect(ingestCapture(db, capture(0)).status).toBe('duplicate')
    const [session] = /** @type {any[]} */ (listSessions(db))
    expect(Number(session.turn_count)).toBe(1)
  })

  it('groups consecutive turns into one session and counts the re-sends', () => {
    const tracker = createSessionTracker()
    for (let turn = 0; turn < 4; turn += 1) {
      ingestCapture(db, capture(turn), { tracker })
    }

    const sessions = /** @type {any[]} */ (listSessions(db))
    expect(sessions).toHaveLength(1)
    expect(Number(sessions[0].turn_count)).toBe(4)

    const [repeated] = /** @type {any[]} */ (
      findRepeatedBlocks(db, String(sessions[0].id), { minTokens: 1000 })
    )
    // One npm log, stored once, present in every turn.
    expect(Number(repeated.turns_present)).toBe(4)
    expect(repeated.tool_name).toBe('Bash')
  })

  it('keeps two different commands apart rather than collapsing them', () => {
    const tracker = createSessionTracker()
    ingestCapture(db, capture(0), { tracker })

    const second = capture(1)
    second.request.body.messages[1].content[0].input = { command: 'npm test' }
    ingestCapture(db, second, { tracker })

    const [session] = /** @type {any[]} */ (listSessions(db))
    const calls = /** @type {any[]} */ (
      db
        .prepare(
          "SELECT text FROM blocks WHERE session_id = ? AND block_type = 'tool_use'",
        )
        .all(String(session.id))
    )
    // Hashing a call on its name alone would merge these into one row and make
    // ordinary use look like a retry loop.
    expect(calls).toHaveLength(2)
  })

  it('skips a capture it cannot parse instead of throwing', () => {
    const broken = capture(0)
    broken.request.body = 'not an object'
    expect(ingestCapture(db, broken).status).toBe('skipped')
  })

  it('still stores a turn whose response carried no usage', () => {
    const noUsage = capture(0)
    noUsage.response.body = { model: 'claude-opus-4-5' }
    const result = ingestCapture(db, noUsage)
    expect(result.status).toBe('stored')
    // An estimate, not a zero.
    expect(result.contextTokens).toBeGreaterThan(0)
  })
})

describe('ingesting a directory', () => {
  /** @type {string} */
  let dir
  /** @type {any} */
  let db

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'contextlab-ingest-'))
    db = openDatabase(':memory:')
  })
  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('folds every capture in and removes the files it consumed', () => {
    for (let turn = 0; turn < 3; turn += 1) {
      writeFileSync(join(dir, `cap-${turn}.json`), JSON.stringify(capture(turn)))
    }

    const result = ingestDirectory(db, dir)
    expect(result.stored).toBe(3)
    expect(result.sessionIds).toHaveLength(1)
    expect(readdirSync(dir)).toHaveLength(0)
  })

  it('keeps the files when asked to', () => {
    writeFileSync(join(dir, 'cap.json'), JSON.stringify(capture(0)))
    ingestDirectory(db, dir, { keep: true })
    expect(readdirSync(dir)).toHaveLength(1)
  })

  it('reports a malformed file without losing the rest', () => {
    writeFileSync(join(dir, 'good.json'), JSON.stringify(capture(0)))
    writeFileSync(join(dir, 'bad.json'), '{ not json')

    const result = ingestDirectory(db, dir)
    expect(result.stored).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('does nothing, quietly, when there is no capture directory', () => {
    expect(ingestDirectory(db, join(dir, 'missing')).stored).toBe(0)
  })
})
