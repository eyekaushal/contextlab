/**
 * Anthropic Messages API.
 *
 * {"system": "...", "messages": [{"role":"user","content":[...]}]}
 *
 * @module
 */

import {
  asString,
  block,
  coerceToolInput,
  definitionChars,
  finalize,
  flattenContent,
  imageBlock,
  isImageBlock,
  isRecord,
  mcpServerOf,
  message,
  systemSegment,
} from './shared.js'

/**
 * @param {Record<string, unknown>} body
 * @param {{ provider?: string }} [context]
 * @returns {import('./shared.js').ParsedRequest}
 */
export function parseAnthropicRequest(body, context = {}) {
  return finalize({
    provider: context.provider ?? 'anthropic',
    apiFormat: 'anthropic-messages',
    model: asString(body.model) || 'unknown',
    system: parseSystem(body.system),
    tools: parseTools(body.tools),
    messages: parseMessages(body.messages),
  })
}

/**
 * Trap 1. `system` is a plain string on some requests and an array of content
 * blocks on others — Claude Code sends the array form so it can attach
 * `cache_control` to individual pieces. Handling only the string form counts
 * the entire system prompt as zero.
 *
 * @param {unknown} system
 * @returns {import('./shared.js').SystemSegment[]}
 */
export function parseSystem(system) {
  if (typeof system === 'string') {
    return system ? [systemSegment(system)] : []
  }

  if (Array.isArray(system)) {
    /** @type {import('./shared.js').SystemSegment[]} */
    const segments = []
    for (const item of system) {
      if (typeof item === 'string') {
        if (item) segments.push(systemSegment(item))
        continue
      }
      if (!isRecord(item)) continue
      const text = asString(item.text)
      if (text) segments.push(systemSegment(text))
    }
    return segments
  }

  return []
}

/**
 * @param {unknown} tools
 * @returns {import('./shared.js').ToolDef[]}
 */
export function parseTools(tools) {
  if (!Array.isArray(tools)) return []
  /** @type {import('./shared.js').ToolDef[]} */
  const out = []
  for (const tool of tools) {
    if (!isRecord(tool)) continue
    const name = asString(tool.name)
    if (!name) continue
    const server = mcpServerOf(name)
    out.push({
      name,
      description: asString(tool.description),
      chars: definitionChars(tool),
      ...(server ? { mcpServer: server } : {}),
    })
  }
  return out
}

/**
 * @param {unknown} messages
 * @returns {import('./shared.js').Message[]}
 */
export function parseMessages(messages) {
  if (!Array.isArray(messages)) return []
  /** @type {import('./shared.js').Message[]} */
  const out = []

  for (const item of messages) {
    if (!isRecord(item)) continue
    const role = asString(item.role) || 'user'
    out.push(message(role, parseContent(item.content)))
  }
  return out
}

/**
 * @param {unknown} content
 * @returns {import('./shared.js').Block[]}
 */
function parseContent(content) {
  if (typeof content === 'string') return content ? [block('text', content)] : []
  if (!Array.isArray(content)) return []

  /** @type {import('./shared.js').Block[]} */
  const blocks = []
  for (const item of content) {
    if (typeof item === 'string') {
      blocks.push(block('text', item))
      continue
    }
    if (!isRecord(item)) continue

    if (isImageBlock(item)) {
      const source = isRecord(item.source) ? item.source : {}
      blocks.push(imageBlock(asString(source.media_type) || undefined))
      continue
    }

    const type = asString(item.type)

    if (type === 'tool_use') {
      const input = coerceToolInput(item.input)
      blocks.push({
        type: 'tool_use',
        id: asString(item.id),
        name: asString(item.name),
        input,
        // Billed on the serialised arguments, so that is what we measure.
        chars: definitionChars(input) + asString(item.name).length,
      })
      continue
    }

    if (type === 'tool_result') {
      // Trap 6: content here is a string or an array of blocks.
      const flattened = flattenContent(item.content)
      blocks.push({
        type: 'tool_result',
        toolUseId: asString(item.tool_use_id),
        content: flattened.text,
        chars: flattened.text.length,
      })
      for (let i = 0; i < flattened.images; i += 1) blocks.push(imageBlock())
      continue
    }

    if (type === 'thinking' || type === 'redacted_thinking') {
      blocks.push(block('thinking', asString(item.thinking) || asString(item.text)))
      continue
    }

    blocks.push(block('text', asString(item.text)))
  }

  return blocks
}
