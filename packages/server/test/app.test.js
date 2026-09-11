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

    it('can be asked for a specific turn', async () => {
      const session = await get(`/api/sessions/${sessionId}`)
      const first = session.body.turns[0]
      const { body } = await get(`/api/sessions/${sessionId}/messages?turn=${first.id}`)
      expect(body.turn.id).toBe(first.id)
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

    it('gives every finding an actual fix', async () => {
      const { body } = await get(`/api/sessions/${sessionId}/optimize`)
      for (const finding of body.findings) {
        expect(String(finding.fix).length).toBeGreaterThan(20)
      }
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
