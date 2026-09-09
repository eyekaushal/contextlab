/**
 * The proxy server. Listens on localhost, forwards, captures.
 *
 * This is the only process in contextlab that ever sees an API key. It holds
 * one in memory for the length of one forwarded request and writes it nowhere.
 *
 * @module
 */

import http from 'node:http'
import { buildCapture, capturesDir, writeCapture } from './capture.js'
import { DEFAULT_PORT } from './constants.js'
import { captureSlice, forwardRequest, readBody } from './forward.js'
import { routeRequest } from './route.js'

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */

/**
 * @typedef {Object} ProxyOptions
 * @property {number} [port]
 * @property {string} [host]
 * @property {string} [dir]      where captures are written
 * @property {Record<string, string | undefined>} [env]
 * @property {(event: ProxyEvent) => void} [onEvent]
 */

/**
 * @typedef {Object} ProxyEvent
 * @property {'capture' | 'skip' | 'error' | 'listening'} type
 * @property {string} [message]
 * @property {string} [path]
 * @property {import('./route.js').Route} [route]
 * @property {number} [status]
 */

/**
 * Build the proxy server without starting it. Useful in tests.
 *
 * @param {ProxyOptions} [options]
 * @returns {import('node:http').Server}
 */
export function createProxyServer(options = {}) {
  const env = options.env ?? process.env
  const dir = options.dir ?? capturesDir(env)
  const emit = options.onEvent ?? (() => {})

  const server = http.createServer((req, res) => {
    handle(req, res, { env, dir, emit }).catch((error) => {
      fail(res, error)
      emit({ type: 'error', message: String(error) })
    })
  })

  // A streamed response can legitimately take minutes. Node's default header
  // timeout would cut off a long generation, which is exactly the kind of
  // "the proxy broke my agent" failure that loses trust.
  server.requestTimeout = 0
  server.headersTimeout = 0
  server.timeout = 0
  server.keepAliveTimeout = 76_000

  return server
}

/**
 * Start the proxy.
 *
 * @param {ProxyOptions} [options]
 * @returns {Promise<import('node:http').Server>}
 */
export function startProxy(options = {}) {
  const port = options.port ?? DEFAULT_PORT
  const host = options.host ?? '127.0.0.1'
  const server = createProxyServer(options)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      options.onEvent?.({ type: 'listening', message: `http://${host}:${port}` })
      resolve(server)
    })
  })
}

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {{ env: Record<string, string | undefined>, dir: string,
 *           emit: (event: ProxyEvent) => void }} ctx
 * @returns {Promise<void>}
 */
async function handle(req, res, ctx) {
  const rawUrl = req.url ?? '/'
  const method = req.method ?? 'GET'

  if (rawUrl === '/__contextlab/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'contextlab-proxy' }))
    return
  }

  const route = routeRequest(rawUrl, method, req.headers, ctx.env)
  const requestBody = await readBody(req)

  if (route.upstreamBase === null) {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          type: 'contextlab_unroutable',
          message:
            `Could not tell which provider ${rawUrl} belongs to. ` +
            'Point the tool at http://localhost:4040/<tool> and let it append ' +
            'its own API path, or set UPSTREAM_OPENAI_URL.',
        },
      }),
    )
    ctx.emit({ type: 'error', message: `unroutable: ${rawUrl}`, route })
    return
  }

  forwardRequest({
    route,
    req,
    res,
    body: requestBody,
    collect: route.capture,
    onComplete: (result) => {
      if (!route.capture) {
        ctx.emit({ type: 'skip', path: route.upstreamPath, route })
        return
      }
      // Capturing must never be able to break a request that already
      // succeeded. The tool has its response; everything past this point is
      // bookkeeping.
      try {
        const request = captureSlice(requestBody)
        const capture = buildCapture({
          route,
          method,
          originalUrl: rawUrl,
          requestHeaders: req.headers,
          requestBody: request.body,
          requestTruncated: request.truncated,
          status: result.status,
          responseHeaders: result.headers,
          responseBody: result.body,
          responseTruncated: result.truncated,
          timing: result.timing,
        })
        writeCapture(capture, ctx.dir)
        ctx.emit({ type: 'capture', route, status: result.status })
      } catch (error) {
        ctx.emit({ type: 'error', message: `capture failed: ${String(error)}` })
      }
    },
    onError: (error) => {
      fail(res, error)
      ctx.emit({ type: 'error', message: String(error), route })
    },
  })
}

/**
 * Report an upstream failure to the tool, if it is still listening.
 *
 * @param {ServerResponse} res
 * @param {unknown} error
 * @returns {void}
 */
function fail(res, error) {
  if (res.headersSent || res.writableEnded) {
    res.destroy()
    return
  }
  res.writeHead(502, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      error: { type: 'contextlab_upstream_error', message: String(error) },
    }),
  )
}
