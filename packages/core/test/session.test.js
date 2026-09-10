import { describe, expect, it } from 'vitest'
import { parseRequest } from '../src/parse/index.js'
import {
  contentFingerprint,
  createSessionTracker,
  explicitSessionId,
  firstRealUserMessage,
  SESSION_TTL_MS,
  workingDirectoryFrom,
} from '../src/session.js'

/**
 * @param {unknown} body
 * @returns {any}
 */
const parse = (body) => parseRequest(body, { apiFormat: 'anthropic-messages' })

describe('explicit session ids', () => {
  it('reads the header claude code sends', () => {
    expect(
      explicitSessionId({ headers: { 'x-claude-code-session-id': 'abc-123' } }),
    ).toBe('abc-123')
  })

  it('digs it out of anthropic metadata.user_id', () => {
    expect(
      explicitSessionId({ body: { metadata: { user_id: 'user_x_session_deadbeef99' } } }),
    ).toBe('deadbeef99')
  })

  it('finds the gemini code assist id inside its request wrapper', () => {
    expect(explicitSessionId({ body: { request: { session_id: 'g-42' } } })).toBe('g-42')
  })

  it('falls back to our own url tag last', () => {
    expect(explicitSessionId({ sessionTag: 'a1b2c3d4' })).toBe('tag:a1b2c3d4')
  })

  it('returns null when nothing identifies the session', () => {
    expect(explicitSessionId({ body: { model: 'x' } })).toBeNull()
  })
})

describe('working directory extraction', () => {
  it('recognises each agent phrasing', () => {
    expect(workingDirectoryFrom('Primary working directory: /repo/contextlab')).toBe(
      '/repo/contextlab',
    )
    expect(workingDirectoryFrom('<cwd>/home/me/project</cwd>')).toBe('/home/me/project')
    expect(workingDirectoryFrom('You are working in the directory: /srv/app')).toBe(
      '/srv/app',
    )
    expect(workingDirectoryFrom('cwd: ~/code/thing')).toBe('~/code/thing')
  })

  it('says nothing rather than guessing', () => {
    expect(workingDirectoryFrom('no path here')).toBeNull()
  })
})

describe('first real user message', () => {
  it('skips the boilerplate agents open with', () => {
    const parsed = parse({
      messages: [
        { role: 'user', content: '# AGENTS.md\nproject conventions' },
        { role: 'user', content: '<environment>node 22</environment>' },
        { role: 'user', content: 'fix the login bug' },
      ],
    })
    // Fingerprinting on the boilerplate makes every session in a repo identical.
    expect(firstRealUserMessage(parsed)).toBe('fix the login bug')
  })

  it('returns empty when the user has not said anything yet', () => {
    expect(firstRealUserMessage(parse({ messages: [] }))).toBe('')
  })
})

describe('content fingerprint', () => {
  it('is stable for the same conversation opening', () => {
    const body = {
      system: 'You are Claude Code',
      messages: [{ role: 'user', content: 'hi' }],
    }
    expect(contentFingerprint(parse(body))).toBe(contentFingerprint(parse(body)))
  })

  it('separates the same prompt in two different repos', () => {
    const inRepo = (/** @type {string} */ path) =>
      contentFingerprint(
        parse({
          system: `You are Claude Code\nPrimary working directory: ${path}`,
          messages: [{ role: 'user', content: 'fix the build' }],
        }),
      )
    // Without the working directory, every project collides.
    expect(inRepo('/repo/one')).not.toBe(inRepo('/repo/two'))
  })
})

describe('tracking sessions across turns', () => {
  const turn = (/** @type {string} */ text) => ({
    parsed: parse({
      system: 'You are Claude Code\nPrimary working directory: /repo/app',
      messages: [{ role: 'user', content: text }],
    }),
    headers: {},
    body: {},
  })

  it('keeps consecutive turns of one conversation together', () => {
    const tracker = createSessionTracker()
    const now = Date.now()
    const first = tracker.identify(turn('fix the build'), now)
    const second = tracker.identify(turn('fix the build'), now + 30_000)
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.how).toBe('fingerprint')
  })

  it('starts a new conversation when the same opening returns much later', () => {
    const tracker = createSessionTracker()
    const now = Date.now()
    const first = tracker.identify(turn('fix the build'), now)
    const later = tracker.identify(turn('fix the build'), now + SESSION_TTL_MS + 1000)
    // Two sessions that begin identically would otherwise merge into one.
    expect(later.sessionId).not.toBe(first.sessionId)
    expect(later.how).toBe('fingerprint-ttl')
  })

  it('follows a response chain when the format threads one', () => {
    const tracker = createSessionTracker()
    const first = tracker.identify({
      parsed: parse({ messages: [{ role: 'user', content: 'start' }] }),
      body: {},
      responseBody: { id: 'resp_1' },
    })
    const second = tracker.identify({
      parsed: parse({ messages: [{ role: 'user', content: 'totally different' }] }),
      body: { previous_response_id: 'resp_1' },
      responseBody: { id: 'resp_2' },
    })
    // The content differs completely; only the chain ties them together.
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.how).toBe('chained')
  })

  it('prefers an explicit id over everything else', () => {
    const tracker = createSessionTracker()
    const identity = tracker.identify({
      ...turn('fix the build'),
      headers: { 'x-claude-code-session-id': 'real-id' },
    })
    expect(identity).toMatchObject({ sessionId: 'real-id', how: 'explicit' })
  })

  it('carries the working directory out for project grouping', () => {
    const tracker = createSessionTracker()
    expect(tracker.identify(turn('hi')).workingDirectory).toBe('/repo/app')
  })

  it('still finds the working directory when the session id is explicit', () => {
    // The common case: our own proxy always supplies a tag, so the explicit
    // path is the one that runs, and it must not skip project detection.
    const tracker = createSessionTracker()
    const identity = tracker.identify({ ...turn('hi'), sessionTag: 'a1b2c3d4' })
    expect(identity.how).toBe('explicit')
    expect(identity.workingDirectory).toBe('/repo/app')
  })

  it('does not fall over on an unparseable request', () => {
    const tracker = createSessionTracker()
    const identity = tracker.identify({ parsed: null, body: {} })
    expect(identity.sessionId).toMatch(/^[0-9a-f]{16}$/)
  })
})
