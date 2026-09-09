import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startProxy } from '../src/server.js'

/**
 * A stand-in for api.anthropic.com that records what it was sent.
 *
 * @param {http.RequestListener} handler
 * @returns {Promise<http.Server>}
 */
function startUpstream(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

/** @param {import('node:http').Server} server */
function origin(server) {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return `http://127.0.0.1:${address.port}`
}

/**
 * POST to the proxy, reporting each chunk as it lands.
 *
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {string} body
 * @returns {Promise<{ status: number | undefined,
 *                     headers: http.IncomingHttpHeaders,
 *                     chunks: { text: string, at: number }[] }>}
 */
function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        /** @type {{ text: string, at: number }[]} */
        const chunks = []
        res.on('data', (/** @type {Buffer} */ c) =>
          chunks.push({ text: c.toString(), at: Date.now() }),
        )
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, chunks }),
        )
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

describe('proxy end to end', () => {
  /** @type {import('node:http').Server[]} */
  let servers = []
  /** @type {string} */
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'contextlab-test-'))
    servers = []
  })

  afterEach(async () => {
    for (const server of servers) await new Promise((r) => server.close(r))
    rmSync(dir, { recursive: true, force: true })
  })

  function captures() {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
  }

  it('forwards the request unchanged and captures the exchange', async () => {
    /** @type {{ url?: string, headers?: Record<string, unknown>, body?: string }} */
    const seen = {}
    const upstream = await startUpstream((req, res) => {
      seen.url = req.url
      seen.headers = req.headers
      /** @type {Buffer[]} */
      const chunks = []
      req.on('data', (/** @type {Buffer} */ c) => chunks.push(c))
      req.on('end', () => {
        seen.body = Buffer.concat(chunks).toString()
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ usage: { input_tokens: 12, output_tokens: 3 } }))
      })
    })
    servers.push(upstream)

    const proxy = await startProxy({
      port: 0,
      dir,
      env: { UPSTREAM_ANTHROPIC_URL: origin(upstream) },
    })
    servers.push(proxy)

    const body = JSON.stringify({ model: 'claude-opus-5', messages: [] })
    const res = await post(
      `${origin(proxy)}/claude/a1b2c3d4/v1/messages`,
      {
        'x-api-key': 'sk-ant-do-not-log-me',
        'anthropic-version': '2023-06-01',
        'user-agent': 'claude-cli/1.2.3',
      },
      body,
    )

    // The tool prefix is stripped; everything else arrives untouched.
    expect(seen.url).toBe('/v1/messages')
    expect(seen.body).toBe(body)
    expect(seen.headers?.['x-api-key']).toBe('sk-ant-do-not-log-me')
    expect(seen.headers?.host).toBe(new URL(origin(upstream)).host)
    expect(res.status).toBe(200)

    const [capture] = captures()
    expect(capture.tool).toBe('claude')
    expect(capture.sessionTag).toBe('a1b2c3d4')
    expect(capture.provider).toBe('anthropic')
    expect(capture.apiFormat).toBe('anthropic-messages')
    expect(capture.request.body).toEqual({ model: 'claude-opus-5', messages: [] })
    expect(capture.response.body.usage.input_tokens).toBe(12)
    expect(capture.request.headers['user-agent']).toBe('claude-cli/1.2.3')
  })

  it('never writes an API key to disk', async () => {
    const upstream = await startUpstream((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
      })
    })
    servers.push(upstream)
    const proxy = await startProxy({
      port: 0,
      dir,
      env: { UPSTREAM_ANTHROPIC_URL: origin(upstream) },
    })
    servers.push(proxy)

    await post(
      `${origin(proxy)}/claude/v1/messages`,
      {
        'x-api-key': 'sk-ant-do-not-log-me',
        authorization: 'Bearer sk-also-secret',
      },
      '{"messages":[]}',
    )

    const onDisk = readdirSync(dir)
      .map((name) => readFileSync(join(dir, name), 'utf8'))
      .join('')
    expect(onDisk).not.toContain('sk-ant-do-not-log-me')
    expect(onDisk).not.toContain('sk-also-secret')
    expect(onDisk).toContain('[redacted]')
  })

  it('streams SSE through as it arrives instead of buffering it', async () => {
    const upstream = await startUpstream((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('event: message_start\ndata: {"type":"message_start"}\n\n')
        setTimeout(() => {
          res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
          res.end()
        }, 120)
      })
    })
    servers.push(upstream)
    const proxy = await startProxy({
      port: 0,
      dir,
      env: { UPSTREAM_ANTHROPIC_URL: origin(upstream) },
    })
    servers.push(proxy)

    const res = await post(`${origin(proxy)}/claude/v1/messages`, {}, '{"stream":true}')

    // Two separate frames, ~120ms apart: proof the proxy did not wait for the
    // stream to finish before giving the tool the first token.
    expect(res.chunks.length).toBeGreaterThanOrEqual(2)
    const arrivals = res.chunks.map((c) => c.at)
    const gap = Math.max(...arrivals) - Math.min(...arrivals)
    expect(gap).toBeGreaterThan(50)

    const [capture] = captures()
    expect(capture.response.streaming).toBe(true)
    expect(capture.response.body).toContain('message_start')
    expect(capture.response.body).toContain('message_stop')
  })

  it('forwards utility endpoints but does not capture them', async () => {
    const upstream = await startUpstream((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"input_tokens":9}')
      })
    })
    servers.push(upstream)
    const proxy = await startProxy({
      port: 0,
      dir,
      env: { UPSTREAM_ANTHROPIC_URL: origin(upstream) },
    })
    servers.push(proxy)

    const res = await post(
      `${origin(proxy)}/claude/v1/messages/count_tokens`,
      {},
      '{"messages":[]}',
    )
    expect(res.status).toBe(200)
    expect(captures()).toHaveLength(0)
  })

  it('answers a health check without touching the network', async () => {
    const proxy = await startProxy({ port: 0, dir, env: {} })
    servers.push(proxy)
    const res = await /** @type {Promise<{ status?: number, body: string }>} */ (
      new Promise((resolve) => {
        http.get(`${origin(proxy)}/__contextlab/health`, (r) => {
          /** @type {Buffer[]} */
          const chunks = []
          r.on('data', (/** @type {Buffer} */ c) => chunks.push(c))
          r.on('end', () =>
            resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString() }),
          )
        })
      })
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).ok).toBe(true)
  })

  it('explains itself instead of hanging when it cannot route', async () => {
    const proxy = await startProxy({ port: 0, dir, env: {} })
    servers.push(proxy)
    const res = await post(`${origin(proxy)}/mystery/path`, {}, '{}')
    expect(res.status).toBe(502)
    expect(res.chunks.map((c) => c.text).join('')).toContain('contextlab_unroutable')
  })
})
