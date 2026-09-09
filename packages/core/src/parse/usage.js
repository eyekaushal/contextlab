/**
 * Reading the provider's real token counts out of a response.
 *
 * This is the half of the capture that makes the numbers true rather than
 * estimated: the request tells you what was sent, the response tells you what
 * you were actually billed for. Field names differ in every format, and one of
 * them double-counts. See notes/WIRE-FORMATS.md section 6.
 *
 * @module
 */

import { asString, isRecord } from './shared.js'

/**
 * @typedef {Object} Usage
 * @property {number} inputTokens       fresh input, cache excluded
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheWriteTokens
 * @property {number} thinkingTokens
 * @property {number} totalInputTokens  input + cache read + cache write
 * @property {string} [model]
 * @property {string} [stopReason]
 * @property {boolean} found            did the response carry usage at all?
 */

/** @returns {Usage} */
export function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    thinkingTokens: 0,
    totalInputTokens: 0,
    found: false,
  }
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Pull usage out of one JSON response body, whatever shape it is.
 *
 * @param {unknown} body
 * @returns {Usage}
 */
export function parseUsage(body) {
  const usage = emptyUsage()
  if (!isRecord(body)) return usage

  // Responses wraps everything one level deeper.
  const root = isRecord(body.response) ? body.response : body
  const model = asString(root.model)
  if (model) usage.model = model

  const gemini = isRecord(root.usageMetadata) ? root.usageMetadata : null
  if (gemini) {
    const cached = num(gemini.cachedContentTokenCount)
    // The one that bites: promptTokenCount ALREADY includes cached tokens.
    // Adding them again double-charges every cached turn.
    usage.inputTokens = Math.max(0, num(gemini.promptTokenCount) - cached)
    usage.cacheReadTokens = cached
    usage.outputTokens = num(gemini.candidatesTokenCount)
    usage.thinkingTokens = num(gemini.thoughtsTokenCount)
    usage.found = true
  }

  const raw = isRecord(root.usage) ? root.usage : null
  if (raw) {
    usage.inputTokens = num(raw.input_tokens) || num(raw.prompt_tokens)
    usage.outputTokens = num(raw.output_tokens) || num(raw.completion_tokens)

    const promptDetails = isRecord(raw.prompt_tokens_details)
      ? raw.prompt_tokens_details
      : {}
    const inputDetails = isRecord(raw.input_tokens_details)
      ? raw.input_tokens_details
      : {}
    usage.cacheReadTokens =
      num(raw.cache_read_input_tokens) ||
      num(promptDetails.cached_tokens) ||
      num(inputDetails.cached_tokens)
    usage.cacheWriteTokens = num(raw.cache_creation_input_tokens)

    const completionDetails = isRecord(raw.completion_tokens_details)
      ? raw.completion_tokens_details
      : {}
    const outputDetails = isRecord(raw.output_tokens_details)
      ? raw.output_tokens_details
      : {}
    usage.thinkingTokens =
      num(completionDetails.reasoning_tokens) || num(outputDetails.reasoning_tokens)

    usage.found = true
  }

  const stop =
    asString(root.stop_reason) || asString(root.finish_reason) || asString(root.status)
  if (stop) usage.stopReason = stop

  usage.totalInputTokens =
    usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  return usage
}

/**
 * Accumulate usage across a server-sent event stream.
 *
 * Usage does not arrive in one place: Anthropic reports input on
 * `message_start` and output on `message_delta`, OpenAI attaches it to the
 * final chunk, Responses to `response.completed`, Gemini to every chunk.
 * Taking only the last event loses half the numbers.
 *
 * @param {string} text raw SSE body
 * @returns {Usage}
 */
export function parseSseUsage(text) {
  const usage = emptyUsage()
  if (typeof text !== 'string' || text === '') return usage

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue

    const payload = trimmed.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue

    /** @type {unknown} */
    let event
    try {
      event = JSON.parse(payload)
    } catch {
      continue
    }
    if (!isRecord(event)) continue

    const type = asString(event.type)

    if (type === 'message_start' && isRecord(event.message)) {
      const started = parseUsage(event.message)
      usage.inputTokens = started.inputTokens
      usage.cacheReadTokens = started.cacheReadTokens
      usage.cacheWriteTokens = started.cacheWriteTokens
      if (started.model) usage.model = started.model
      // message_start carries a placeholder output count; the delta corrects it.
      usage.found = true
      continue
    }

    if (type === 'message_delta') {
      const delta = parseUsage(event)
      if (delta.outputTokens) usage.outputTokens = delta.outputTokens
      const stop = isRecord(event.delta) ? asString(event.delta.stop_reason) : ''
      if (stop) usage.stopReason = stop
      usage.found = true
      continue
    }

    // Responses: response.completed carries the final tally.
    if (
      isRecord(event.response) ||
      isRecord(event.usage) ||
      isRecord(event.usageMetadata)
    ) {
      const chunk = parseUsage(event)
      if (!chunk.found) continue
      if (chunk.inputTokens) usage.inputTokens = chunk.inputTokens
      if (chunk.outputTokens) usage.outputTokens = chunk.outputTokens
      if (chunk.cacheReadTokens) usage.cacheReadTokens = chunk.cacheReadTokens
      if (chunk.cacheWriteTokens) usage.cacheWriteTokens = chunk.cacheWriteTokens
      if (chunk.thinkingTokens) usage.thinkingTokens = chunk.thinkingTokens
      if (chunk.model) usage.model = chunk.model
      if (chunk.stopReason) usage.stopReason = chunk.stopReason
      usage.found = true
    }
  }

  usage.totalInputTokens =
    usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  return usage
}

/**
 * Read usage from a response body of either kind.
 *
 * @param {unknown} body   parsed JSON, or the raw SSE string
 * @returns {Usage}
 */
export function readUsage(body) {
  if (typeof body === 'string') return parseSseUsage(body)
  return parseUsage(body)
}
