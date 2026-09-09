/**
 * Forwarding: send the request on, stream the response back untouched.
 *
 * The rule this file exists to keep: whatever the provider sends, the tool
 * receives, byte for byte, at the same time. Capturing is a side effect that
 * happens on a copy. If capturing breaks, forwarding still works.
 *
 * @module
 */

import http from 'node:http'
import https from 'node:https'
import { MAX_CAPTURE_BYTES } from './constants.js'
import { buildForwardHeaders, buildResponseHeaders } from './headers.js'

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */
/** @typedef {import('./headers.js').RawHeaders} RawHeaders */

// Connection reuse matters here: a coding agent makes many sequential calls and
// a fresh TLS handshake on each one is latency we would be adding ourselves.
const agents = {
  http: new http.Agent({ keepAlive: true }),
  https: new https.Agent({ keepAlive: true }),
}

/**
 * @typedef {Object} ForwardResult
 * @property {number} status
 * @property {RawHeaders} headers
 * @property {Buffer} body        response bytes, capped at MAX_CAPTURE_BYTES
 * @property {boolean} truncated
 * @property {{ startedAt: number, firstByteMs: number, completedMs: number }} timing
 */

/**
 * @typedef {Object} ForwardOptions
 * @property {import('./route.js').Route} route
 * @property {IncomingMessage} req
 * @property {ServerResponse} res
 * @property {Buffer} body           request body, already buffered
 * @property {boolean} collect       keep a copy of the response for capture
 * @property {(result: ForwardResult) => void} onComplete
 * @property {(error: Error) => void} onError
 */

/**
 * Forward one request upstream and stream the reply back.
 *
 * @param {ForwardOptions} options
 * @returns {void}
 */
export function forwardRequest(options) {
  const { route, req, res, body, collect, onComplete, onError } = options
  const base = route.upstreamBase
  if (base === null) {
    onError(new Error('no upstream for this request'))
    return
  }

  const target = new URL(route.upstreamPath, base)
  const isTls = target.protocol === 'https:'
  const transport = isTls ? https : http
  const startedAt = Date.now()

  const upstreamReq = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isTls ? 443 : 80),
      method: req.method,
      path: target.pathname + target.search,
      headers: buildForwardHeaders(req.headers, target.host, body.length),
      agent: isTls ? agents.https : agents.http,
    },
    (upstream) => {
      /** @type {Buffer[]} */
      const chunks = []
      let collected = 0
      let truncated = false
      let firstByteMs = -1

      res.writeHead(upstream.statusCode ?? 502, buildResponseHeaders(upstream.headers))
      // Server-sent events are useless if they arrive in batches: the whole
      // point is that the tool renders tokens as they are produced.
      res.flushHeaders()
      upstream.socket?.setNoDelay(true)
      res.socket?.setNoDelay(true)

      upstream.on('data', (chunk) => {
        if (firstByteMs === -1) firstByteMs = Date.now() - startedAt

        // The tool comes first. Always.
        const flushed = res.write(chunk)
        if (!flushed) {
          upstream.pause()
          res.once('drain', () => upstream.resume())
        }

        if (!collect || truncated) return
        if (collected + chunk.length > MAX_CAPTURE_BYTES) {
          truncated = true
          return
        }
        chunks.push(chunk)
        collected += chunk.length
      })

      upstream.on('end', () => {
        res.end()
        onComplete({
          status: upstream.statusCode ?? 502,
          headers: upstream.headers,
          body: Buffer.concat(chunks),
          truncated,
          timing: {
            startedAt,
            firstByteMs: firstByteMs === -1 ? Date.now() - startedAt : firstByteMs,
            completedMs: Date.now() - startedAt,
          },
        })
      })

      upstream.on('error', (error) => {
        res.destroy()
        onError(error)
      })
    },
  )

  upstreamReq.on('error', onError)

  // If the tool gives up — Ctrl-C in the middle of a long generation — stop
  // paying the provider for output nobody will read.
  res.on('close', () => {
    if (!upstreamReq.destroyed && !res.writableFinished) upstreamReq.destroy()
  })

  upstreamReq.end(body)
}

/**
 * Read a request body into memory, whole.
 *
 * We buffer rather than stream because the capture needs the exact bytes that
 * were sent, and because knowing the length lets us send a clean
 * content-length instead of re-chunking.
 *
 * There is deliberately no size cap here: a request we only half-forward is a
 * corrupted API call. The cap applies to the *copy* kept for the capture file,
 * which is what `captureSlice` is for.
 *
 * @param {IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Trim a body down to what we are willing to hold in a capture file.
 *
 * @param {Buffer} body
 * @returns {{ body: Buffer, truncated: boolean }}
 */
export function captureSlice(body) {
  if (body.length <= MAX_CAPTURE_BYTES) return { body, truncated: false }
  return { body: body.subarray(0, MAX_CAPTURE_BYTES), truncated: true }
}
