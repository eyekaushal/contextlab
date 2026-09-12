/**
 * Composition: what is actually in the context window, by category.
 *
 * Two steps, deliberately separate:
 *
 *   1. `composeRequest` counts tokens with a local encoder. Fast, available
 *      while the request is still in flight, and approximate.
 *   2. `rescaleToActual` replaces those estimates with the provider's real
 *      total once the response lands, scaling every part proportionally.
 *
 * Step 2 is what makes the numbers trustworthy. Step 1 is what makes the live
 * gauge possible. See WIRE-FORMATS.md sections 6 and 7.
 *
 * Pure.
 *
 * @module
 */

import { countJsonTokens, countTokens, estimateFromChars } from '../tokenize.js'
import { CATEGORIES, emptyTally } from './categories.js'
import { classifyBlock } from './classify.js'

export { CATEGORIES, CONTROLLABLE, emptyTally } from './categories.js'
export { classifyBlock, classifyMessage } from './classify.js'

/**
 * @typedef {Object} ComposedBlock
 * @property {string} category
 * @property {number} tokens           this block's share of what was billed
 * @property {number} tokensEstimated  what we counted in this block's own text
 * @property {string} type
 * @property {string} [text]
 * @property {string} [id]        tool_use id
 * @property {string} [name]
 * @property {string} [toolUseId] tool_result -> the tool_use it answers
 * @property {number} [imageTokens]
 * @property {Record<string, unknown>} [input]
 * @property {string} [content]
 * @property {number} chars
 */

/**
 * @typedef {Object} ComposedMessage
 * @property {string} role
 * @property {number} tokens
 * @property {ComposedBlock[]} blocks
 */

/**
 * @typedef {Object} Composition
 * @property {string} model
 * @property {number} totalTokens
 * @property {number} systemTokens
 * @property {number} toolsTokens
 * @property {number} messagesTokens
 * @property {ComposedMessage[]} messages
 * @property {{ kind: string, label: string, tokens: number, text: string }[]} system
 * @property {{ name: string, tokens: number, mcpServer?: string }[]} tools
 * @property {Record<string, number>} categories
 * @property {{ category: string, tokens: number, percent: number }[]} breakdown
 * @property {boolean} exact  true once rescaled against the provider's count
 */

/**
 * Count everything in a parsed request.
 *
 * @param {import('../parse/shared.js').ParsedRequest} parsed
 * @param {{ model?: string }} [options]
 * @returns {Composition}
 */
export function composeRequest(parsed, options = {}) {
  const model = options.model || parsed.model

  const system = parsed.system.map((segment) => ({
    kind: segment.kind,
    label: segment.label,
    text: segment.text,
    tokens: countTokens(segment.text, model),
  }))

  const tools = parsed.tools.map((tool) => ({
    name: tool.name,
    tokens: estimateFromChars(tool.chars),
    ...(tool.mcpServer ? { mcpServer: tool.mcpServer } : {}),
  }))

  const messages = parsed.messages.map((message) => {
    const blocks = message.blocks.map((block) => composeBlock(block, message.role, model))
    return {
      role: message.role,
      blocks,
      tokens: blocks.reduce((sum, block) => sum + block.tokens, 0),
    }
  })

  const systemTokens = sum(system.map((segment) => segment.tokens))
  const toolsTokens = sum(tools.map((tool) => tool.tokens))
  const messagesTokens = sum(messages.map((message) => message.tokens))

  return withBreakdown({
    model,
    system,
    tools,
    messages,
    systemTokens,
    toolsTokens,
    messagesTokens,
    totalTokens: systemTokens + toolsTokens + messagesTokens,
    categories: emptyTally(),
    breakdown: [],
    exact: false,
  })
}

/**
 * @param {import('../parse/shared.js').Block} block
 * @param {string} role
 * @param {string} model
 * @returns {ComposedBlock}
 */
function composeBlock(block, role, model) {
  const category = classifyBlock(block, role)
  const counted = tokensForBlock(block, model)

  return {
    ...block,
    category,
    tokens: counted,
    // Kept through rescaling. `tokens` becomes this block's share of the
    // provider's total, which is right for a chart about the bill and wrong to
    // show beside the block's own text — a 19-character message does not
    // contain 69 tokens.
    tokensEstimated: counted,
  }
}

/**
 * @param {import('../parse/shared.js').Block} block
 * @param {string} model
 * @returns {number}
 */
function tokensForBlock(block, model) {
  // Never measure image data. `parse/` already stripped the base64 and left a
  // flat estimate; running an encoder over it is the trap this avoids.
  if (block.type === 'image') return block.imageTokens ?? 0

  if (block.type === 'tool_use') {
    return countTokens(block.name ?? '', model) + countJsonTokens(block.input, model)
  }

  if (block.type === 'tool_result') return countTokens(block.content ?? '', model)

  return countTokens(block.text ?? '', model)
}

