/**
 * Pricing: what a turn cost, and what it would have cost.
 *
 * Pure. The table is passed in — bundled snapshot, SQLite cache, or a user
 * override — and every number here is arithmetic over it.
 *
 * Prices are USD per million tokens throughout, which is how models.dev
 * publishes them. Converting once at the edge and forgetting the unit is how
 * cost figures end up out by a factor of a million.
 *
 * @module
 */

import { SNAPSHOT } from './snapshot.js'

export { SNAPSHOT } from './snapshot.js'

/**
 * @typedef {Object} ModelPrice
 * @property {number} input       USD per million input tokens
 * @property {number} output      USD per million output tokens
 * @property {number} [cacheRead]
 * @property {number} [cacheWrite]
 * @property {number} [context]   context window size
 * @property {number} [maxOutput]
 */

/**
 * @typedef {Object} PriceTable
 * @property {string} updatedAt   YYYY-MM-DD, shown in the UI
 * @property {string} source
 * @property {string} unit
 * @property {Record<string, Record<string, ModelPrice>>} providers
 */

/**
 * Anthropic charges cache writes at 1.25x input and cache reads at 0.1x.
 *
 * Used only when a model's entry does not state its own cache prices. Ignoring
 * cache pricing entirely makes a cache-heavy session look about ten times more
 * expensive than it was, which is the wrong answer in the most common case —
 * coding agents cache aggressively.
 */
export const CACHE_WRITE_MULTIPLIER = 1.25
export const CACHE_READ_MULTIPLIER = 0.1

const MILLION = 1_000_000

/** Providers to search, in order, when we do not know which one served a model. */
const SEARCH_ORDER = [
  'anthropic',
  'openai',
  'google',
  'google-vertex',
  'google-vertex-anthropic',
  'github-copilot',
  'xai',
  'deepseek',
  'mistral',
  'groq',
  'amazon-bedrock',
  'azure',
]

/**
 * Strip the decoration providers add to a model id.
 *
 * `models/gemini-2.5-pro` · `anthropic/claude-opus-5` · `us.anthropic.claude-v2`
 * all name a model we already have a price for.
 *
 * @param {string} model
 * @returns {string}
 */
export function normalizeModelId(model) {
  let id = (model || '').trim().toLowerCase()
  if (!id) return ''

  id = id.replace(/^models\//, '')
  // Bedrock regional prefixes: us. / eu. / apac.
  id = id.replace(/^(us|eu|apac|global)\./, '')
  // Vendor-prefixed ids, as OpenRouter and Bedrock write them.
  const slash = id.lastIndexOf('/')
  if (slash !== -1) id = id.slice(slash + 1)
  // Bedrock's "anthropic.claude-..." form.
  id = id.replace(/^(anthropic|meta|mistral|amazon|cohere|ai21|google)\./, '')
  // Bedrock version suffix.
  id = id.replace(/[:-]v\d+(:\d+)?$/, '')
  return id
}

/**
 * Drop a trailing date stamp: `claude-opus-5-20260101` → `claude-opus-5`.
 *
 * Providers serve a dated snapshot of a model and report that exact id in the
 * response. Without this every real turn misses the table and prices at zero.
 *
 * @param {string} model
 * @returns {string}
 */
export function stripDateSuffix(model) {
  return model
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-latest$/, '')
}

/**
 * @typedef {Object} PriceMatch
 * @property {ModelPrice} price
 * @property {string} modelId    the id we matched against
 * @property {string} provider
 * @property {'exact' | 'dated' | 'prefix'} how
 */

/**
 * Find a price for a model.
 *
 * Tried in order: exact id, id with the date stamp removed, then the longest
 * entry that is a prefix of the id. Each step is recorded in `how` so the UI
 * can say when a price is approximate rather than quietly implying precision.
 *
 * @param {string} model
 * @param {{ provider?: string, table?: PriceTable }} [options]
 * @returns {PriceMatch | null}
 */
export function findPrice(model, options = {}) {
  const table = options.table ?? SNAPSHOT
  const id = normalizeModelId(model)
  if (!id) return null

  const providers = options.provider
    ? [options.provider, ...SEARCH_ORDER.filter((name) => name !== options.provider)]
    : SEARCH_ORDER

  const known = providers.filter((name) => table.providers[name])

  for (const provider of known) {
    const price = table.providers[provider]?.[id]
    if (price) return { price, modelId: id, provider, how: 'exact' }
  }

  const undated = stripDateSuffix(id)
  if (undated !== id) {
    for (const provider of known) {
      const price = table.providers[provider]?.[undated]
      if (price) return { price, modelId: undated, provider, how: 'dated' }
    }
  }

  // Longest prefix wins, so "claude-opus-5-thinking" prefers "claude-opus-5"
  // over "claude".
  /** @type {PriceMatch | null} */
  let best = null
  for (const provider of known) {
    for (const [candidate, price] of Object.entries(table.providers[provider] ?? {})) {
      if (!id.startsWith(candidate)) continue
      if (best && best.modelId.length >= candidate.length) continue
      best = { price, modelId: candidate, provider, how: 'prefix' }
    }
  }
  return best
}

