/**
 * Google Gemini — the public API, Vertex, and Code Assist.
 *
 * {"systemInstruction": {"parts":[{"text":"..."}]},
 *  "contents": [{"role":"user","parts":[{"text":"hi"}]}]}
 *
 * Three of the seven traps live in this one format, which is why it gets the
 * most defensive parser of the four.
 *
 * @module
 */

import {
  asString,
  block,
  coerceToolInput,
  definitionChars,
  finalize,
  imageBlock,
  isRecord,
  mcpServerOf,
  message,
  systemSegment,
} from './shared.js'

/**
 * Trap 2. Gemini Code Assist — what the Gemini CLI uses when you sign in with
 * a Google account instead of an API key — wraps the entire request in
 * `body.request`. Parsing the outer object finds no contents, no system
 * instruction and no model, so every number reads zero and nothing errors.
 *
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
export function unwrapCodeAssist(body) {
  if (isRecord(body.request)) return /** @type {Record<string, unknown>} */ (body.request)
  return body
}

/**
 * Trap 5. Gemini puts the model in the URL, not the body:
 *   /v1beta/models/gemini-2.5-pro:generateContent
 * Without this every Gemini turn reads "unknown" and prices at $0.
 *
 * @param {string} path
 * @returns {string}
 */
export function modelFromPath(path) {
  return path.match(/\/models\/([^/:?]+)/)?.[1] ?? ''
}

/**
 * Trap 3. Gemini says `role: "model"` where everyone else says `"assistant"`.
 * Left alone, every assistant turn is counted as user text, and the
 * composition chart blames the user for the model's output.
 *
 * @param {string} role
 * @returns {string}
 */
export function normalizeRole(role) {
  if (role === 'model') return 'assistant'
  if (role === 'function') return 'tool'
  return role || 'user'
}

/**
 * @param {Record<string, unknown>} rawBody
 * @param {{ provider?: string, path?: string }} [context]
 * @returns {import('./shared.js').ParsedRequest}
 */
export function parseGeminiRequest(rawBody, context = {}) {
  const body = unwrapCodeAssist(rawBody)

  // The body may still carry a model name; the path is more reliable.
  const model =
    modelFromPath(context.path ?? '') ||
    asString(body.model) ||
    asString(rawBody.model) ||
    'unknown'

  return finalize({
    provider: context.provider ?? 'gemini',
    apiFormat: 'gemini',
    model: model.replace(/^models\//, ''),
    system: parseSystemInstruction(body.systemInstruction ?? body.system_instruction),
    tools: parseTools(body.tools),
    messages: parseContents(body.contents),
  })
}

/**
 * @param {unknown} instruction
 * @returns {import('./shared.js').SystemSegment[]}
 */
export function parseSystemInstruction(instruction) {
  if (typeof instruction === 'string') {
    return instruction ? [systemSegment(instruction)] : []
  }
  if (!isRecord(instruction)) return []

  const parts = Array.isArray(instruction.parts) ? instruction.parts : []
  /** @type {import('./shared.js').SystemSegment[]} */
  const segments = []
  for (const part of parts) {
    if (typeof part === 'string') {
      if (part) segments.push(systemSegment(part))
      continue
    }
    if (!isRecord(part)) continue
    const text = asString(part.text)
    if (text) segments.push(systemSegment(text))
  }
  return segments
}

/**
 * Gemini nests tools as `tools[].functionDeclarations[]`, so a single tools
 * entry can hold every tool the agent has.
 *
 * @param {unknown} tools
 * @returns {import('./shared.js').ToolDef[]}
 */
export function parseTools(tools) {
  if (!Array.isArray(tools)) return []
  /** @type {import('./shared.js').ToolDef[]} */
  const out = []

  for (const group of tools) {
    if (!isRecord(group)) continue
    const declarations = group.functionDeclarations ?? group.function_declarations
    if (!Array.isArray(declarations)) continue

    for (const declaration of declarations) {
      if (!isRecord(declaration)) continue
      const name = asString(declaration.name)
      if (!name) continue
      const server = mcpServerOf(name)
      out.push({
        name,
        description: asString(declaration.description),
        chars: definitionChars(declaration),
        ...(server ? { mcpServer: server } : {}),
      })
    }
  }
  return out
}

/**
 * @param {unknown} contents
 * @returns {import('./shared.js').Message[]}
 */
export function parseContents(contents) {
  if (!Array.isArray(contents)) return []
  /** @type {import('./shared.js').Message[]} */
  const out = []

  for (const item of contents) {
    if (!isRecord(item)) continue
    const role = normalizeRole(asString(item.role))
    out.push(message(role, parseParts(item.parts, role)))
  }
  return out
}

/**
 * @param {unknown} parts
 * @param {string} role
 * @returns {import('./shared.js').Block[]}
 */
function parseParts(parts, role) {
  if (!Array.isArray(parts)) return []

  /** @type {import('./shared.js').Block[]} */
  const blocks = []
  for (const part of parts) {
    if (typeof part === 'string') {
      blocks.push(block('text', part))
      continue
    }
    if (!isRecord(part)) continue

    // Trap 7: inline image data is base64 and must never be measured.
    if (isRecord(part.inlineData) || isRecord(part.inline_data)) {
      const data = isRecord(part.inlineData) ? part.inlineData : part.inline_data
      const mime = isRecord(data) ? asString(data.mimeType || data.mime_type) : ''
      blocks.push(imageBlock(mime || undefined))
      continue
    }
    if (isRecord(part.fileData) || isRecord(part.file_data)) {
      blocks.push(imageBlock())
      continue
    }

    const call = part.functionCall ?? part.function_call
    if (isRecord(call)) {
      const args = coerceToolInput(call.args ?? call.arguments)
      blocks.push({
        type: 'tool_use',
        name: asString(call.name),
        input: args,
        chars: definitionChars(args) + asString(call.name).length,
      })
      continue
    }

    const result = part.functionResponse ?? part.function_response
    if (isRecord(result)) {
      const payload = result.response ?? result.output
      const text = typeof payload === 'string' ? payload : definitionText(payload)
      blocks.push({
        type: 'tool_result',
        name: asString(result.name),
        content: text,
        chars: text.length,
      })
      continue
    }

    if (part.thought === true) {
      blocks.push(block('thinking', asString(part.text)))
      continue
    }

    const text = asString(part.text)
    if (text) blocks.push(block('text', text))
  }

  // A model turn with no parts still costs nothing; keep the message so turn
  // ordering survives.
  void role
  return blocks
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function definitionText(value) {
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}
