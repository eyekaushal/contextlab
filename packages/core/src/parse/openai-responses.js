/**
 * OpenAI Responses API — and ChatGPT's backend, which is wire-compatible.
 *
 * {"instructions": "...", "input": [{"type":"input_text","text":"hi"}]}
 *
 * The input list is flat: items are not grouped into messages, and several
 * item types carry no role at all.
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
 * @param {{ provider?: string, apiFormat?: string }} [context]
 * @returns {import('./shared.js').ParsedRequest}
 */
export function parseResponsesRequest(body, context = {}) {
  /** @type {import('./shared.js').SystemSegment[]} */
  const system = []
  const instructions = asString(body.instructions)
  if (instructions) system.push(systemSegment(instructions))

  return finalize({
    provider: context.provider ?? 'openai',
    apiFormat: context.apiFormat ?? 'responses',
    model: asString(body.model) || 'unknown',
    system,
    tools: parseTools(body.tools),
    messages: parseInput(body.input),
  })
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
    // Responses puts the name at the top level; older shapes nest it.
    const fn = isRecord(tool.function) ? tool.function : tool
    const name = asString(fn.name) || asString(tool.type)
    if (!name) continue
    const server = mcpServerOf(name)
    out.push({
      name,
      description: asString(fn.description),
      chars: definitionChars(tool),
      ...(server ? { mcpServer: server } : {}),
    })
  }
  return out
}

/**
 * @param {unknown} input
 * @returns {import('./shared.js').Message[]}
 */
export function parseInput(input) {
  if (typeof input === 'string') {
    return input ? [message('user', [block('text', input)])] : []
  }
  if (!Array.isArray(input)) return []

  /** @type {import('./shared.js').Message[]} */
  const out = []

  for (const item of input) {
    if (typeof item === 'string') {
      out.push(message('user', [block('text', item)]))
      continue
    }
    if (!isRecord(item)) continue

    const type = asString(item.type)
    const role = asString(item.role)

    // Items with no role are the ones that carry the expensive content.
    if (!role) {
      if (type === 'function_call' || type === 'custom_tool_call') {
        const input_ = coerceToolInput(item.arguments)
        out.push(
          message('assistant', [
            {
              type: 'tool_use',
              id: asString(item.call_id) || asString(item.id),
              name: asString(item.name),
              input: input_,
              chars: definitionChars(input_) + asString(item.name).length,
            },
          ]),
        )
        continue
      }

      if (type === 'function_call_output' || type === 'custom_tool_call_output') {
        const flattened = flattenContent(item.output ?? item.content)
        out.push(
          message('tool', [
            {
              type: 'tool_result',
              toolUseId: asString(item.call_id),
              content: flattened.text,
              chars: flattened.text.length,
            },
          ]),
        )
        continue
      }

      if (type === 'reasoning') {
        const summary = flattenContent(item.summary ?? item.content)
        out.push(message('assistant', [block('thinking', summary.text)]))
        continue
      }

      if (type === 'input_text' || type === 'output_text') {
        const role_ = type === 'output_text' ? 'assistant' : 'user'
        out.push(message(role_, [block('text', asString(item.text))]))
        continue
      }

      if (isImageBlock(item)) {
        out.push(message('user', [imageBlock()]))
        continue
      }
    }

    out.push(message(role || 'user', parseContent(item.content)))
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
    const type = asString(part.type)
    const text = asString(part.text)
    if (type === 'refusal') {
      blocks.push(block('text', asString(part.refusal)))
      continue
    }
    if (text) blocks.push(block('text', text))
  }
  return blocks
}
