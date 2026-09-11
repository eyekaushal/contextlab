/**
 * Breadth tests for the three non-Anthropic parsers.
 *
 * `parse.test.js` covers the seven traps from WIRE-FORMATS §3 — the cases that
 * produce a silently wrong number. This covers the rest of each format: the item
 * types, role shapes and content forms a real session actually contains.
 *
 * These are undocumented, unstable wire formats. A field quietly renamed
 * upstream shows up here as a failing assertion rather than as a dashboard that
 * is confidently wrong.
 */

import { describe, expect, it } from 'vitest'
import { parseRequest } from '../src/parse/index.js'

/**
 * @param {unknown} body
 * @param {string} apiFormat
 * @param {Record<string, unknown>} [context]
 * @returns {any}
 */
const parse = (body, apiFormat, context = {}) =>
  parseRequest(body, { apiFormat, ...context })

/**
 * @param {any} parsed
 * @returns {any[]}
 */
const blocks = (parsed) => parsed.messages.flatMap((/** @type {any} */ m) => m.blocks)

// ---------------------------------------------------------------------------
// OpenAI Responses
// ---------------------------------------------------------------------------

describe('openai responses', () => {
  it('lifts instructions out as the system prompt', () => {
    const parsed = parse(
      { model: 'gpt-5', instructions: 'You are Codex.', input: [] },
      'responses',
    )
    expect(parsed.system.map((/** @type {any} */ s) => s.text)).toEqual([
      'You are Codex.',
    ])
    expect(parsed.messages).toEqual([])
  })

  it('accepts input as a bare string', () => {
    const parsed = parse({ input: 'fix the build' }, 'responses')
    expect(parsed.messages[0].role).toBe('user')
    expect(parsed.messages[0].blocks[0].text).toBe('fix the build')
  })

  it('reads each roleless item type', () => {
    const parsed = parse(
      {
        input: [
          { type: 'input_text', text: 'what broke' },
          { type: 'output_text', text: 'the linker' },
          { type: 'reasoning', summary: [{ text: 'considering the linker flags' }] },
          {
            type: 'function_call',
            call_id: 'c1',
            name: 'Read',
            arguments: '{"file_path":"/a.js"}',
          },
          { type: 'function_call_output', call_id: 'c1', output: 'contents of a.js' },
        ],
      },
      'responses',
    )

    // Items with no role are the ones that carry the expensive content, and
    // each maps to a different role and block type.
    expect(parsed.messages.map((/** @type {any} */ m) => m.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'assistant',
      'tool',
    ])
    expect(parsed.messages[2].blocks[0].type).toBe('thinking')
    expect(parsed.messages[3].blocks[0].input).toEqual({ file_path: '/a.js' })
    expect(parsed.messages[4].blocks[0].content).toBe('contents of a.js')
  })

  it('reads the custom tool spellings too', () => {
    const parsed = parse(
      {
        input: [
          {
            type: 'custom_tool_call',
            call_id: 'c9',
            name: 'Shell',
            arguments: '{"cmd":"ls"}',
          },
          { type: 'custom_tool_call_output', call_id: 'c9', output: 'a.js b.js' },
        ],
      },
      'responses',
    )
    expect(blocks(parsed).map((b) => b.type)).toEqual(['tool_use', 'tool_result'])
    expect(blocks(parsed)[0].input).toEqual({ cmd: 'ls' })
  })

  it('handles a message item with an array of content parts', () => {
    const parsed = parse(
      {
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'look at this' },
              { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
            ],
          },
        ],
      },
      'responses',
    )
    const types = parsed.messages[0].blocks.map((/** @type {any} */ b) => b.type)
    expect(types).toEqual(['text', 'image'])
    // Image data never reaches a length count.
    expect(parsed.messagesChars).toBe('look at this'.length)
  })

  it('keeps a refusal as text rather than dropping the turn', () => {
    const parsed = parse(
      {
        input: [
          {
            role: 'assistant',
            content: [{ type: 'refusal', refusal: 'I cannot do that' }],
          },
        ],
      },
      'responses',
    )
    expect(blocks(parsed)[0].text).toBe('I cannot do that')
  })

  it('counts a top-level image item', () => {
    const parsed = parse(
      { input: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] },
      'responses',
    )
    expect(parsed.imageCount).toBe(1)
  })

  it('reads tools in both the flat and nested spellings', () => {
    const parsed = parse(
      {
        tools: [
          { type: 'function', name: 'Read', description: 'read a file' },
          { function: { name: 'Write', description: 'write a file' } },
          { type: 'web_search' },
        ],
        input: [],
      },
      'responses',
    )
    expect(parsed.tools.map((/** @type {any} */ t) => t.name)).toEqual([
      'Read',
      'Write',
      'web_search',
    ])
  })

  it('survives nonsense in the input list', () => {
    const parsed = parse({ input: [null, 42, 'a string', {}] }, 'responses')
    expect(parsed.messages.length).toBeGreaterThan(0)
    expect(() => parse({ input: null }, 'responses')).not.toThrow()
  })

  it('keeps the chatgpt backend tag while parsing the same shape', () => {
    const parsed = parse(
      { instructions: 'You are Codex.', input: [{ type: 'input_text', text: 'hi' }] },
      'chatgpt-backend',
    )
    expect(parsed.apiFormat).toBe('chatgpt-backend')
    expect(parsed.systemChars).toBe('You are Codex.'.length)
  })
})