/**
 * @typedef {Object} CostBreakdown
 * @property {number} input
 * @property {number} output
 * @property {number} cacheRead
 * @property {number} cacheWrite
 * @property {number} total          what this turn is worth at API rates
 * @property {number} actual         what the user is actually billed
 * @property {number} equivalent     same as total; shown to everyone
 * @property {boolean} priced        did we find a price at all?
 * @property {string} [modelId]
 * @property {string} [how]
 */

/**
 * @typedef {Object} TurnUsage
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 * @property {number} [cacheReadTokens]
 * @property {number} [cacheWriteTokens]
 */

/**
 * Cost one turn.
 *
 * `billingMode` matters more than it looks. A Claude Max or ChatGPT Plus user
 * pays nothing extra for this turn; telling them it cost $3.20 is simply false.
 * They still want the equivalent API figure, because it is the only way to
 * compare sessions and rank waste — so both numbers are always returned and the
 * caller decides which to show.
 *
 * @param {TurnUsage} usage
 * @param {ModelPrice | PriceMatch | null} price
 * @param {{ billingMode?: 'api' | 'subscription' | 'unknown' }} [options]
 * @returns {CostBreakdown}
 */
export function computeCost(usage, price, options = {}) {
  const match = price && 'price' in price ? price : null
  const rates = match ? match.price : /** @type {ModelPrice | null} */ (price)

  if (!rates || typeof rates.input !== 'number') {
    return {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      actual: 0,
      equivalent: 0,
      priced: false,
    }
  }

  const cacheReadRate = rates.cacheRead ?? rates.input * CACHE_READ_MULTIPLIER
  const cacheWriteRate = rates.cacheWrite ?? rates.input * CACHE_WRITE_MULTIPLIER

  const input = ((usage.inputTokens ?? 0) * rates.input) / MILLION
  const output = ((usage.outputTokens ?? 0) * (rates.output ?? 0)) / MILLION
  const cacheRead = ((usage.cacheReadTokens ?? 0) * cacheReadRate) / MILLION
  const cacheWrite = ((usage.cacheWriteTokens ?? 0) * cacheWriteRate) / MILLION
  const total = input + output + cacheRead + cacheWrite

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    equivalent: total,
    actual: options.billingMode === 'subscription' ? 0 : total,
    priced: true,
    ...(match ? { modelId: match.modelId, how: match.how } : {}),
  }
}

/**
 * Price a turn in one call.
 *
 * @param {string} model
 * @param {TurnUsage} usage
 * @param {{ provider?: string, table?: PriceTable,
 *           billingMode?: 'api' | 'subscription' | 'unknown' }} [options]
 * @returns {CostBreakdown}
 */
export function priceTurn(model, usage, options = {}) {
  return computeCost(usage, findPrice(model, options), options)
}

/**
 * The context window for a model, for the "82% full" gauge.
 *
 * @param {string} model
 * @param {{ provider?: string, table?: PriceTable }} [options]
 * @returns {number | null}
 */
export function contextLimitFor(model, options = {}) {
  return findPrice(model, options)?.price.context ?? null
}

/**
 * Turn models.dev's published shape into ours.
 *
 * Shared by the snapshot generator and the runtime refresher, so a change in
 * their format is one edit rather than two that can disagree.
 *
 * @param {unknown} raw   parsed models.dev api.json
 * @param {string[]} [providers] which providers to keep
 * @returns {PriceTable}
 */
export function fromModelsDev(raw, providers) {
  /** @type {Record<string, Record<string, ModelPrice>>} */
  const out = {}
  const source = /** @type {Record<string, any>} */ (raw ?? {})
  const wanted = providers ?? Object.keys(source)

  for (const providerId of wanted) {
    const models = source[providerId]?.models
    if (!models || typeof models !== 'object') continue

    /** @type {Record<string, ModelPrice>} */
    const table = {}
    for (const [modelId, model] of Object.entries(models)) {
      const cost = /** @type {any} */ (model)?.cost
      if (!cost || typeof cost.input !== 'number') continue
      const limit = /** @type {any} */ (model)?.limit ?? {}
      table[modelId] = {
        input: cost.input,
        output: typeof cost.output === 'number' ? cost.output : 0,
        ...(typeof cost.cache_read === 'number' ? { cacheRead: cost.cache_read } : {}),
        ...(typeof cost.cache_write === 'number' ? { cacheWrite: cost.cache_write } : {}),
        ...(typeof limit.context === 'number' ? { context: limit.context } : {}),
        ...(typeof limit.output === 'number' ? { maxOutput: limit.output } : {}),
      }
    }
    if (Object.keys(table).length > 0) out[providerId] = table
  }

  return {
    updatedAt: new Date().toISOString().slice(0, 10),
    source: 'https://models.dev/api.json',
    unit: 'usd_per_million_tokens',
    providers: out,
  }
}

/**
 * Prefer the fresher of two tables, falling back to the bundled one.
 *
 * @param {PriceTable | null | undefined} cached
 * @returns {PriceTable}
 */
export function newerOf(cached) {
  if (!cached?.providers || Object.keys(cached.providers).length === 0) return SNAPSHOT
  return cached.updatedAt >= SNAPSHOT.updatedAt ? cached : SNAPSHOT
}
