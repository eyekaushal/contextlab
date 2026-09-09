/**
 * OpenAI Chat Completions.
 *
 * {"messages": [{"role":"system","content":"..."},{"role":"user","content":"hi"}]}
 *
 * The system prompt is not a separate field here — it is the first message
 * with `role: "system"` (or `"developer"` on newer models), so it has to be
 * lifted out of the message list or it gets counted as conversation.
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
export function parseChatRequest(body, context = {}) {
  /** @type {import('./shared.js').SystemSegment[]} */
  const system = []
  /** @type {import('./shared.js').Message[]} */
  const messages = []

  const list = Array.isArray(body.messages) ? body.messages : []
  for (const item of list) {
    if (!isRecord(item)) continue
    const role = asString(item.role) || 'user'

    if (role === 'system' || role === 'developer') {
      const { text } = flattenContent(item.content)
      if (text) system.push(systemSegment(text))
      continue
    }

    messages.push(message(role, parseContent(item, role)))
  }

  return finalize({
    provider: context.provider ?? 'openai',
    apiFormat: 'chat-completions',
    model: asString(body.model) || 'unknown',
    system,
    tools: parseTools(body.tools, body.functions),
    messages,
  })
}

/**
 * @param {unknown} tools
 * @param {unknown} [legacyFunctions] pre-2023 `functions` array
 * @returns {import('./shared.js').ToolDef[]}
 */
export function parseTools(tools, legacyFunctions) {
  /** @type {import('./shared.js').ToolDef[]} */
  const out = []

  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (!isRecord(tool)) continue
      const fn = isRecord(tool.function) ? tool.function : tool
      const name = asString(fn.name)
      if (!name) continue
      const server = mcpServerOf(name)
      out.push({
        name,
        description: asString(fn.description),
        chars: definitionChars(tool),
        ...(server ? { mcpServer: server } : {}),
      })
    }
  }

  if (Array.isArray(legacyFunctions)) {
    for (const fn of legacyFunctions) {
      if (!isRecord(fn)) continue
      const name = asString(fn.name)
      if (!name) continue
      out.push({
        name,
        description: asString(fn.description),
        chars: definitionChars(fn),
      })
    }
  }

  return out
}

/**
 * @param {Record<string, unknown>} item
 * @param {string} role
 * @returns {import('./shared.js').Block[]}
 */
function parseContent(item, role) {
  /** @type {import('./shared.js').Block[]} */
  const blocks = []

  // A tool reply carries the id of the call it answers on the message itself.
  if (role === 'tool' || role === 'function') {
    const flattened = flattenContent(item.content)
    blocks.push({
      type: 'tool_result',
      toolUseId: asString(item.tool_call_id),
      content: flattened.text,
      chars: flattened.text.length,
    })
    return blocks
  }

  const content = item.content
  if (typeof content === 'string') {
    if (content) blocks.push(block('text', content))
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        blocks.push(block('text', part))
        continue
      }
      if (!isRecord(part)) continue
      if (isImageBlock(part)) {
        blocks.push(imageBlock())
        continue
      }
      const text = asString(part.text)
      if (text) blocks.push(block('text', text))
    }
  }

  // An assistant message can carry both prose and tool calls at once.
  const calls = Array.isArray(item.tool_calls) ? item.tool_calls : []
  for (const call of calls) {
    if (!isRecord(call)) continue
    const fn = isRecord(call.function) ? call.function : {}
    // Trap 4 again: arguments arrive as a JSON string here too.
    const input = coerceToolInput(fn.arguments)
    blocks.push({
      type: 'tool_use',
      id: asString(call.id),
      name: asString(fn.name),
      input,
      chars: definitionChars(input) + asString(fn.name).length,
    })
  }

  return blocks
}