// ---------------------------------------------------------------------------
// OpenAI Chat Completions
// ---------------------------------------------------------------------------

describe('openai chat completions', () => {
  it('lifts system and developer messages out of the conversation', () => {
    const parsed = parse(
      {
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'developer', content: 'Follow the house style' },
          { role: 'user', content: 'hi' },
        ],
      },
      'chat-completions',
    )
    // Counting these as conversation would blame the user for the preamble.
    expect(parsed.system).toHaveLength(2)
    expect(parsed.messages).toHaveLength(1)
  })

  it('reads a tool reply and the call it answers', () => {
    const parsed = parse(
      {
        messages: [
          {
            role: 'assistant',
            content: 'Reading it now.',
            tool_calls: [
              {
                id: 'c1',
                function: { name: 'Read', arguments: '{"file_path":"/a.js"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'c1', content: 'contents' },
        ],
      },
      'chat-completions',
    )

    // One assistant message holding prose and a call at once.
    const assistant = parsed.messages[0].blocks
    expect(assistant.map((/** @type {any} */ b) => b.type)).toEqual(['text', 'tool_use'])
    expect(assistant[1].input).toEqual({ file_path: '/a.js' })

    const tool = parsed.messages[1].blocks[0]
    expect(tool.type).toBe('tool_result')
    expect(tool.toolUseId).toBe('c1')
  })

  it('reads the pre-2023 function role as a result too', () => {
    const parsed = parse(
      { messages: [{ role: 'function', name: 'lookup', content: 'answer' }] },
      'chat-completions',
    )
    expect(blocks(parsed)[0].type).toBe('tool_result')
  })

  it('handles array content with text and images', () => {
    const parsed = parse(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is this' },
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,' + 'A'.repeat(50_000) },
              },
            ],
          },
        ],
      },
      'chat-completions',
    )
    expect(parsed.imageCount).toBe(1)
    // 50,000 characters of base64 must not be measured.
    expect(parsed.messagesChars).toBe('what is this'.length)
  })

  it('reads both the tools array and the legacy functions array', () => {
    const parsed = parse(
      {
        tools: [{ type: 'function', function: { name: 'Read', description: 'read' } }],
        functions: [{ name: 'legacy_lookup', description: 'older style' }],
        messages: [],
      },
      'chat-completions',
    )
    expect(parsed.tools.map((/** @type {any} */ t) => t.name)).toEqual([
      'Read',
      'legacy_lookup',
    ])
  })

  it('names the MCP server on a namespaced tool', () => {
    const parsed = parse(
      {
        tools: [{ type: 'function', function: { name: 'mcp__postgres__query' } }],
        messages: [],
      },
      'chat-completions',
    )
    expect(parsed.tools[0].mcpServer).toBe('postgres')
  })

  it('survives messages that are not objects', () => {
    const parsed = parse({ messages: [null, 7, { role: 'user' }] }, 'chat-completions')
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0].blocks).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

