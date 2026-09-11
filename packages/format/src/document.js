/**
 * Building a document.
 *
 * Pure: it takes plain rows and returns a plain object. The database lives in
 * `store`, and this package stays publishable on its own — someone who wants to
 * write the format from their own tool should not have to take our SQLite
 * schema with it.
 *
 * @module
 */

import { CONTENT_LEVELS, FORMAT_NAME, FORMAT_VERSION, SEMCONV_VERSION } from './schema.js'

/**
 * The provider names OTel uses. `gen_ai.system` is an enum in the semantic
 * conventions, not free text, so ours are mapped rather than passed through.
 *
 * @type {Record<string, string>}
 */
const GEN_AI_SYSTEM = {
  anthropic: 'anthropic',
  openai: 'openai',
  chatgpt: 'openai',
  gemini: 'gcp.gemini',
  vertex: 'gcp.vertex_ai',
}

/**
 * @param {string} [provider]
 * @returns {string}
 */
export function genAiSystem(provider) {
  return GEN_AI_SYSTEM[String(provider ?? '').toLowerCase()] ?? provider ?? 'unknown'
}

/**
 * @typedef {Object} BuildOptions
 * @property {'none' | 'preview' | 'full'} [content]
 * @property {{ name: string, version?: string }} [producer]
 * @property {{ source?: string, updatedAt?: string }} [pricing]
 * @property {number} [now]
 */

/**
 * @param {any[]} sessions  already shaped by the caller, see `session()`
 * @param {BuildOptions} [options]
 * @returns {Record<string, unknown>}
 */
export function buildDocument(sessions, options = {}) {
  const content = CONTENT_LEVELS.includes(options.content ?? '')
    ? options.content
    : // Preview by default: a shared session is somebody's source code and
      // prompts, and the interesting numbers survive without the text.
      'preview'

  return {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    semconv: SEMCONV_VERSION,
    exportedAt: new Date(options.now ?? Date.now()).toISOString(),
    content,
    producer: prune({ ...(options.producer ?? { name: 'contextlab' }) }),
    ...(options.pricing ? { pricing: options.pricing } : {}),
    sessions,
  }
}

/**
 * Shape one session, with its turns.
 *
 * @param {any} input
 * @param {{ content?: string }} [options]
 * @returns {Record<string, unknown>}
 */
export function session(input, options = {}) {
  /** @type {Record<string, any>} */
  const out = {
    id: String(input.id),
    attributes: prune({
      'gen_ai.system': genAiSystem(input.provider),
      'gen_ai.request.model': input.model || undefined,
      'gen_ai.response.model': input.responseModel || input.model || undefined,
    }),
  }

  if (input.tool) out['contextlab.tool'] = input.tool
  if (input.apiFormat) out['contextlab.api_format'] = input.apiFormat
  if (input.transport) out['contextlab.transport'] = input.transport

  if (input.projectPath || input.projectName) {
    out['contextlab.project'] = prune({
      path: input.projectPath || undefined,
      name: input.projectName || undefined,
    })
  }

  if (input.startedAt) out.startedAt = iso(input.startedAt)
  if (input.lastSeenAt) out.endedAt = iso(input.lastSeenAt)

  out['contextlab.totals'] = prune({
    turns: int(input.turnCount),
    input_tokens: int(input.inputTokens),
    output_tokens: int(input.outputTokens),
    cache_read_tokens: int(input.cacheReadTokens),
    cache_write_tokens: int(input.cacheWriteTokens),
    peak_context_tokens: int(input.peakContextTokens),
    cost: prune({
      currency: 'USD',
      actual: num(input.costUsd),
      equivalent: num(input.equivalentCostUsd),
      billing_mode: input.billingMode || undefined,
    }),
  })

  if (input.findings?.length) {
    out['contextlab.findings'] = input.findings.map(finding)
  }

  out.turns = (input.turns ?? []).map((/** @type {any} */ item) =>
    turn(item, { content: options.content }),
  )

  return out
}

/**
 * @param {any} input
 * @param {{ content?: string }} [options]
 * @returns {Record<string, unknown>}
 */
