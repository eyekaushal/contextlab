/**
 * Dismissals have to outlive a rules run.
 *
 * `replaceFindings` deletes every finding for a session and writes the fresh
 * set, so a `dismissed_at` column on that table would be erased the next time
 * anything recomputed. These tests exist mainly to hold that line: the decision
 * a reader made survives the recomputation that follows it.
 */

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from '../src/db.js'
import {
  dismissalKey,
  dismissFinding,
  listDismissals,
  markDismissed,
  restoreFinding,
} from '../src/dismissals.js'
import { listFindings } from '../src/read.js'
import { recordTurn, replaceFindings } from '../src/write.js'

/** The separator inside a composite key. Written this way to keep it out of source. */
const NUL = String.fromCharCode(0)

/** @param {string} text */
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 */
function seed(db, sessionId) {
  recordTurn(db, {
    session: {
      id: sessionId,
      tool: 'claude',
      provider: 'anthropic',
      model: 'claude-opus-5',
      projectPath: '/repo/contextlab',
      projectName: 'contextlab',
    },
    turn: {
      id: `${sessionId}-t0`,
      sessionId,
      capturedAt: Date.parse('2026-09-09T10:00:00Z'),
      model: 'claude-opus-5',
      inputTokens: 1000,
      outputTokens: 100,
      contextTokens: 1100,
      costUsd: 0.02,
      equivalentCostUsd: 0.02,
    },
    blocks: [
      {
        hash: hash('hello'),
        category: 'user_text',
        messageIndex: 0,
        tokens: 2,
        chars: 5,
        text: 'hello',
        preview: 'hello',
      },
    ],
  })
}

/**
 * @param {string} rule
 * @param {string} title
 * @returns {any}
 */
const finding = (rule, title) => ({
  rule,
  title,
  severity: 'warning',
  detail: '',
  fix: '',
  wastedTokens: 100,
  wastedCostUsd: 0.01,
  evidence: {},
})

describe('dismissals', () => {
  /** @type {import('better-sqlite3').Database} */
  let db

  beforeEach(() => {
    db = openDatabase(':memory:')
    seed(db, 'sess-1')
  })

  it('keys on what a finding is, not on a row id', () => {
    // Rule and title, because ids are regenerated on every run and the numbers
    // behind a finding move while the finding stays the same one.
    const key = dismissalKey('sess-1', 'redundant-read', 'src/app.js read 15 times')
    expect(key.split(NUL)).toEqual([
      'sess-1',
      'redundant-read',
      'src/app.js read 15 times',
    ])
  })

  it('records and lists a dismissal', () => {
    dismissFinding(db, 'sess-1', 'redundant-read', 'read twice', 1_700_000_000_000)
    const listed = listDismissals(db, 'sess-1')
    expect(listed[dismissalKey('sess-1', 'redundant-read', 'read twice')]).toBe(
      1_700_000_000_000,
    )
  })

  it('is idempotent — dismissing twice updates the time rather than failing', () => {
    dismissFinding(db, 'sess-1', 'r', 't', 1000)
    dismissFinding(db, 'sess-1', 'r', 't', 2000)
    expect(listDismissals(db, 'sess-1')[dismissalKey('sess-1', 'r', 't')]).toBe(2000)
  })

  it('restores', () => {
    dismissFinding(db, 'sess-1', 'r', 't')
    restoreFinding(db, 'sess-1', 'r', 't')
    expect(listDismissals(db, 'sess-1')).toEqual({})
  })

  it('survives the findings table being replaced wholesale', () => {
    replaceFindings(db, 'sess-1', [finding('redundant-read', 'read twice')])
    dismissFinding(db, 'sess-1', 'redundant-read', 'read twice', 500)

    // What happens on every request that runs the rules again.
    replaceFindings(db, 'sess-1', [finding('redundant-read', 'read twice')])

    expect(listFindings(db, 'sess-1')).toHaveLength(1)
    const key = dismissalKey('sess-1', 'redundant-read', 'read twice')
    expect(listDismissals(db, 'sess-1')[key]).toBe(500)
  })

  it('scopes to one session, and lists every session when asked', () => {
    seed(db, 'sess-2')
    dismissFinding(db, 'sess-1', 'r', 't', 100)
    dismissFinding(db, 'sess-2', 'r', 't', 200)

    expect(Object.keys(listDismissals(db, 'sess-1'))).toHaveLength(1)
    expect(Object.keys(listDismissals(db))).toHaveLength(2)
  })

  it('marks findings without mutating them', () => {
    const findings = [finding('r', 't'), finding('r', 'other')]
    dismissFinding(db, 'sess-1', 'r', 't', 700)

    const marked = markDismissed(findings, 'sess-1', listDismissals(db, 'sess-1'))
    expect(marked[0].dismissedAt).toBe(700)
    expect(marked[1].dismissedAt).toBeUndefined()
    expect(findings[0]).not.toHaveProperty('dismissedAt')
  })

  it('goes when the session goes', () => {
    dismissFinding(db, 'sess-1', 'r', 't')
    db.prepare('DELETE FROM sessions WHERE id = ?').run('sess-1')
    expect(listDismissals(db, 'sess-1')).toEqual({})
    closeDatabase(db)
  })
})
