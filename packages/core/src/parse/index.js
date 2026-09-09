/**
 * Request/response parsers, one per wire format.
 *
 * Four formats go in, one shape comes out. Everything downstream — composition,
 * attribution, the rules engine, the dashboard — only ever sees ParsedRequest,
 * so adding a fifth provider is one new file here and no change anywhere else.
 *
 * Read notes/WIRE-FORMATS.md sections 1-3 before touching any of this. The
 * seven traps are handled in `shared.js` and in the format files that hit them;
 * each one produces a silently wrong number rather than an error.
 *
 * @module
 */

import { parseAnthropicRequest } from './anthropic.js'
import { parseGeminiRequest } from './gemini.js'
import { parseChatRequest } from './openai-chat.js'
import { parseResponsesRequest } from './openai-responses.js'
import { isRecord } from './shared.js'
import { emptyUsage, readUsage } from './usage.js'

export { parseAnthropicRequest } from './anthropic.js'
export {
  modelFromPath,
  normalizeRole,
  parseGeminiRequest,
  unwrapCodeAssist,
} from './gemini.js'
export { parseChatRequest } from './openai-chat.js'
export { parseInput, parseResponsesRequest } from './openai-responses.js'
export * from './shared.js'
export { emptyUsage, parseSseUsage, parseUsage, readUsage } from './usage.js'

/**
 * @typedef {Object} ParseContext
 * @property {string} apiFormat
 * @property {string} [provider]
 * @property {string} [path]
 */

/**
 * Parse a request body in whichever format it arrived in.
 *
 * @param {unknown} body
 * @param {ParseContext} context
 * @returns {import('./shared.js').ParsedRequest | null}
 */
export function parseRequest(body, context) {
  if (!isRecord(body)) return null

  switch (context.apiFormat) {
    case 'anthropic-messages':
      return parseAnthropicRequest(body, context)
    case 'chat-completions':
      return parseChatRequest(body, context)
    case 'responses':
    case 'chatgpt-backend':
      return parseResponsesRequest(body, {
        ...context,
        apiFormat: context.apiFormat,
      })
    case 'gemini':
      return parseGeminiRequest(body, context)
    default:
      return sniff(body, context)
  }
}

/**
 * When routing could not name the format — a `Bearer sk-` request to an
 * unfamiliar path — the body still gives it away.
 *
 * @param {Record<string, unknown>} body
 * @param {ParseContext} context
 * @returns {import('./shared.js').ParsedRequest | null}
 */
function sniff(body, context) {
  if ('contents' in body || 'systemInstruction' in body || isRecord(body.request)) {
    return parseGeminiRequest(body, context)
  }
  if ('input' in body || 'instructions' in body) {
    // Name what we found rather than passing 'unknown' straight through.
    return parseResponsesRequest(body, { ...context, apiFormat: 'responses' })
  }
  if ('system' in body && 'messages' in body) {
    return parseAnthropicRequest(body, context)
  }
  if ('messages' in body) {
    return parseChatRequest(body, context)
  }
  return null
}

/**
 * @typedef {Object} ParsedCapture
 * @property {import('./shared.js').ParsedRequest | null} request
 * @property {import('./usage.js').Usage} usage
 * @property {string} model    the response's model wins; it is authoritative
 * @property {string} tool
 * @property {string} provider
 * @property {string} apiFormat
 * @property {string | null} sessionTag
 * @property {number} capturedAt
 */

/**
 * Parse one capture file, request and response together.
 *
 * The response is read second and on purpose: it carries the provider's real
 * model name and real token counts, which override anything the request
 * claimed.
 *
 * @param {Record<string, unknown>} capture
 * @returns {ParsedCapture}
 */
export function parseCapture(capture) {
  const request = isRecord(capture.request) ? capture.request : {}
  const response = isRecord(capture.response) ? capture.response : {}
  const apiFormat = typeof capture.apiFormat === 'string' ? capture.apiFormat : 'unknown'

  const parsed = parseRequest(request.body, {
    apiFormat,
    provider: typeof capture.provider === 'string' ? capture.provider : undefined,
    path: typeof request.path === 'string' ? request.path : undefined,
  })

  const usage = response.body === undefined ? emptyUsage() : readUsage(response.body)

  return {
    request: parsed,
    usage,
    model: usage.model || parsed?.model || 'unknown',
    tool: typeof capture.tool === 'string' ? capture.tool : '',
    provider: typeof capture.provider === 'string' ? capture.provider : 'unknown',
    apiFormat,
    sessionTag: typeof capture.sessionTag === 'string' ? capture.sessionTag : null,
    capturedAt: Date.parse(String(capture.capturedAt)) || 0,
  }
}