export function turn(input, options = {}) {
  /** @type {Record<string, any>} */
  const out = {
    id: String(input.id),
    sequence: int(input.seq),
    startTime: iso(input.capturedAt),
    attributes: prune({
      'gen_ai.operation.name': 'chat',
      'gen_ai.system': genAiSystem(input.provider),
      'gen_ai.request.model': input.model || undefined,
      'gen_ai.response.model': input.model || undefined,
      'gen_ai.usage.input_tokens': int(input.inputTokens),
      'gen_ai.usage.output_tokens': int(input.outputTokens),
      'gen_ai.response.finish_reasons': input.stopReason ? [input.stopReason] : undefined,
    }),
  }

  if (input.completedMs) out.durationMs = int(input.completedMs)

  out['contextlab.context'] = prune({
    tokens: int(input.contextTokens),
    system_tokens: int(input.systemTokens),
    tools_tokens: int(input.toolsTokens),
    messages_tokens: int(input.messagesTokens),
    limit: int(input.contextLimit),
  })

  // Cache accounting is not in the OTel conventions, and leaving it out would
  // overstate a cached turn's cost roughly tenfold.
  const cacheRead = int(input.cacheReadTokens)
  const cacheWrite = int(input.cacheWriteTokens)
  if (cacheRead || cacheWrite) {
    out['contextlab.cache'] = prune({ read_tokens: cacheRead, write_tokens: cacheWrite })
  }

  out['contextlab.cost'] = prune({
    currency: 'USD',
    actual: num(input.costUsd),
    equivalent: num(input.equivalentCostUsd),
  })

  if (input.composition?.length) {
    out['contextlab.composition'] = input.composition.map((/** @type {any} */ row) =>
      prune({
        category: row.category,
        tokens: int(row.tokens),
        percent: num(row.percent),
      }),
    )
  }

  if (input.systemSegments?.length) {
    out['contextlab.system_segments'] = input.systemSegments.map(
      (/** @type {any} */ row) =>
        prune({ kind: row.kind, label: row.label, tokens: int(row.tokens) }),
    )
  }

  if (input.attribution?.length) {
    out['contextlab.attribution'] = input.attribution.map((/** @type {any} */ row) =>
      prune({
        entity_type: row.entityType,
        entity_name: row.entityName,
        tokens: int(row.tokens),
        definition_tokens: int(row.definitionTokens),
        call_tokens: int(row.callTokens),
        result_tokens: int(row.resultTokens),
        calls: int(row.calls),
        cost: num(row.costUsd),
      }),
    )
  }

  if (options.content !== 'none' && input.messages?.length) {
    out['contextlab.messages'] = input.messages.map((/** @type {any} */ message) =>
      prune({
        index: int(message.index),
        role: message.role,
        tokens: int(message.tokens),
        blocks: (message.blocks ?? []).map((/** @type {any} */ item) =>
          block(item, options.content),
        ),
      }),
    )
  }

  return out
}

/**
 * @param {any} input
 * @param {string} [content]
 * @returns {Record<string, unknown>}
 */
function block(input, content) {
  const text = content === 'full' ? input.text : input.preview
  return prune({
    type: input.blockType || input.type,
    category: input.category,
    role: input.role || undefined,
    tokens: int(input.tokens),
    chars: int(input.chars),
    tool_name: input.toolName || undefined,
    tool_use_id: input.toolUseId || undefined,
    file_path: input.filePath || undefined,
    mcp_server: input.mcpServer || undefined,
    turns_present: int(input.turnsPresent) || undefined,
    text: text || undefined,
  })
}

/**
 * @param {any} input
 * @returns {Record<string, unknown>}
 */
function finding(input) {
  return prune({
    rule: input.rule,
    severity: input.severity,
    title: input.title,
    detail: input.detail || undefined,
    fix: input.fix || undefined,
    wasted_tokens: int(input.wastedTokens),
    wasted_cost: num(input.wastedCostUsd),
    evidence:
      input.evidence && typeof input.evidence === 'object' ? input.evidence : undefined,
  })
}

/**
 * Drop keys with no value.
 *
 * A document full of nulls is larger, harder to read, and says "we know this is
 * zero" where the truth is "we do not know".
 *
 * @param {Record<string, unknown>} object
 * @returns {Record<string, unknown>}
 */
function prune(object) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'object' && !Array.isArray(value)) {
      const inner = /** @type {Record<string, unknown>} */ (value)
      if (Object.keys(inner).length === 0) continue
    }
    out[key] = value
  }
  return out
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function int(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

/**
 * @param {unknown} value  epoch ms or an ISO string
 * @returns {string}
 */
function iso(value) {
  if (typeof value === 'string') return value
  const at = Number(value)
  return new Date(Number.isFinite(at) && at > 0 ? at : Date.now()).toISOString()
}
