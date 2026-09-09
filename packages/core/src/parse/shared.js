/**
 * The normalized shape every parser produces, and the helpers that keep the
 * seven traps in notes/WIRE-FORMATS.md section 3 handled in one place.
 *
 * Pure. No I/O.
 *
 * @module
 */

/**
 * @typedef {Object} Block
 * @property {string} type       text | tool_use | tool_result | thinking | image
 * @property {string} [text]
 * @property {string} [id]       tool_use id
 * @property {string} [name]     tool name
 * @property {Record<string, unknown>} [input]  tool args, ALWAYS an object
 * @property {string} [toolUseId] tool_result → the tool_use it answers
 * @property {string} [content]  tool_result content, flattened to text
 * @property {number} chars      length of what a tokenizer would see
 * @property {number} [imageTokens] flat estimate; images are never tokenized
 * @property {string} [mediaType]
 */

/**
 * @typedef {Object} Message
 * @property {string} role       user | assistant | system | tool
 * @property {Block[]} blocks
 * @property {number} chars
 */

/**
 * @typedef {Object} SystemSegment
 * @property {string} kind       base | memory_file | mcp_server | skill | other
 * @property {string} label
 * @property {string} text
 * @property {number} chars
 */

/**
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} [description]
 * @property {number} chars      size of the whole definition, schema included
 * @property {string} [mcpServer]
 */

/**
 * @typedef {Object} ParsedRequest
 * @property {string} provider
 * @property {string} apiFormat
 * @property {string} model
 * @property {SystemSegment[]} system
 * @property {ToolDef[]} tools
 * @property {Message[]} messages
 * @property {number} systemChars
 * @property {number} toolsChars
 * @property {number} messagesChars
 * @property {number} imageCount
 * @property {number} imageTokens
 */

/**
 * Trap 7. An image is base64 in the JSON body; stringifying it inflates a
 * token count roughly a hundredfold, so one screenshot reads as 400,000
 * tokens. Images are never tokenized — they get this flat estimate instead.
 *
 * 1,600 is about one 512x512 tile. Real screenshots run 2,000-6,400, so this
 * under-counts slightly, which is the right direction to be wrong in.
 */
export const IMAGE_TOKEN_ESTIMATE = 1600

/**
 * Trap 4. OpenAI Responses sends tool arguments as a JSON *string*, while
 * every other format sends an object. Downstream code reads `input.file_path`,
 * so the string has to become an object here or file attribution silently
 * finds nothing.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function coerceToolInput(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return isRecord(parsed) ? parsed : { value: parsed }
    } catch {
      // Truncated or malformed arguments: keep the text rather than lose it.
      return { _raw: value }
    }
  }
  return isRecord(value) ? value : {}
}

/**
 * Trap 6. `tool_result.content` is a string in about half of all requests and
 * an array of content blocks in the other half. Missing the array form counts
 * those results as zero tokens — and tool results are the single biggest
 * source of waste, so this is the trap that costs the most.
 *
 * @param {unknown} content
 * @returns {{ text: string, images: number }}
 */
export function flattenContent(content) {
  if (content === null || content === undefined) return { text: '', images: 0 }
  if (typeof content === 'string') return { text: content, images: 0 }

  if (Array.isArray(content)) {
    const parts = []
    let images = 0
    for (const item of content) {
      if (typeof item === 'string') {
        parts.push(item)
        continue
      }
      if (!isRecord(item)) continue
      if (isImageBlock(item)) {
        images += 1
        continue
      }
      if (typeof item.text === 'string') parts.push(item.text)
      else if (typeof item.content === 'string') parts.push(item.content)
    }
    return { text: parts.join('\n'), images }
  }

  if (isRecord(content)) {
    if (typeof content.text === 'string') return { text: content.text, images: 0 }
    if (isImageBlock(content)) return { text: '', images: 1 }
  }

  return { text: '', images: 0 }
}

/**
 * Does this block carry image data? Covers every spelling the four formats use.
 *
 * @param {Record<string, unknown>} block
 * @returns {boolean}
 */
export function isImageBlock(block) {
  const type = typeof block.type === 'string' ? block.type : ''
  if (type === 'image' || type === 'image_url' || type === 'input_image') return true
  if (type === 'output_image') return true
  return 'inlineData' in block || 'inline_data' in block || 'fileData' in block
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function asString(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * Build a text block.
 *
 * @param {string} type
 * @param {string} text
 * @param {Partial<Block>} [extra]
 * @returns {Block}
 */
export function block(type, text, extra = {}) {
  return { type, text, chars: text.length, ...extra }
}

/**
 * Build an image block. Note there is no `text`: the base64 must never reach
 * anything that measures length.
 *
 * @param {string} [mediaType]
 * @returns {Block}
 */
export function imageBlock(mediaType) {
  return {
    type: 'image',
    chars: 0,
    imageTokens: IMAGE_TOKEN_ESTIMATE,
    ...(mediaType ? { mediaType } : {}),
  }
}

/**
 * Assemble a message and total its blocks.
 *
 * @param {string} role
 * @param {Block[]} blocks
 * @returns {Message}
 */
export function message(role, blocks) {
  return {
    role,
    blocks,
    chars: blocks.reduce((sum, item) => sum + item.chars, 0),
  }
}

/**
 * Measure a tool definition the way the provider bills it — the whole JSON
 * schema, not just the name.
 *
 * @param {unknown} definition
 * @returns {number}
 */
export function definitionChars(definition) {
  try {
    return JSON.stringify(definition ?? {}).length
  } catch {
    return 0
  }
}

/**
 * MCP tools are named `mcp__<server>__<tool>` by every client that speaks MCP.
 * The server name is what a user can actually switch off, so it gets pulled
 * out here and carried through attribution.
 *
 * @param {string} name
 * @returns {string | undefined}
 */
export function mcpServerOf(name) {
  const match = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__/)
  return match?.[1]
}

/**
 * Finish a ParsedRequest: roll up the totals the rest of the pipeline reads.
 *
 * @param {Omit<ParsedRequest, 'systemChars' | 'toolsChars' | 'messagesChars' |
 *         'imageCount' | 'imageTokens'>} parsed
 * @returns {ParsedRequest}
 */
export function finalize(parsed) {
  let imageCount = 0
  let imageTokens = 0
  for (const item of parsed.messages) {
    for (const part of item.blocks) {
      if (part.type !== 'image') continue
      imageCount += 1
      imageTokens += part.imageTokens ?? IMAGE_TOKEN_ESTIMATE
    }
  }

  return {
    ...parsed,
    systemChars: parsed.system.reduce((sum, segment) => sum + segment.chars, 0),
    toolsChars: parsed.tools.reduce((sum, tool) => sum + tool.chars, 0),
    messagesChars: parsed.messages.reduce((sum, item) => sum + item.chars, 0),
    imageCount,
    imageTokens,
  }
}

/**
 * One system segment from raw text. Labelling it as CLAUDE.md, an MCP server
 * or a skill happens later, in the composition step.
 *
 * @param {string} text
 * @param {string} [kind]
 * @param {string} [label]
 * @returns {SystemSegment}
 */
export function systemSegment(text, kind = 'base', label = 'system prompt') {
  return { kind, label, text, chars: text.length }
}
