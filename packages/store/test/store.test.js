import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from '../src/db.js'
import { MIGRATIONS, runMigrations, schemaVersion } from '../src/migrations.js'
import {
  attributionFor,
  costByDay,
  costByProject,
  escapeFtsQuery,
  findRepeatedBlocks,
  getComposition,
  getSession,
  listFindings,
  listSessions,
  listTurns,
  searchBlocks,
} from '../src/read.js'
import { localDay, recordTurn, replaceFindings } from '../src/write.js'

/** @param {string} text */
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/**
 * Raw SQL in a test, where we know the shape of what comes back.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sql
 * @returns {any}
 */
const one = (db, sql) => db.prepare(sql).get()

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} sql
 * @returns {any[]}
 */
const many = (db, sql) => db.prepare(sql).all()

/**
 * @param {string} text
 * @param {Partial<import('../src/write.js').BlockInput>} [extra]
 * @returns {import('../src/write.js').BlockInput}
 */
function block(text, extra = {}) {
  return {
    hash: hash(text),
    category: 'tool_results',
    messageIndex: 0,
    tokens: Math.ceil(text.length / 4),
    chars: text.length,
    text,
    preview: text.slice(0, 40),
    ...extra,
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} turnId
 * @param {import('../src/write.js').BlockInput[]} blocks
 * @param {Partial<import('../src/write.js').TurnInput>} [turn]
 */
function ingest(db, turnId, blocks, turn = {}) {
  return recordTurn(db, {
    session: {
      id: 'sess-1',
      tool: 'claude',
      provider: 'anthropic',
      model: 'claude-opus-5',
      projectPath: '/repo/contextlab',
      projectName: 'contextlab',
    },
    turn: {
      id: turnId,
      sessionId: 'sess-1',
      capturedAt: Date.parse('2026-09-09T10:00:00Z'),
      model: 'claude-opus-5',
      inputTokens: 1000,
      outputTokens: 100,
      contextTokens: 1100,
      costUsd: 0.02,
      equivalentCostUsd: 0.02,
      ...turn,
    },
    blocks,
  })
}

describe('migrations', () => {
  it('creates the schema and records the version', () => {
    const db = openDatabase(':memory:')
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    const tables = many(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).map((row) => row.name)
    expect(tables).toContain('sessions')
    expect(tables).toContain('turns')
    expect(tables).toContain('blocks')
    expect(tables).toContain('findings')
    expect(tables).toContain('model_prices')
    closeDatabase(db)
  })

  it('is safe to run twice', () => {
    const db = openDatabase(':memory:')
    expect(runMigrations(db)).toEqual([])
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    closeDatabase(db)
  })

  it('turns on foreign keys, or ON DELETE CASCADE would be decoration', () => {
    const db = openDatabase(':memory:')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    closeDatabase(db)
  })
})

describe('recording turns', () => {
  /** @type {import('better-sqlite3').Database} */
  let db

  beforeEach(() => {
    db = openDatabase(':memory:')
  })

  it('creates the session on the first turn and numbers turns in order', () => {
    expect(ingest(db, 'cap-1', [block('hello')])).toEqual({ inserted: true, seq: 0 })
    expect(ingest(db, 'cap-2', [block('hello')])).toEqual({ inserted: true, seq: 1 })
    expect(listTurns(db, 'sess-1')).toHaveLength(2)
    expect(getSession(db, 'sess-1')?.turn_count).toBe(2)
  })

  it('ignores a capture it has already ingested', () => {
    ingest(db, 'cap-1', [block('hello')])
    expect(ingest(db, 'cap-1', [block('hello')])).toEqual({ inserted: false, seq: 0 })
    expect(listTurns(db, 'sess-1')).toHaveLength(1)
  })

  it('stores a repeated block once and counts the turns that resent it', () => {
    const npmLog = block('npm ERR! '.repeat(500), { toolName: 'Bash' })
    ingest(db, 'cap-1', [npmLog])
    ingest(db, 'cap-2', [npmLog])
    ingest(db, 'cap-3', [npmLog])

    expect(one(db, 'SELECT COUNT(*) AS n FROM blocks').n).toBe(1)

    const [repeated] = findRepeatedBlocks(db, 'sess-1', { minTokens: 100 })
    expect(repeated.turns_present).toBe(3)
    expect(repeated.tokens_resent).toBe(Number(repeated.tokens) * 3)
  })

  it('keeps session totals derived from the turns underneath', () => {
    ingest(db, 'cap-1', [block('a')], { inputTokens: 1000, contextTokens: 1000 })
    ingest(db, 'cap-2', [block('b')], { inputTokens: 4000, contextTokens: 9000 })
    const session = getSession(db, 'sess-1')
    expect(session?.input_tokens).toBe(5000)
    expect(session?.peak_context_tokens).toBe(9000)
    expect(session?.cost_usd).toBeCloseTo(0.04)
  })

  it('cascades deletes so a removed session leaves nothing behind', () => {
    ingest(db, 'cap-1', [block('hello')])
    db.prepare('DELETE FROM sessions WHERE id = ?').run('sess-1')
    expect(one(db, 'SELECT COUNT(*) AS n FROM turns').n).toBe(0)
    expect(one(db, 'SELECT COUNT(*) AS n FROM blocks').n).toBe(0)
    expect(one(db, 'SELECT COUNT(*) AS n FROM turn_blocks').n).toBe(0)
  })

  it('records composition, segments and attribution alongside the turn', () => {
    recordTurn(db, {
      session: { id: 'sess-2', tool: 'claude' },
      turn: { id: 'cap-9', sessionId: 'sess-2', capturedAt: Date.now() },
      blocks: [block('x')],
      composition: [
        { category: 'tool_results', tokens: 800, percent: 80 },
        { category: 'system_prompt', tokens: 200, percent: 20 },
      ],
      systemSegments: [{ kind: 'memory_file', label: 'CLAUDE.md', tokens: 200 }],
      attribution: [
        {
          entityType: 'mcp_server',
          entityName: 'playwright',
          tokens: 4000,
          costUsd: 0.05,
        },
      ],
    })

    expect(getComposition(db, { turnId: 'cap-9' })).toHaveLength(2)
    expect(attributionFor(db, 'sess-2')[0].entity_name).toBe('playwright')
    expect(getComposition(db, { sessionId: 'sess-2' })[0].category).toBe('tool_results')
  })
})

describe('full-text search', () => {
  /** @type {import('better-sqlite3').Database} */
  let db

  beforeEach(() => {
    db = openDatabase(':memory:')
    ingest(db, 'cap-1', [
      block('the authentication middleware rejected the token', {
        category: 'user_text',
      }),
      block('npm ERR! code ELIFECYCLE build failed', { toolName: 'Bash' }),
    ])
  })

  it('finds content and highlights the match', () => {
    const [hit] = searchBlocks(db, 'authentication')
    expect(hit.snippet).toContain('[authentication]')
    expect(hit.tool).toBe('claude')
  })

  it('stems, so "reject" finds "rejected"', () => {
    expect(searchBlocks(db, 'reject')).toHaveLength(1)
  })

  it('filters by category', () => {
    expect(searchBlocks(db, 'npm', { category: 'user_text' })).toHaveLength(0)
    expect(searchBlocks(db, 'npm', { category: 'tool_results' })).toHaveLength(1)
  })

  it('reports how many turns re-sent each hit', () => {
    ingest(db, 'cap-2', [
      block('npm ERR! code ELIFECYCLE build failed', { toolName: 'Bash' }),
    ])
    const [hit] = searchBlocks(db, 'ELIFECYCLE')
    expect(hit.resent_turns).toBe(2)
  })

  it('does not throw on punctuation a user would actually type', () => {
    // FTS5 MATCH has its own syntax; unescaped, each of these is a parse error.
    for (const query of ['npm ERR!', 'it\'s "quoted"', 'a*b', 'NEAR(x)', '-flag']) {
      expect(() => searchBlocks(db, query)).not.toThrow()
    }
  })

  it('keeps the index in step when a block is deleted', () => {
    db.prepare('DELETE FROM blocks').run()
    expect(searchBlocks(db, 'authentication')).toHaveLength(0)
  })

  it('escapes each term as a literal', () => {
    expect(escapeFtsQuery('npm ERR!')).toBe('"npm" "ERR!"')
    expect(escapeFtsQuery('  ')).toBe('')
  })
})

describe('aggregates', () => {
  it('groups spend by day and by project', () => {
    const db = openDatabase(':memory:')
    ingest(db, 'cap-1', [block('a')], { capturedAt: Date.parse('2026-09-08T10:00:00Z') })
    ingest(db, 'cap-2', [block('b')], { capturedAt: Date.parse('2026-09-09T10:00:00Z') })
    ingest(db, 'cap-3', [block('c')], { capturedAt: Date.parse('2026-09-09T12:00:00Z') })

    const days = costByDay(db)
    expect(days).toHaveLength(2)
    expect(days[0].turns).toBe(2)

    const [project] = costByProject(db)
    expect(project.project).toBe('contextlab')
    expect(project.turns).toBe(3)
    closeDatabase(db)
  })

  it('uses the local calendar day, which is what a person means by "today"', () => {
    // 23:30 on the 9th in UTC+5:30 is still the 9th locally, and the 8th in UTC.
    expect(localDay(Date.parse('2026-09-09T18:00:00Z'))).toMatch(/^2026-09-0[89]$/)
  })
})

describe('findings', () => {
  it('replaces the previous set rather than accumulating duplicates', () => {
    const db = openDatabase(':memory:')
    ingest(db, 'cap-1', [block('a')])

    replaceFindings(db, 'sess-1', [
      {
        rule: 'unused-mcp-server',
        title: 'MCP server "playwright" was never used',
        wastedTokens: 40000,
        wastedCostUsd: 1.2,
        fix: 'Remove from .mcp.json',
      },
    ])
    replaceFindings(db, 'sess-1', [
      {
        rule: 'unused-mcp-server',
        title: 'MCP server "playwright" was never used',
        wastedTokens: 60000,
        wastedCostUsd: 1.8,
        fix: 'Remove from .mcp.json',
      },
    ])

    const findings = listFindings(db, 'sess-1')
    expect(findings).toHaveLength(1)
    expect(findings[0].wasted_cost_usd).toBe(1.8)
    expect(listSessions(db)[0].wasted_cost_usd).toBe(1.8)
    closeDatabase(db)
  })
})

describe('counting how often content was re-sent', () => {
  it('counts turns, not occurrences within a turn', () => {
    const db = openDatabase(':memory:')
    const log = block('E ModuleNotFoundError\n'.repeat(400), { toolName: 'Bash' })

    // Three copies of the same content inside one turn, then two more turns.
    // A row count says 5; the honest answer is 3 turns.
    ingest(db, 'cap-1', [log, log, log])
    ingest(db, 'cap-2', [log])
    ingest(db, 'cap-3', [log])

    const [repeated] = findRepeatedBlocks(db, 'sess-1', { minTokens: 100 })
    expect(repeated.turns_present).toBe(3)
    // Claiming 4 re-sends instead of 2 is how a rule ends up asserting more
    // waste than the session was ever billed for.
    expect(repeated.tokens_resent).toBe(Number(repeated.tokens) * 3)
    closeDatabase(db)
  })
})