describe('gemini', () => {
  it('reads a function response, object or string', () => {
    const parsed = parse(
      {
        contents: [
          {
            role: 'function',
            parts: [
              { functionResponse: { name: 'read_file', response: { content: 'abc' } } },
              { function_response: { name: 'ls', response: 'a.js b.js' } },
            ],
          },
        ],
      },
      'gemini',
    )
    const results = blocks(parsed)
    expect(results[0].type).toBe('tool_result')
    expect(results[0].content).toContain('abc')
    expect(results[1].content).toBe('a.js b.js')
    // Gemini's "function" role is everyone else's "tool".
    expect(parsed.messages[0].role).toBe('tool')
  })

  it('reads a function call in both spellings', () => {
    const parsed = parse(
      {
        contents: [
          {
            role: 'model',
            parts: [
              { functionCall: { name: 'read_file', args: { path: '/a.js' } } },
              { function_call: { name: 'write_file', arguments: '{"path":"/b.js"}' } },
            ],
          },
        ],
      },
      'gemini',
    )
    const calls = blocks(parsed)
    expect(calls[0].input).toEqual({ path: '/a.js' })
    // Arguments as a JSON string, same trap as the Responses API.
    expect(calls[1].input).toEqual({ path: '/b.js' })
  })

  it('separates a thought part from ordinary model text', () => {
    const parsed = parse(
      {
        contents: [
          {
            role: 'model',
            parts: [
              { text: 'Let me think about the flags', thought: true },
              { text: 'The linker flag is wrong.' },
            ],
          },
        ],
      },
      'gemini',
    )
    expect(blocks(parsed).map((b) => b.type)).toEqual(['thinking', 'text'])
  })

  it('handles fileData as an image without measuring it', () => {
    const parsed = parse(
      {
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { mimeType: 'image/png', fileUri: 'gs://bucket/x.png' } },
            ],
          },
        ],
      },
      'gemini',
    )
    expect(parsed.imageCount).toBe(1)
    expect(parsed.messagesChars).toBe(0)
  })

  it('reads a string system instruction as well as a parts object', () => {
    expect(
      parse({ systemInstruction: 'Be brief', contents: [] }, 'gemini').systemChars,
    ).toBe(8)
    expect(
      parse({ system_instruction: { parts: ['Be brief'] }, contents: [] }, 'gemini')
        .systemChars,
    ).toBe(8)
  })

  it('reads tools in the snake_case spelling too', () => {
    const parsed = parse(
      {
        tools: [{ function_declarations: [{ name: 'read_file', description: 'read' }] }],
        contents: [],
      },
      'gemini',
    )
    expect(parsed.tools[0].name).toBe('read_file')
  })

  it('prefers the model in the path over one in the body', () => {
    const parsed = parse({ model: 'models/gemini-1.0-stale', contents: [] }, 'gemini', {
      path: '/v1beta/models/gemini-2.5-pro:generateContent',
    })
    expect(parsed.model).toBe('gemini-2.5-pro')
  })

  it('strips the models/ prefix when falling back to the body', () => {
    expect(
      parse({ model: 'models/gemini-2.5-flash', contents: [] }, 'gemini').model,
    ).toBe('gemini-2.5-flash')
  })

  it('survives parts and contents that are not what they should be', () => {
    expect(() => parse({ contents: [null, { parts: null }] }, 'gemini')).not.toThrow()
    expect(
      parse({ contents: [{ role: 'user', parts: ['bare string'] }] }, 'gemini')
        .messagesChars,
    ).toBe('bare string'.length)
  })

  it('unwraps code assist and still reads the model from the path', () => {
    const parsed = parse(
      {
        project: 'p',
        request: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] },
      },
      'gemini',
      { path: '/v1internal:generateContent' },
    )
    expect(parsed.messages).toHaveLength(1)
    // No model in that path, and saying so beats inventing one.
    expect(parsed.model).toBe('unknown')
  })
})
