/**
 * Turn an incoming request into a routing decision.
 *
 * Pure functions. No I/O, no network. Everything here is derived from the URL
 * and the request headers. See notes/WIRE-FORMATS.md section 4 — the detection
 * order in `detectProvider` is load-bearing.
 *
 * @module
 */

import {
  API_SEGMENTS,
  BARE_PROVIDER_SEGMENTS,
  IGNORED_PATH_MARKERS,
  UPSTREAM_ENV,
  UPSTREAMS,
} from './constants.js'
import { headerValue } from './headers.js'

/** @typedef {import('./headers.js').RawHeaders} RawHeaders */

/**
 * @typedef {Object} UrlTag
 * @property {string | null} tool       tool name from the URL prefix, if any
 * @property {string | null} sessionTag 8 hex chars identifying one CLI run
 * @property {string} path              path to send upstream, prefix removed
 * @property {string} search            query string, including "?", or ""
 */

/**
 * @typedef {Object} Detection
 * @property {string} provider  anthropic | openai | gemini | chatgpt | vertex | unknown
 * @property {string} apiFormat anthropic-messages | chat-completions | responses |
 *                              gemini | chatgpt-backend | unknown
 */

/**
 * @typedef {Object} Route
 * @property {string | null} tool
 * @property {string | null} sessionTag
 * @property {string} provider
 * @property {string} apiFormat
 * @property {string} upstreamPath  path + query as sent upstream
 * @property {string | null} upstreamBase  origin, or null if unroutable
 * @property {boolean} capture      write a capture file for this one?
 */

const SESSION_TAG = /^[a-f0-9]{8}$/
const UNSAFE_SEGMENT = /[/\\]|\.\./

/**
 * Split the tool and session prefix off the front of the path.
 *
 * The CLI points a tool at `http://localhost:4040/<tool>/<sessionTag>` and the
 * tool appends its own API path, so we get `/claude/a1b2c3d4/v1/messages` and
 * must forward `/v1/messages`.
 *
 * @param {string} rawUrl the request URL exactly as Node received it
 * @returns {UrlTag}
 */
export function parseUrlTag(rawUrl) {
  const queryAt = rawUrl.indexOf('?')
  const pathname = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt)
  const search = queryAt === -1 ? '' : rawUrl.slice(queryAt)

  const segments = pathname.split('/').filter(Boolean)
  let tool = null
  let sessionTag = null
  let index = 0

  const first = decodeSegment(segments[index])
  if (first !== null && !isApiSegment(first)) {
    // A bare provider name routes but does not identify a tool — the real tool
    // is worked out later from headers and system-prompt text.
    tool = BARE_PROVIDER_SEGMENTS.has(first.toLowerCase()) ? null : first
    index += 1

    const second = decodeSegment(segments[index])
    if (second !== null && SESSION_TAG.test(second)) {
      sessionTag = second
      index += 1
    }
  }

  const rest = segments.slice(index)
  return { tool, sessionTag, path: `/${rest.join('/')}`, search }
}

/**
 * Decode one path segment, refusing anything that could climb out of the path.
 *
 * @param {string | undefined} segment
 * @returns {string | null} null when absent or unsafe
 */
function decodeSegment(segment) {
  if (segment === undefined) return null
  let decoded
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return null
  }
  return UNSAFE_SEGMENT.test(decoded) ? null : decoded
}

/**
 * @param {string} segment
 * @returns {boolean}
 */
function isApiSegment(segment) {
  // Gemini Code Assist uses "v1internal:loadCodeAssist" — one segment carrying
  // both the API version and the method.
  const base = (segment.split(':')[0] ?? '').toLowerCase()
  return API_SEGMENTS.has(base)
}

/**
 * Identify the provider and wire format. Path first, headers second.
 *
 * **Order matters.** Vertex must be tested before Gemini, and Gemini before the
 * OpenAI catch-all, or requests land on the wrong parser and every number that
 * follows is wrong. WIRE-FORMATS.md section 4.
 *
 * @param {string} path path with the tool prefix already removed
 * @param {RawHeaders} headers
 * @returns {Detection}
 */
