import { describe, expect, it } from 'vitest'
import {
  detectProvider,
  parseUrlTag,
  resolveUpstream,
  routeRequest,
  shouldCapture,
} from '../src/route.js'

describe('parseUrlTag', () => {
  it('splits tool and session tag off the front', () => {
    expect(parseUrlTag('/claude/a1b2c3d4/v1/messages')).toEqual({
      tool: 'claude',
      sessionTag: 'a1b2c3d4',
      path: '/v1/messages',
      search: '',
    })
  })

  it('keeps the query string', () => {
    const tag = parseUrlTag(
      '/gemini/v1beta/models/gemini-2.5-pro:generateContent?alt=sse',
    )
    expect(tag.path).toBe('/v1beta/models/gemini-2.5-pro:generateContent')
    expect(tag.search).toBe('?alt=sse')
  })

  it('treats a bare provider name as routing, not as a tool identity', () => {
    const tag = parseUrlTag('/anthropic/v1/messages')
    expect(tag.tool).toBeNull()
    expect(tag.path).toBe('/v1/messages')
  })

  it('does not mistake an API segment for a tool name', () => {
    expect(parseUrlTag('/v1/messages').tool).toBeNull()
    expect(parseUrlTag('/v1/messages').path).toBe('/v1/messages')
  })

  it('recognises v1internal even with a method glued on', () => {
    const tag = parseUrlTag('/v1internal:generateContent')
    expect(tag.tool).toBeNull()
    expect(tag.path).toBe('/v1internal:generateContent')
  })

  it('only accepts 8 hex characters as a session tag', () => {
    expect(parseUrlTag('/claude/notahextag/v1/messages').sessionTag).toBeNull()
    expect(parseUrlTag('/claude/notahextag/v1/messages').path).toBe(
      '/notahextag/v1/messages',
    )
  })

  it('refuses a traversal attempt in the tool segment', () => {
    const tag = parseUrlTag('/%2e%2e%2f%2e%2e/v1/messages')
    expect(tag.tool).toBeNull()
  })
})

describe('detectProvider', () => {
  it('checks chatgpt before everything else', () => {
    expect(detectProvider('/backend-api/codex/responses', {})).toEqual({
      provider: 'chatgpt',
      apiFormat: 'chatgpt-backend',
    })
  })

  it('finds anthropic by path or by header', () => {
    expect(detectProvider('/v1/messages', {}).provider).toBe('anthropic')
    expect(
      detectProvider('/anything', { 'anthropic-version': '2023-06-01' }).provider,
    ).toBe('anthropic')
  })

  it('checks vertex before gemini', () => {
    const path =
      '/v1/projects/p/locations/us-east4/publishers/google/models/gemini-2.5-pro:generateContent'
    expect(detectProvider(path, {})).toEqual({ provider: 'vertex', apiFormat: 'gemini' })
  })

  it('finds gemini by method suffix, path, or key header', () => {
    expect(detectProvider('/v1beta/models/x:generateContent', {}).provider).toBe('gemini')
    expect(detectProvider('/v1internal:loadCodeAssist', {}).provider).toBe('gemini')
    expect(detectProvider('/whatever', { 'x-goog-api-key': 'k' }).provider).toBe('gemini')
  })

  it('separates the two openai formats', () => {
    expect(detectProvider('/v1/responses', {}).apiFormat).toBe('responses')
    expect(detectProvider('/v1/chat/completions', {}).apiFormat).toBe('chat-completions')
  })

  it('falls back to openai on a bearer key, with the format left open', () => {
    expect(detectProvider('/mystery', { authorization: 'Bearer sk-abc' })).toEqual({
      provider: 'openai',
      apiFormat: 'unknown',
    })
  })

  it('gives up honestly', () => {
    expect(detectProvider('/mystery', {}).provider).toBe('unknown')
  })
})

describe('resolveUpstream', () => {
  it('reads the vertex region out of the path', () => {
    const path =
      '/v1/projects/p/locations/europe-west4/publishers/google/models/m:generateContent'
    expect(resolveUpstream('vertex', path, {})).toBe(
      'https://europe-west4-aiplatform.googleapis.com',
    )
  })

  it('sends code assist traffic to a different host than the gemini api', () => {
    expect(resolveUpstream('gemini', '/v1beta/models/m:generateContent', {})).toBe(
      'https://generativelanguage.googleapis.com',
    )
    expect(resolveUpstream('gemini', '/v1internal:generateContent', {})).toBe(
      'https://cloudcode-pa.googleapis.com',
    )
  })

  it('lets an env var override the upstream, for copilot and local gateways', () => {
    const env = { UPSTREAM_OPENAI_URL: 'https://api.githubcopilot.com/' }
    expect(resolveUpstream('openai', '/chat/completions', env)).toBe(
      'https://api.githubcopilot.com',
    )
  })
})

describe('shouldCapture', () => {
  it('captures a real turn', () => {
    expect(shouldCapture('POST', '/v1/messages', 'anthropic-messages')).toBe(true)
  })

  it('skips utility endpoints that are not turns', () => {
    expect(shouldCapture('POST', '/v1/messages/count_tokens', 'anthropic-messages')).toBe(
      false,
    )
    expect(shouldCapture('POST', '/v1internal:loadCodeAssist', 'gemini')).toBe(false)
    expect(shouldCapture('POST', '/v1beta/models/m:countTokens', 'gemini')).toBe(false)
  })

  it('skips anything that is not a POST', () => {
    expect(shouldCapture('GET', '/v1/models', 'anthropic-messages')).toBe(false)
  })
})

describe('routeRequest', () => {
  it('produces one decision for the whole request', () => {
    const route = routeRequest(
      '/claude/a1b2c3d4/v1/messages',
      'POST',
      { 'anthropic-version': '2023-06-01' },
      {},
    )
    expect(route).toEqual({
      tool: 'claude',
      sessionTag: 'a1b2c3d4',
      provider: 'anthropic',
      apiFormat: 'anthropic-messages',
      upstreamPath: '/v1/messages',
      upstreamBase: 'https://api.anthropic.com',
      capture: true,
    })
  })

  it('refuses to guess an upstream it cannot identify', () => {
    const route = routeRequest('/mystery', 'POST', {}, {})
    expect(route.upstreamBase).toBeNull()
    expect(route.capture).toBe(false)
  })
})
