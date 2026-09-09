/**
 * Header handling: what we send upstream, and what we allow onto disk.
 *
 * Pure functions. No I/O.
 *
 * @module
 */

import { HOP_BY_HOP_HEADERS, SECRET_HEADER_PATTERN, SECRET_HEADERS } from './constants.js'

/** @typedef {Record<string, string | string[] | undefined>} RawHeaders */

/**
 * True if this header's value must never be written to a capture file.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isSecretHeader(name) {
  const lower = name.toLowerCase()
  return SECRET_HEADERS.has(lower) || SECRET_HEADER_PATTERN.test(lower)
}

/**
 * Replace every credential with a fixed marker, keeping the header names so
 * the parsers can still identify the tool from `user-agent`, the API version
 * from `anthropic-version`, and so on.
 *
 * Names are kept, values are destroyed. Nothing here is reversible.
 *
 * @param {RawHeaders} headers
 * @returns {Record<string, string>}
 */
export function redactHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const flat = Array.isArray(value) ? value.join(', ') : value
    out[name.toLowerCase()] = isSecretHeader(name) ? '[redacted]' : flat
  }
  return out
}

/**
 * Build the header set for the upstream request.
 *
 * Everything the tool sent is passed through untouched — including the
 * credential, which is the entire job — minus the connection-level headers
 * that belong to the localhost hop, and with `host` rewritten to the real
 * upstream so TLS and virtual hosting work.
 *
 * @param {RawHeaders} incoming
 * @param {string} upstreamHost
 * @param {number} bodyLength byte length of the body we are about to send
 * @returns {Record<string, string | string[]>}
 */
export function buildForwardHeaders(incoming, upstreamHost, bodyLength) {
  /** @type {Record<string, string | string[]>} */
  const out = {}
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower)) continue
    if (lower === 'host' || lower === 'content-length') continue
    out[lower] = value
  }
  out.host = upstreamHost
  // We buffered the body to capture it, so the length is known exactly and
  // chunked encoding is neither needed nor correct any more.
  if (bodyLength > 0) out['content-length'] = String(bodyLength)
  return out
}

/**
 * Copy upstream response headers back to the tool, dropping only the
 * connection-level ones. Content-encoding and content-type survive, so the
 * bytes the tool receives are the bytes the provider sent.
 *
 * @param {RawHeaders} upstream
 * @returns {Record<string, string | string[]>}
 */
export function buildResponseHeaders(upstream) {
  /** @type {Record<string, string | string[]>} */
  const out = {}
  for (const [name, value] of Object.entries(upstream)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower)) continue
    out[lower] = value
  }
  return out
}

/**
 * Read a single header value regardless of how Node typed it.
 *
 * @param {RawHeaders} headers
 * @param {string} name
 * @returns {string}
 */
export function headerValue(headers, name) {
  const value = headers[name.toLowerCase()]
  if (value === undefined) return ''
  return Array.isArray(value) ? (value[0] ?? '') : value
}