export function detectProvider(path, headers) {
  if (/^\/(api|backend-api|codex)\//.test(path)) {
    // Wire-compatible with the Responses API, but kept as its own tag because
    // ChatGPT's backend adds fields the public API does not have.
    return { provider: 'chatgpt', apiFormat: 'chatgpt-backend' }
  }

  if (path.includes('/v1/messages') || headerValue(headers, 'anthropic-version')) {
    return { provider: 'anthropic', apiFormat: 'anthropic-messages' }
  }

  if (/\/v1[^/]*\/projects\/.+\/locations\/.+\/publishers\/google\/models\//.test(path)) {
    return { provider: 'vertex', apiFormat: 'gemini' }
  }

  if (
    path.includes(':generateContent') ||
    path.includes(':streamGenerateContent') ||
    /\/v1(beta|alpha)\/models\//.test(path) ||
    path.includes('/v1internal') ||
    headerValue(headers, 'x-goog-api-key')
  ) {
    return { provider: 'gemini', apiFormat: 'gemini' }
  }

  if (path.includes('/responses')) {
    return { provider: 'openai', apiFormat: 'responses' }
  }

  if (path.includes('/chat/completions')) {
    return { provider: 'openai', apiFormat: 'chat-completions' }
  }

  if (headerValue(headers, 'authorization').startsWith('Bearer sk-')) {
    // Known provider, unknown shape — the body parser sorts it out.
    return { provider: 'openai', apiFormat: 'unknown' }
  }

  return { provider: 'unknown', apiFormat: 'unknown' }
}

/**
 * Work out which origin to forward to.
 *
 * @param {string} provider
 * @param {string} path
 * @param {Record<string, string | undefined>} env
 * @returns {string | null} origin, or null if we cannot tell
 */
export function resolveUpstream(provider, path, env) {
  if (provider === 'vertex') {
    const override = env[UPSTREAM_ENV.vertex]
    if (override) return stripTrailingSlash(override)
    // Vertex is regional and the region is only in the path.
    const region = path.match(/\/locations\/([^/]+)\//)
    return region?.[1]
      ? `https://${region[1]}-aiplatform.googleapis.com`
      : UPSTREAMS.vertex
  }

  // Gemini Code Assist — what the Gemini CLI uses when signed in with a Google
  // account rather than an API key — is a different host on the same format.
  const key =
    provider === 'gemini' && path.includes('/v1internal')
      ? 'geminiCodeAssist'
      : /** @type {keyof typeof UPSTREAMS} */ (provider)

  const envName = UPSTREAM_ENV[/** @type {keyof typeof UPSTREAM_ENV} */ (key)]
  const override = envName ? env[envName] : undefined
  if (override) return stripTrailingSlash(override)

  return UPSTREAMS[/** @type {keyof typeof UPSTREAMS} */ (key)] ?? null
}

/**
 * @param {string} url
 * @returns {string}
 */
function stripTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/**
 * Is this request a conversation turn worth capturing?
 *
 * Utility calls are still forwarded — we just do not record them, because a
 * token-counting call is not a turn and would show up as a phantom session.
 *
 * @param {string} method
 * @param {string} path
 * @param {string} apiFormat
 * @returns {boolean}
 */
export function shouldCapture(method, path, apiFormat) {
  if (method !== 'POST') return false
  if (apiFormat === 'unknown') return false
  return !IGNORED_PATH_MARKERS.some((marker) => path.includes(marker))
}

/**
 * The whole routing decision for one request.
 *
 * @param {string} rawUrl
 * @param {string} method
 * @param {RawHeaders} headers
 * @param {Record<string, string | undefined>} env
 * @returns {Route}
 */
export function routeRequest(rawUrl, method, headers, env) {
  const { tool, sessionTag, path, search } = parseUrlTag(rawUrl)
  const { provider, apiFormat } = detectProvider(path, headers)
  return {
    tool,
    sessionTag,
    provider,
    apiFormat,
    upstreamPath: path + search,
    upstreamBase: provider === 'unknown' ? null : resolveUpstream(provider, path, env),
    capture: shouldCapture(method, path, apiFormat),
  }
}
