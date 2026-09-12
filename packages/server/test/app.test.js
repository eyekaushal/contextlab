import { createSessionTracker } from '@contextlab/core'
import { closeDatabase, openDatabase } from '@contextlab/store'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { ingestCapture } from '../src/ingest.js'

const npmLog = 'npm WARN deprecated thing@1.0.0 please upgrade\n'.repeat(400)

/**
 * @param {number} turn
 * @returns {any}
 */
function capture(turn) {
  return {
    schemaVersion: 1,
    id: `cap-${turn}`,
    capturedAt: new Date(
      Date.parse('2026-09-11T10:00:00Z') + turn * 60_000,
    ).toISOString(),
    transport: 'reverse-proxy',
    tool: 'claude',
    sessionTag: 'a1b2c3d4',
    provider: 'anthropic',
    apiFormat: 'anthropic-messages',
    request: {
      method: 'POST',
      path: '/v1/messages',
      headers: { 'user-agent': 'claude-cli/1.2.3' },
      body: {
        model: 'claude-opus-4-5',
        system:
          'You are Claude Code\nPrimary working directory: /repo/contextlab\n' +
          'Contents: /repo/contextlab/CLAUDE.md\n' +
          'Contents of /repo/contextlab/CLAUDE.md (project instructions):\n' +
          '# rules\n'.repeat(80),
        tools: [
          {
            name: 'Bash',
            description: 'Run a command',
            input_schema: { type: 'object' },
          },
          {
            name: 'mcp__playwright__click',
            description: 'Click an element on the page, identified by a CSS selector',
            input_schema: {
              type: 'object',
              properties: { selector: { type: 'string' } },
            },
          },
        ],
        messages: [
          { role: 'user', content: 'the authentication middleware is failing' },
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
        usage: { input_tokens: 40_000 + turn * 1000, output_tokens: 200 },
      },
      bodyBytes: 900,
    },
    timing: { startedAt: Date.now(), firstByteMs: 300, completedMs: 2000 },
  }
}

describe('the API', () => {
  /** @type {any} */
  let db
  /** @type {any} */
  let app
  /** @type {any} */
  let hub
  /** @type {string} */
  let sessionId

  beforeEach(() => {
    db = openDatabase(':memory:')
    const built = createApp({ db })
    app = built.app
    hub = built.hub

    const tracker = createSessionTracker()
    for (let turn = 0; turn < 4; turn += 1) {
      const result = ingestCapture(db, capture(turn), { tracker })
      sessionId = String(result.sessionId)
    }
  })

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   * @returns {Promise<{ status: number, body: any }>}
   */
  async function get(path, init) {
    const response = await app.fetch(new Request(`http://localhost${path}`, init))
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  it('answers a health check', async () => {
    const { status, body } = await get('/api/health')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })

  describe('screen 1 — sessions', () => {
    it('lists sessions in camelCase, not database column names', async () => {
      const { body } = await get('/api/sessions')
      expect(body.sessions).toHaveLength(1)
      const [session] = body.sessions
      // The dashboard should never have to know a column is called turn_count.
      expect(session.turnCount).toBe(4)
      expect(session.projectName).toBe('contextlab')
      expect(session).not.toHaveProperty('turn_count')
    })

    it('filters the list by what was said inside a session', async () => {
      const hit = await get('/api/sessions?q=authentication')
      expect(hit.body.sessions).toHaveLength(1)

      const miss = await get('/api/sessions?q=nonexistentphrase')
      expect(miss.body.sessions).toHaveLength(0)
    })

    it('searches message content and highlights the match', async () => {
      const { body } = await get('/api/search?q=ELIFECYCLE')
      expect(Array.isArray(body.results)).toBe(true)

      const found = await get('/api/search?q=authentication')
      expect(found.body.results[0].snippet).toContain('[authentication]')
      expect(found.body.results[0].sessionId).toBe(sessionId)
    })

    it('reports how many times a query matched, and with what text', async () => {
      const { body } = await get('/api/sessions?q=authentication')
      const [session] = body.sessions
      // A filtered list without evidence is a claim the reader must trust.
      expect(session.matches).toBeGreaterThan(0)
      expect(session.snippet).toContain('[authentication]')
    })

    it('carries a context trend for the sparkline, one query for all rows', async () => {
      const { body } = await get('/api/sessions')
      const [session] = body.sessions
      expect(session.trend).toHaveLength(4)
      expect(session.trend.every((/** @type {any} */ n) => typeof n === 'number')).toBe(
        true,
      )
    })

    it('filters by source, model and project', async () => {
      expect((await get('/api/sessions?tool=claude')).body.sessions).toHaveLength(1)
      expect((await get('/api/sessions?tool=codex')).body.sessions).toHaveLength(0)
      expect(
        (await get('/api/sessions?model=claude-opus-4-5-20260101')).body.sessions,
      ).toHaveLength(1)
      expect((await get('/api/sessions?model=gpt-5')).body.sessions).toHaveLength(0)
      expect(
        (await get('/api/sessions?project=/repo/contextlab')).body.sessions,
      ).toHaveLength(1)
    })

    it('applies filters and search together', async () => {
      // Searching inside a filter must stay inside it.
      expect(
        (await get('/api/sessions?q=authentication&tool=codex')).body.sessions,
      ).toHaveLength(0)
      expect(
        (await get('/api/sessions?q=authentication&tool=claude')).body.sessions,
      ).toHaveLength(1)
    })

    it('offers only filter values that will actually return something', async () => {
      const { body } = await get('/api/filters')
      expect(body.tools).toEqual(['claude'])
      expect(body.models).toEqual(['claude-opus-4-5-20260101'])
      expect(body.projects[0].name).toBe('contextlab')
    })

    it('does not blow up on punctuation a user would type', async () => {
      const { status } = await get(`/api/search?q=${encodeURIComponent('npm ERR!')}`)
      expect(status).toBe(200)
    })
  })

  describe('screen 2 — session overview', () => {
    it('returns everything the screen needs in one request', async () => {
      const { body } = await get(`/api/sessions/${sessionId}`)
      expect(body.session.turnCount).toBe(4)
      expect(body.turns).toHaveLength(4)
      expect(body.composition.map((/** @type {any} */ row) => row.category)).toContain(
        'tool_results',
      )
      expect(body.systemSegments.length).toBeGreaterThan(0)
      expect(body.attribution.length).toBeGreaterThan(0)
      // The npm log, stored once, present in every turn.
      expect(body.repeated[0].turnsPresent).toBe(4)
    })

    it('segments the system prompt into pieces the user owns', async () => {
      const { body } = await get(`/api/sessions/${sessionId}`)
      const labels = body.systemSegments.map(
        (/** @type {any} */ segment) => segment.label,
      )
      expect(labels).toContain('CLAUDE.md')
      expect(labels).toContain('base prompt')
    })

    it('returns only the delta between one turn and the last', async () => {
      const session = await get(`/api/sessions/${sessionId}`)
      const second = session.body.turns[1]
      const { body } = await get(`/api/sessions/${sessionId}/turns/${second.id}`)

      // Two near-identical full bars are unreadable; only what changed is sent.
      expect(Array.isArray(body.delta)).toBe(true)
      for (const row of body.delta) expect(row.delta).not.toBe(0)
      expect(body.composition.length).toBeGreaterThan(0)
    })

    it('sends no delta for the first turn, which has nothing to compare to', async () => {
      const session = await get(`/api/sessions/${sessionId}`)
      const first = session.body.turns[0]
      const { body } = await get(`/api/sessions/${sessionId}/turns/${first.id}`)
      expect(body.delta).toEqual([])
    })

    it('404s on a session that does not exist', async () => {
      const { status, body } = await get('/api/sessions/nope')
      expect(status).toBe(404)
      expect(body.error).toBeTruthy()
    })
  })

  describe('screen 3 — messages', () => {
    it('groups blocks back into messages and pins the system prompt as turn 0', async () => {
      const { body } = await get(`/api/sessions/${sessionId}/messages`)

      expect(body.messages.length).toBeGreaterThan(0)
      expect(body.messages[0].blocks.length).toBeGreaterThan(0)
      expect(body.messages[0].tokens).toBeGreaterThan(0)

      // The system prompt is routinely the largest single block, and the prior
      // tool never rendered it anywhere.
      expect(body.systemPrompt.tokens).toBeGreaterThan(0)
      expect(body.systemPrompt.segments.length).toBeGreaterThan(0)
    })

    it('flags content that has been re-sent across turns', async () => {
      const { body } = await get(`/api/sessions/${sessionId}/messages`)
      const blocks = body.messages.flatMap((/** @type {any} */ message) => message.blocks)
      const log = blocks.find(
        (/** @type {any} */ block) => block.blockType === 'tool_result',
      )
      expect(log.turnsPresent).toBe(4)
    })

    it('does not ship full block text in the list', async () => {
      const { body } = await get(`/api/sessions/${sessionId}/messages`)
      const blocks = body.messages.flatMap((/** @type {any} */ m) => m.blocks)
      const log = blocks.find((/** @type {any} */ b) => b.blockType === 'tool_result')

      // One stuck tool result can be eighty thousand characters. Drawing a list
      // of previews must not cost that on every load.
      expect(log.text).toBeUndefined()
      expect(log.preview.length).toBeLessThanOrEqual(200)
      expect(log.chars).toBeGreaterThan(1000)
    })

    it('serves one block in full, on demand', async () => {
      const list = await get(`/api/sessions/${sessionId}/messages`)
      const blocks = list.body.messages.flatMap((/** @type {any} */ m) => m.blocks)
      const log = blocks.find((/** @type {any} */ b) => b.blockType === 'tool_result')

      const { body } = await get(`/api/blocks/${log.id}`)
      expect(body.block.text.length).toBe(log.chars)
      expect(body.block.turnsPresent).toBe(4)
    })

    it('404s a block that does not exist', async () => {
      expect((await get('/api/blocks/999999')).status).toBe(404)
    })

    it('can be asked for a specific turn', async () => {
      const session = await get(`/api/sessions/${sessionId}`)
      const first = session.body.turns[0]
      const { body } = await get(`/api/sessions/${sessionId}/messages?turn=${first.id}`)
      expect(body.turn.id).toBe(first.id)
    })
  })

  describe('the sessions summary strip', () => {
    it('separates money lost from money a change might have saved', async () => {
      const { body } = await get('/api/summary')
      // Never one "wasted" figure. That is how a $6.08 session was listed as
      // $10.31 wasted.
      expect(body).toHaveProperty('recoverable')
      expect(body).toHaveProperty('potential')
      expect(body.sessions).toBe(1)
      expect(body.turns).toBe(4)
      expect(body.total).toBeGreaterThan(0)
      expect(body.recoverable).toBeLessThanOrEqual(body.total)
    })

    it('agrees with optimize on what is outstanding', async () => {
      const summary = await get('/api/summary')
      const optimize = await get('/api/optimize?limit=50')
      expect(summary.body.findings).toBe(optimize.body.total.count)
      expect(summary.body.critical).toBe(optimize.body.total.critical)
      expect(summary.body.recoverable).toBeCloseTo(optimize.body.total.recoverableUsd, 10)
    })

    it('says a budget is absent rather than inventing one', async () => {
      const { body } = await get('/api/summary')
      expect(body.budget.configured).toBe(false)
    })
  })

  describe('the sessions list', () => {
    it('reports findings on a session nothing has analysed yet', async () => {
      // The cache is written by whatever last ran the rules. Reading it without
      // refreshing would print zero findings for a session with findings.
      const fresh = openDatabase(':memory:')
      const tracker = createSessionTracker()
      for (let turn = 0; turn < 4; turn += 1)
        ingestCapture(fresh, capture(turn), { tracker })

      const { app: cold } = createApp({ db: fresh })
      const response = await cold.fetch(new Request('http://localhost/api/sessions'))
      const body = /** @type {any} */ (await response.json())

      expect(body.sessions[0].findingCount).toBeGreaterThan(0)
      closeDatabase(fresh)
    })

    it('reconciles the row the same way optimize reconciles the screen', async () => {
      const sessions = await get('/api/sessions')
      const optimize = await get(`/api/sessions/${sessionId}/optimize`)
      const [row] = sessions.body.sessions

      expect(row.findingCount).toBe(optimize.body.total.count)
      expect(row.recoverableCostUsd).toBeCloseTo(optimize.body.total.recoverableUsd, 10)
      expect(row.potentialCostUsd).toBeCloseTo(optimize.body.total.potentialUsd, 10)
    })

    it('carries the worst severity still standing, not a derived score', async () => {
      const { body } = await get('/api/sessions')
      const optimize = await get(`/api/sessions/${sessionId}/optimize`)
      const worst = optimize.body.findings.some(
        (/** @type {any} */ f) => f.severity === 'critical',
      )
      expect(body.sessions[0].worstSeverity).toBe(worst ? 'critical' : 'warning')
    })

    it('drops a dismissed finding out of the row and the strip together', async () => {
      const before = await get('/api/sessions')
      const target = (
        await get(`/api/sessions/${sessionId}/optimize`)
      ).body.findings.find(
        (/** @type {any} */ f) => f.claim === 'recoverable' && f.wastedCostUsd > 0,
      )

      await get('/api/findings/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, rule: target.rule, title: target.title }),
      })

      const after = await get('/api/sessions')
      const summary = await get('/api/summary')
      expect(after.body.sessions[0].findingCount).toBe(
        before.body.sessions[0].findingCount - 1,
      )
      expect(after.body.sessions[0].dismissedCount).toBe(1)
      expect(after.body.sessions[0].recoverableCostUsd).toBeCloseTo(
        before.body.sessions[0].recoverableCostUsd - target.wastedCostUsd,
        10,
      )
      expect(summary.body.findings).toBe(after.body.sessions[0].findingCount)
    })

    it('orders by a whitelist and ignores anything else', async () => {
      const byCost = await get('/api/sessions?sort=cost')
      expect(byCost.status).toBe(200)

      // ORDER BY cannot be a bound parameter, so an unknown key must fall back
      // rather than reach the query.
      const hostile = await get('/api/sessions?sort=id%3B%20DROP%20TABLE%20sessions')
      expect(hostile.status).toBe(200)
      expect((await get('/api/sessions')).body.sessions).toHaveLength(1)
    })
  })

  describe('screen 4 — optimize', () => {
    it('runs the rules and ranks them by money', async () => {
      const { body } = await get(`/api/sessions/${sessionId}/optimize`)
      expect(body.findings.length).toBeGreaterThan(0)
      const costs = body.findings.map(
        (/** @type {any} */ finding) => finding.wastedCostUsd,
      )
      expect([...costs].sort((a, b) => b - a)).toEqual(costs)
      expect(body.total.count).toBe(body.findings.length)
    })

    it('caches the findings so a reload is free', async () => {
      await get(`/api/sessions/${sessionId}/optimize`)
      const { body } = await get('/api/findings')
      expect(body.findings.length).toBeGreaterThan(0)
      expect(body.findings[0].wastedCostUsd).toBeGreaterThanOrEqual(0)
    })

    it('ranks waste across every recent session', async () => {
      const { body } = await get('/api/optimize?limit=10')
      expect(body.scanned).toBe(1)
      expect(body.reports.length).toBeGreaterThan(0)
      expect(body.total.recoverableUsd).toBeGreaterThan(0)

      const costs = body.reports.map((/** @type {any} */ r) => r.total.recoverableUsd)
      expect(
        [...costs].sort((/** @type {any} */ a, /** @type {any} */ b) => b - a),
      ).toEqual(costs)
    })

    it('carries the numbers behind each claim, so it can be checked', async () => {
      const { body } = await get(`/api/sessions/${sessionId}/optimize`)
      const resent = body.findings.find(
        (/** @type {any} */ f) => f.rule === 'stuck-oversized-result',
      )
      // tokens x turns is what the screen prints as its working out.
      expect(resent.evidence.tokens).toBeGreaterThan(0)
      expect(resent.evidence.turns).toBe(4)
      expect(resent.wastedTokens).toBe(resent.evidence.tokens * 3)
    })

    it('returns stored evidence as an object, not a json string', async () => {
      await get(`/api/sessions/${sessionId}/optimize`)
      const { body } = await get('/api/findings')
      // Freshly computed findings carry an object; stored ones held a string.
      // The client should not have to tell them apart.
      expect(typeof body.findings[0].evidence).not.toBe('string')
    })

    it('gives every finding an actual fix', async () => {
      const { body } = await get(`/api/sessions/${sessionId}/optimize`)
      for (const finding of body.findings) {
        expect(String(finding.fix).length).toBeGreaterThan(20)
      }
    })

    /**
     * @param {'dismiss' | 'restore'} action
     * @param {any} payload
     */
    const act = (action, payload) =>
      get(`/api/findings/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })

    it('dismisses a finding, and keeps it dismissed across a recompute', async () => {
      const before = await get(`/api/sessions/${sessionId}/optimize`)
      const target = before.body.findings.find(
        (/** @type {any} */ f) => f.claim === 'recoverable',
      )
      expect(target).toBeTruthy()

      const posted = await act('dismiss', {
        sessionId,
        rule: target.rule,
        title: target.title,
      })
      expect(posted.status).toBe(200)

      // A second GET re-runs the rules and replaces the findings table. The
      // dismissal has to outlive that, which is why it lives in its own table.
      const after = await get(`/api/sessions/${sessionId}/optimize`)
      const again = after.body.findings.find(
        (/** @type {any} */ f) => f.rule === target.rule && f.title === target.title,
      )

      // Still listed — set aside is not deleted.
      expect(again.dismissedAt).toBeGreaterThan(0)
      expect(after.body.total.dismissed).toBe(1)
      expect(after.body.total.count).toBe(before.body.total.count - 1)
      expect(after.body.total.recoverableUsd).toBeCloseTo(
        before.body.total.recoverableUsd - target.wastedCostUsd,
        10,
      )
    })

    it('restores what it dismissed', async () => {
      const before = await get(`/api/sessions/${sessionId}/optimize`)
      const target = before.body.findings[0]

      await act('dismiss', { sessionId, rule: target.rule, title: target.title })
      await act('restore', { sessionId, rule: target.rule, title: target.title })

      const after = await get(`/api/sessions/${sessionId}/optimize`)
      expect(after.body.total.dismissed).toBe(0)
      expect(after.body.total.count).toBe(before.body.total.count)
    })

    it('leaves a dismissal out of the cross-session report too', async () => {
      const before = await get('/api/optimize?limit=10')
      const target = before.body.reports[0].findings[0]

      await act('dismiss', {
        sessionId: before.body.reports[0].session.id,
        rule: target.rule,
        title: target.title,
      })

      const after = await get('/api/optimize?limit=10')
      expect(after.body.total.count).toBe(before.body.total.count - 1)
    })

    it('refuses a request that names no finding', async () => {
      expect((await act('dismiss', { sessionId })).status).toBe(400)
      expect((await act('dismiss', null)).status).toBe(400)
      expect((await act(/** @type {any} */ ('shred'), { sessionId })).status).toBe(404)
    })
  })

  describe('cost and pricing', () => {
    it('groups by day and by project', async () => {
      const days = await get('/api/cost?by=day')
      expect(days.body.rows[0].turns).toBe(4)

      const projects = await get('/api/cost?by=project')
      expect(projects.body.rows[0].project).toBe('contextlab')
    })

    it('stamps the pricing date, rather than implying it is current', async () => {
      const { body } = await get('/api/pricing')
      expect(body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(body.providers).toContain('anthropic')
    })
  })

  describe('ingest endpoint', () => {
    it('accepts a capture from the mitmproxy addon and announces it', async () => {
      /** @type {any[]} */
      const seen = []
      hub.subscribe((/** @type {any} */ event) => seen.push(event))

      const response = await app.fetch(
        new Request('http://localhost/api/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(capture(9)),
        }),
      )
      const body = await response.json()

      expect(body.status).toBe('stored')
      expect(seen.some((/** @type {any} */ event) => event.type === 'turn')).toBe(true)
    })

    it('rejects a body that is not a capture', async () => {
      const response = await app.fetch(
        new Request('http://localhost/api/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'not json',
        }),
      )
      expect(response.status).toBe(400)
    })
  })

  it('404s an unknown api route as json', async () => {
    const { status, body } = await get('/api/nothing-here')
    expect(status).toBe(404)
    expect(body.error).toBeTruthy()
  })

  it('closes cleanly', () => {
    closeDatabase(db)
  })
})

describe('the event hub', () => {
  it('delivers to every subscriber and stops after unsubscribe', async () => {
    const db = openDatabase(':memory:')
    const { hub } = createApp({ db })

    /** @type {string[]} */
    const a = []
    /** @type {string[]} */
    const b = []
    const stop = hub.subscribe((event) => a.push(event.type))
    hub.subscribe((event) => b.push(event.type))

    hub.publish({ type: 'turn' })
    stop()
    hub.publish({ type: 'turn' })

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(2)
    closeDatabase(db)
  })

  it('keeps going when one subscriber throws', () => {
    const db = openDatabase(':memory:')
    const { hub } = createApp({ db })

    /** @type {string[]} */
    const delivered = []
    hub.subscribe(() => {
      throw new Error('a tab closed mid-write')
    })
    hub.subscribe((event) => delivered.push(event.type))

    expect(() => hub.publish({ type: 'turn' })).not.toThrow()
    expect(delivered).toEqual(['turn'])
    closeDatabase(db)
  })
})

describe('what a block counts as, versus what it was billed', () => {
  /** @type {any} */
  let db
  /** @type {any} */
  let app
  /** @type {string} */
  let sessionId

  beforeEach(() => {
    db = openDatabase(':memory:')
    app = createApp({ db }).app
    sessionId = String(ingestCapture(db, capture(0)).sessionId)
  })

  /** @param {string} path */
  async function read(path) {
    const response = await app.fetch(new Request(`http://localhost${path}`))
    return response.json()
  }

  it('returns both numbers for every block', async () => {
    const body = await read(`/api/sessions/${sessionId}/messages`)
    const blocks = body.messages.flatMap((/** @type {any} */ m) => m.blocks)
    const text = blocks.find((/** @type {any} */ b) => b.blockType === 'text')

    expect(text.tokensEstimated).toBeGreaterThan(0)
    // A short message must never be reported as thousands of tokens just
    // because it sat inside an expensive turn.
    expect(text.tokensEstimated).toBeLessThan(text.chars)
  })

  it('gives the overview the same totals optimize computes', async () => {
    const overview = await read(`/api/sessions/${sessionId}`)
    const optimize = await read(`/api/sessions/${sessionId}/optimize`)

    expect(overview.total.count).toBe(optimize.total.count)
    expect(overview.total.critical).toBe(optimize.total.critical)
    expect(overview.total.recoverableUsd).toBeCloseTo(optimize.total.recoverableUsd)
  })
})
