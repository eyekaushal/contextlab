import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeBody } from '../src/capture.js'
import { buildForwardHeaders, isSecretHeader, redactHeaders } from '../src/headers.js'

describe('redactHeaders', () => {
  it('destroys every credential it knows by name', () => {
    const redacted = redactHeaders({
      'x-api-key': 'sk-ant-secret',
      authorization: 'Bearer sk-secret',
      'x-goog-api-key': 'AIzaSecret',
      cookie: 'session=secret',
    })
    expect(Object.values(redacted)).toEqual([
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
    ])
  })

  it('destroys credentials it has never seen before', () => {
    expect(isSecretHeader('x-some-vendor-api-token')).toBe(true)
    expect(isSecretHeader('x-refresh-secret')).toBe(true)
    expect(isSecretHeader('x-vendor-auth')).toBe(true)
  })

  it('keeps the headers the parsers need', () => {
    const redacted = redactHeaders({
      'user-agent': 'claude-cli/1.2.3',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    })
    expect(redacted['user-agent']).toBe('claude-cli/1.2.3')
    expect(redacted['anthropic-version']).toBe('2023-06-01')
  })

  it('does not flag ordinary headers', () => {
    expect(isSecretHeader('content-type')).toBe(false)
    expect(isSecretHeader('user-agent')).toBe(false)
  })
})

describe('buildForwardHeaders', () => {
  it('passes the credential upstream — that is the job', () => {
    const out = buildForwardHeaders({ 'x-api-key': 'sk-real' }, 'api.anthropic.com', 10)
    expect(out['x-api-key']).toBe('sk-real')
  })

  it('rewrites host and drops connection-level headers', () => {
    const out = buildForwardHeaders(
      {
        host: 'localhost:4040',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
      },
      'api.anthropic.com',
      10,
    )
    expect(out.host).toBe('api.anthropic.com')
    expect(out.connection).toBeUndefined()
    expect(out['transfer-encoding']).toBeUndefined()
  })

  it('sets content-length from the body we actually buffered', () => {
    const out = buildForwardHeaders({ 'content-length': '999' }, 'api.openai.com', 42)
    expect(out['content-length']).toBe('42')
  })
})

describe('decodeBody', () => {
  it('stores json parsed, so captures stay readable', () => {
    const body = decodeBody(
      Buffer.from('{"model":"claude"}'),
      'application/json',
      '',
      false,
    )
    expect(body).toMatchObject({ encoding: 'json', value: { model: 'claude' } })
  })

  it('keeps an SSE stream as raw text, in order', () => {
    const sse = 'event: message_start\ndata: {"type":"message_start"}\n\n'
    const body = decodeBody(Buffer.from(sse), 'text/event-stream', '', false)
    expect(body.encoding).toBe('text')
    expect(body.value).toBe(sse)
  })

  it('decompresses gzip rather than storing an opaque blob', () => {
    const gzipped = gzipSync(Buffer.from('{"ok":true}'))
    const body = decodeBody(gzipped, 'application/json', 'gzip', false)
    expect(body).toMatchObject({ encoding: 'json', value: { ok: true } })
    expect(body.bytes).toBe(gzipped.length)
  })

  it('falls back to base64 when the bytes will not decompress', () => {
    const body = decodeBody(
      Buffer.from([0x1f, 0x8b, 0x00, 0x01]),
      'application/json',
      'gzip',
      false,
    )
    expect(body.encoding).toBe('base64')
  })

  it('does not try to parse a body it had to truncate', () => {
    const body = decodeBody(Buffer.from('{"half":'), 'application/json', '', true)
    expect(body.encoding).toBe('text')
    expect(body.truncated).toBe(true)
  })
})