/**
 * Replace estimates with the provider's real input count.
 *
 * The response is authoritative. Scaling proportionally keeps the shape of the
 * breakdown — which is what the user reads — while making the total exactly
 * right, which is what they are billed for.
 *
 * Two invariants must hold exactly afterwards, or the dashboard contradicts
 * itself:
 *
 *   totalTokens    === systemTokens + toolsTokens + messagesTokens
 *   messagesTokens === sum(message.tokens)
 *
 * Rounding always leaves a residual; it goes into the largest bucket, where it
 * is proportionally least visible.
 *
 * @param {Composition} composition
 * @param {number} actualInputTokens usage.input + cache_read + cache_write
 * @returns {Composition}
 */
export function rescaleToActual(composition, actualInputTokens) {
  const actual = Math.max(0, Math.round(actualInputTokens))
  if (!actual || composition.totalTokens <= 0) return composition

  const [systemTokens, toolsTokens, messagesTokens] = distribute(
    [composition.systemTokens, composition.toolsTokens, composition.messagesTokens],
    actual,
  )

  const messageTotals = distribute(
    composition.messages.map((message) => message.tokens),
    messagesTokens ?? 0,
  )

  const messages = composition.messages.map((message, index) => {
    const target = messageTotals[index] ?? 0
    const blockTotals = distribute(
      message.blocks.map((block) => block.tokens),
      target,
    )
    return {
      ...message,
      tokens: target,
      blocks: message.blocks.map((block, blockIndex) => ({
        ...block,
        tokens: blockTotals[blockIndex] ?? 0,
      })),
    }
  })

  const systemTotals = distribute(
    composition.system.map((segment) => segment.tokens),
    systemTokens ?? 0,
  )
  const toolTotals = distribute(
    composition.tools.map((tool) => tool.tokens),
    toolsTokens ?? 0,
  )

  return withBreakdown({
    ...composition,
    system: composition.system.map((segment, index) => ({
      ...segment,
      tokens: systemTotals[index] ?? 0,
    })),
    tools: composition.tools.map((tool, index) => ({
      ...tool,
      tokens: toolTotals[index] ?? 0,
    })),
    messages,
    systemTokens: systemTokens ?? 0,
    toolsTokens: toolsTokens ?? 0,
    messagesTokens: messagesTokens ?? 0,
    totalTokens: actual,
    exact: true,
  })
}

/**
 * Scale a list of parts so they sum to exactly `target`.
 *
 * The naive version — round each part independently — drifts by a few tokens
 * and breaks the invariants. This rounds down, then hands the remainder out to
 * the largest parts one token at a time, so the sum is exact and the biggest
 * numbers absorb the correction.
 *
 * @param {number[]} parts
 * @param {number} target
 * @returns {number[]}
 */
export function distribute(parts, target) {
  const total = sum(parts)
  if (parts.length === 0) return []
  if (total <= 0) {
    // Nothing to scale by: give it all to the first slot rather than inventing
    // a distribution we cannot justify.
    const out = parts.map(() => 0)
    if (target > 0) out[0] = target
    return out
  }

  const scaled = parts.map((part) => (part * target) / total)
  const floored = scaled.map((value) => Math.floor(value))
  let residual = target - sum(floored)

  // Hand out the remainder largest-first, so a one-token correction never
  // lands on a block that should have been zero.
  const order = scaled
    .map((value, index) => ({ index, fraction: value - Math.floor(value), value }))
    .sort((a, b) => b.fraction - a.fraction || b.value - a.value)

  let cursor = 0
  while (residual > 0 && order.length > 0) {
    const slot = order[cursor % order.length]
    if (slot) floored[slot.index] = (floored[slot.index] ?? 0) + 1
    residual -= 1
    cursor += 1
  }

  return floored
}

/**
 * Roll the per-block categories up into the eleven-way breakdown.
 *
 * Computed from the final numbers rather than tracked alongside them, so the
 * categories always sum to the total by construction — there is no path where
 * the chart and the headline disagree.
 *
 * @param {Composition} composition
 * @returns {Composition}
 */
function withBreakdown(composition) {
  const categories = emptyTally()

  for (const segment of composition.system) {
    categories.system_prompt = (categories.system_prompt ?? 0) + segment.tokens
  }
  for (const tool of composition.tools) {
    categories.tool_definitions = (categories.tool_definitions ?? 0) + tool.tokens
  }
  for (const message of composition.messages) {
    for (const block of message.blocks) {
      const key = CATEGORIES.includes(/** @type {never} */ (block.category))
        ? block.category
        : 'other'
      categories[key] = (categories[key] ?? 0) + block.tokens
    }
  }

  const total = composition.totalTokens
  const breakdown = CATEGORIES.map((category) => ({
    category,
    tokens: categories[category] ?? 0,
    percent: total > 0 ? ((categories[category] ?? 0) / total) * 100 : 0,
  }))

  return { ...composition, categories, breakdown }
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function sum(values) {
  return values.reduce((total, value) => total + value, 0)
}
