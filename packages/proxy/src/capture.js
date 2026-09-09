/**
 * Capture files: what gets written, and where.
 *
 * A capture is the raw request and the raw response, with every credential
 * removed. No parsing, no token counting, no interpretation — all of that
 * happens in the other process, from these files.
 *
 * @module
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { CAPTURE_SCHEMA_VERSION } from './constants.js'
import { redactHeaders } from './headers.js'

/** @typedef {import('./headers.js').RawHeaders} RawHeaders */

/**
 * @typedef {Object} CaptureBody
 * @property {unknown} value          parsed JSON, decoded text, or base64
 * @property {'json' | 'text' | 'base64' | 'empty'} encoding
 * @property {number} bytes           size on the wire, before decompression
 * @property {boolean} truncated      did we hit MAX_CAPTURE_BYTES?
 */

/**
 * Resolve the contextlab home directory.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function contextlabHome(env = process.env) {
  return env.CONTEXTLAB_HOME || join(homedir(), '.contextlab')
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function capturesDir(env = process.env) {
  return join(contextlabHome(env), 'captures')
}

/**
 * Turn a body buffer into something a human can read in the capture file.
 *
 * Providers gzip or brotli their JSON responses. Storing those bytes as base64
 * would make every capture opaque, so we decompress here — one zlib call, no
 * interpretation of what is inside.
 *
 * @param {Buffer} buffer
 * @param {string} contentType
 * @param {string} contentEncoding
 * @param {boolean} truncated
 * @returns {CaptureBody}
 */
export function decodeBody(buffer, contentType, contentEncoding, truncated) {
  const bytes = buffer.length
  if (bytes === 0) return { value: null, encoding: 'empty', bytes, truncated }

  let decompressed = buffer
  if (contentEncoding && !truncated) {
    // A truncated stream cannot be decompressed — keep the raw bytes instead.
    try {
      decompressed = decompress(buffer, contentEncoding)
    } catch {
      return { value: buffer.toString('base64'), encoding: 'base64', bytes, truncated }
    }
  } else if (contentEncoding) {
    return { value: buffer.toString('base64'), encoding: 'base64', bytes, truncated }
  }

  const text = decompressed.toString('utf8')

  // JSON is stored parsed: the capture stays readable and the reader does not
  // have to guess whether a string is JSON. SSE stays raw text — the events
  // arrive across many frames and only make sense in order.
  if (!truncated && contentType.includes('json')) {
    try {
      return { value: JSON.parse(text), encoding: 'json', bytes, truncated }
    } catch {
      // Fall through: an unparseable body is still worth keeping verbatim.
    }
  }

  return { value: text, encoding: 'text', bytes, truncated }
}

/**
 * @param {Buffer} buffer
 * @param {string} encoding
 * @returns {Buffer}
 */
function decompress(buffer, encoding) {
  const name = encoding.toLowerCase().trim()
  if (name === 'identity') return buffer
  if (name === 'gzip' || name === 'x-gzip') return zlib.gunzipSync(buffer)
  if (name === 'deflate') return zlib.inflateSync(buffer)
  if (name === 'br') return zlib.brotliDecompressSync(buffer)
  // zstd landed in Node 22. Looked up at call time so this file still loads on 20.
  if (name === 'zstd' && zlib.zstdDecompressSync) return zlib.zstdDecompressSync(buffer)
  // Anything else: let zlib sniff it, and let the caller catch a throw.
  return zlib.unzipSync(buffer)
}

/**
 * Build the capture record. Pure — hand it buffers, get an object back.
 *
 * @param {Object} input
 * @param {import('./route.js').Route} input.route
 * @param {string} input.method
 * @param {string} input.originalUrl
 * @param {RawHeaders} input.requestHeaders
 * @param {Buffer} input.requestBody
 * @param {boolean} input.requestTruncated
 * @param {number} input.status
 * @param {RawHeaders} input.responseHeaders
 * @param {Buffer} input.responseBody
 * @param {boolean} input.responseTruncated
 * @param {{ startedAt: number, firstByteMs: number, completedMs: number }} input.timing
 * @returns {Record<string, unknown>}
 */
export function buildCapture(input) {
  const { route, timing } = input
  const requestType = headerOf(input.requestHeaders, 'content-type')
  const responseType = headerOf(input.responseHeaders, 'content-type')

  return {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    id: captureId(),
    capturedAt: new Date(timing.startedAt).toISOString(),
    transport: 'reverse-proxy',
    tool: route.tool,
    sessionTag: route.sessionTag,
    provider: route.provider,
    apiFormat: route.apiFormat,
    request: {
      method: input.method,
      originalUrl: input.originalUrl,
      url: `${route.upstreamBase ?? ''}${route.upstreamPath}`,
      path: route.upstreamPath,
      headers: redactHeaders(input.requestHeaders),
      ...bodyFields(
        decodeBody(input.requestBody, requestType, '', input.requestTruncated),
      ),
    },
    response: {
      status: input.status,
      headers: redactHeaders(input.responseHeaders),
      streaming: responseType.includes('event-stream'),
      ...bodyFields(
        decodeBody(
          input.responseBody,
          responseType,
          headerOf(input.responseHeaders, 'content-encoding'),
          input.responseTruncated,
        ),
      ),
    },
    timing,
  }
}

/**
 * @param {CaptureBody} body
 * @returns {Record<string, unknown>}
 */
function bodyFields(body) {
  return {
    body: body.value,
    bodyEncoding: body.encoding,
    bodyBytes: body.bytes,
    bodyTruncated: body.truncated,
  }
}

/**
 * @param {RawHeaders} headers
 * @param {string} name
 * @returns {string}
 */
function headerOf(headers, name) {
  const value = headers[name]
  if (value === undefined) return ''
  return Array.isArray(value) ? (value[0] ?? '') : value
}

/** @returns {string} */
function captureId() {
  return randomBytes(8).toString('hex')
}

/**
 * Write a capture to disk atomically.
 *
 * The server watches this directory, so a half-written file would be read as a
 * corrupt one. Write to a temp name, then rename — rename is atomic on every
 * filesystem we care about.
 *
 * @param {Record<string, unknown>} capture
 * @param {string} [dir]
 * @returns {string} the path written
 */
export function writeCapture(capture, dir = capturesDir()) {
  mkdirSync(dir, { recursive: true })
  const stamp = String(capture.capturedAt).replace(/[:.]/g, '-')
  const name = `${stamp}-${capture.id}.json`
  const finalPath = join(dir, name)
  const tempPath = `${finalPath}.tmp`
  writeFileSync(tempPath, JSON.stringify(capture, null, 2), 'utf8')
  renameSync(tempPath, finalPath)
  return finalPath
}
