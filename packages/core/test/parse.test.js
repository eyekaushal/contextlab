import { describe, expect, it } from 'vitest'
import {
  IMAGE_TOKEN_ESTIMATE,
  modelFromPath,
  normalizeRole,
  parseCapture,
  parseRequest,
  parseSseUsage,
  parseUsage,
  unwrapCodeAssist,
} from '../src/parse/index.js'

/** The same conversation in all four formats — WIRE-FORMATS section 1. */
const SAME_CONVERSATION = {
  'anthropic-messages': {
    model: 'claude-opus-5',
    system: 'You are helpful',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  },
  'chat-completions': {
    model: 'gpt-5',
    messages: [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hi' },
    ],
  },
  responses: {
    model: 'gpt-5',
    instructions: 'You are helpful',
    input: [{ type: 'input_text', text: 'hi' }],
  },
  gemini: {
    systemInstruction: { parts: [{ text: 'You are helpful' }] },
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
  },
}

describe('one shape out of four formats', () => {
  for (const [apiFormat, body] of Object.entries(SAME_CONVERSATION)) {
    it(`normalizes ${apiFormat}`, () => {
      const parsed = parseRequest(body, {
        apiFormat,
        path: '/v1beta/models/gemini-2.5-pro:generateContent',
      })
      expect(parsed?.system.map((s) => s.text)).toEqual(['You are helpful'])
      expect(parsed?.messages).toHaveLength(1)
      expect(parsed?.messages[0]?.role).toBe('user')
      expect(parsed?.messages[0]?.blocks[0]?.text).toBe('hi')
      expect(parsed?.systemChars).toBe('You are helpful'.length)
    })
  }

  it('identifies the format from the body when routing could not', () => {
    expect(
      parseRequest(SAME_CONVERSATION.gemini, { apiFormat: 'unknown' })?.apiFormat,
    ).toBe('gemini')
    expect(
      parseRequest(SAME_CONVERSATION.responses, { apiFormat: 'unknown' })?.apiFormat,
    ).toBe('responses')
    expect(parseRequest('not an object', { apiFormat: 'unknown' })).toBeNull()
  })
})

describe('trap 1 — anthropic system is a string OR an array of blocks', () => {
  it('handles the string form', () => {
    const parsed = parseRequest(
      { system: 'You are Claude Code', messages: [] },
      { apiFormat: 'anthropic-messages' },
    )
    expect(parsed?.systemChars).toBe(19)
  })

  it('handles the array form Claude Code actually sends', () => {
    const parsed = parseRequest(
      {
        system: [
          {
            type: 'text',
            text: 'You are Claude Code',
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: 'Contents of CLAUDE.md' },
        ],
        messages: [],
      },
      { apiFormat: 'anthropic-messages' },
    )
    // The failure this guards against is silent: 0, not a crash.
    expect(parsed?.system).toHaveLength(2)
    expect(parsed?.systemChars).toBe(19 + 21)
  })
})

describe('trap 2 — gemini code assist wraps the body in body.request', () => {
  it('unwraps before parsing', () => {
    const wrapped = {
      project: 'my-project',
      request: {
        systemInstruction: { parts: [{ text: 'You are the Gemini CLI' }] },
        contents: [{ role: 'user', parts: [{ text: 'fix the bug' }] }],
      },
    }
    expect(unwrapCodeAssist(wrapped)).toHaveProperty('contents')

    const parsed = parseRequest(wrapped, { apiFormat: 'gemini' })
    expect(parsed?.systemChars).toBeGreaterThan(0)
    expect(parsed?.messages).toHaveLength(1)
  })
})

describe('trap 3 — gemini says "model" where everyone else says "assistant"', () => {
  it('renames the role', () => {
    expect(normalizeRole('model')).toBe('assistant')
    const parsed = parseRequest(
      {
        contents: [
          { role: 'user', parts: [{ text: 'hi' }] },
          { role: 'model', parts: [{ text: 'hello there' }] },
        ],
      },
      { apiFormat: 'gemini' },
    )
    expect(parsed?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })
})

describe('trap 4 — responses sends tool arguments as a JSON string', () => {
  it('parses them to an object so file attribution can read them', () => {
    const parsed = parseRequest(
      {
        input: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'Read',
            arguments: '{"file_path":"/repo/src/app.js"}',
          },
        ],
      },
      { apiFormat: 'responses' },
    )
    const call = parsed?.messages[0]?.blocks[0]
    expect(call?.input).toEqual({ file_path: '/repo/src/app.js' })
    expect(call?.input?.file_path).toBe('/repo/src/app.js')
  })

  it('does the same for chat completions tool_calls', () => {
    const parsed = parseRequest(
      {
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'c1', function: { name: 'Read', arguments: '{"file_path":"a.js"}' } },
            ],
          },
        ],
      },
      { apiFormat: 'chat-completions' },
    )
    expect(parsed?.messages[0]?.blocks[0]?.input).toEqual({ file_path: 'a.js' })
  })

  it('keeps malformed arguments rather than losing them', () => {
    const parsed = parseRequest(
      { input: [{ type: 'function_call', name: 'Read', arguments: '{"file_path":' }] },
      { apiFormat: 'responses' },
    )
    expect(parsed?.messages[0]?.blocks[0]?.input?._raw).toBe('{"file_path":')
  })
})

describe('trap 5 — gemini puts the model in the URL, not the body', () => {
  it('reads it out of the path', () => {
    expect(modelFromPath('/v1beta/models/gemini-2.5-pro:generateContent')).toBe(
      'gemini-2.5-pro',
    )
    expect(
      modelFromPath(
        '/v1/projects/p/locations/us-east4/publishers/google/models/gemini-2.5-flash:generateContent',
      ),
    ).toBe('gemini-2.5-flash')

    const parsed = parseRequest(
      { contents: [] },
      {
        apiFormat: 'gemini',
        path: '/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse',
      },
    )
    // Without this the model reads "unknown" and every Gemini turn prices at $0.
    expect(parsed?.model).toBe('gemini-2.5-pro')
  })

  it('says so honestly when the path carries no model', () => {
    expect(parseRequest({ contents: [] }, { apiFormat: 'gemini' })?.model).toBe('unknown')
  })
})

describe('trap 6 — tool_result.content is a string OR an array of blocks', () => {
  it('counts the string form', () => {
    const parsed = parseRequest(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 't1', content: 'npm ERR! failed' },
            ],
          },
        ],
      },
      { apiFormat: 'anthropic-messages' },
    )
    expect(parsed?.messages[0]?.blocks[0]?.chars).toBe(15)
  })

  it('counts the array form, which is half of all real traffic', () => {
    const parsed = parseRequest(
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 't1',
                content: [
                  { type: 'text', text: 'line one' },
                  { type: 'text', text: 'line two' },
                ],
              },
            ],
          },
        ],
      },
      { apiFormat: 'anthropic-messages' },
    )
    expect(parsed?.messages[0]?.blocks[0]?.chars).toBe('line one\nline two'.length)
  })
})

describe('trap 7 — images are base64 and must never be tokenized', () => {
  const base64 = 'A'.repeat(400_000)

  it('gives an anthropic image a flat estimate, not its byte length', () => {
    const parsed = parseRequest(
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: base64 },
              },
            ],
          },
        ],
      },
      { apiFormat: 'anthropic-messages' },
    )
    expect(parsed?.messagesChars).toBe(0)
    expect(parsed?.imageCount).toBe(1)
    expect(parsed?.imageTokens).toBe(IMAGE_TOKEN_ESTIMATE)
  })

  it('does the same for gemini inlineData', () => {
    const parsed = parseRequest(
      {
        contents: [
          {
            role: 'user',
            parts: [{ inlineData: { mimeType: 'image/png', data: base64 } }],
          },
        ],
      },
      { apiFormat: 'gemini' },
    )
    expect(parsed?.messagesChars).toBe(0)
    expect(parsed?.imageTokens).toBe(IMAGE_TOKEN_ESTIMATE)
  })

  it('does the same for an image inside a tool result', () => {
    const parsed = parseRequest(
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                content: [
                  { type: 'text', text: 'screenshot:' },
                  { type: 'image', source: { data: base64 } },
                ],
              },
            ],
          },
        ],
      },
      { apiFormat: 'anthropic-messages' },
    )
    expect(parsed?.messagesChars).toBe('screenshot:'.length)
    expect(parsed?.imageCount).toBe(1)
  })
})

describe('tool definitions', () => {
  it('measures the whole schema and names the MCP server', () => {
    const parsed = parseRequest(
      {
        tools: [
          { name: 'Read', description: 'Read a file', input_schema: { type: 'object' } },
          {
            name: 'mcp__playwright__browser_click',
            description: 'Click',
            input_schema: {},
          },
        ],
        messages: [],
      },
      { apiFormat: 'anthropic-messages' },
    )
    expect(parsed?.tools).toHaveLength(2)
    expect(parsed?.tools[1]?.mcpServer).toBe('playwright')
    expect(parsed?.toolsChars).toBeGreaterThan(50)
  })

  it('unnests gemini functionDeclarations', () => {
    const parsed = parseRequest(
      {
        tools: [
          { functionDeclarations: [{ name: 'read_file' }, { name: 'write_file' }] },
        ],
        contents: [],
      },
      { apiFormat: 'gemini' },
    )
    expect(parsed?.tools.map((t) => t.name)).toEqual(['read_file', 'write_file'])
  })
})

describe('usage from responses', () => {
  it('reads anthropic fields', () => {
    const usage = parseUsage({
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 300,
      },
    })
    expect(usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5000,
      cacheWriteTokens: 300,
      totalInputTokens: 5400,
      stopReason: 'end_turn',
    })
  })

  it('reads openai fields including reasoning tokens', () => {
    const usage = parseUsage({
      usage: {
        prompt_tokens: 900,
        completion_tokens: 40,
        prompt_tokens_details: { cached_tokens: 800 },
        completion_tokens_details: { reasoning_tokens: 30 },
      },
    })
    expect(usage.inputTokens).toBe(900)
    expect(usage.cacheReadTokens).toBe(800)
    expect(usage.thinkingTokens).toBe(30)
  })

  it('does not double-count gemini cached tokens', () => {
    // promptTokenCount ALREADY includes cachedContentTokenCount.
    const usage = parseUsage({
      usageMetadata: {
        promptTokenCount: 10_000,
        cachedContentTokenCount: 8000,
        candidatesTokenCount: 50,
        thoughtsTokenCount: 120,
      },
    })
    expect(usage.inputTokens).toBe(2000)
    expect(usage.cacheReadTokens).toBe(8000)
    expect(usage.totalInputTokens).toBe(10_000)
    expect(usage.thinkingTokens).toBe(120)
  })

  it('reports honestly when there is no usage at all', () => {
    expect(parseUsage({ content: [] }).found).toBe(false)
  })
})

describe('usage from a streamed response', () => {
  it('combines anthropic message_start and message_delta', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":1200,"cache_read_input_tokens":30000,"output_tokens":1}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"text":"hi"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":847}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')

    const usage = parseSseUsage(sse)
    // Input comes from the first event, output from the last. Taking either
    // alone loses half the bill.
    expect(usage.inputTokens).toBe(1200)
    expect(usage.cacheReadTokens).toBe(30_000)
    expect(usage.outputTokens).toBe(847)
    expect(usage.stopReason).toBe('end_turn')
  })

  it('reads the responses api completion event', () => {
    const sse =
      'data: {"type":"response.completed","response":{"model":"gpt-5","usage":{"input_tokens":500,"output_tokens":60}}}\n\n'
    expect(parseSseUsage(sse)).toMatchObject({ inputTokens: 500, outputTokens: 60 })
  })

  it('reads gemini chunks', () => {
    const sse =
      'data: {"usageMetadata":{"promptTokenCount":300,"cachedContentTokenCount":100,"candidatesTokenCount":9}}\n\n'
    expect(parseSseUsage(sse)).toMatchObject({ inputTokens: 200, cacheReadTokens: 100 })
  })

  it('survives a truncated stream without throwing', () => {
    expect(() => parseSseUsage('data: {"type":"message_start","mess')).not.toThrow()
    expect(parseSseUsage('').found).toBe(false)
  })
})

describe('parseCapture', () => {
  it('parses a whole capture file, response winning on model', () => {
    const parsed = parseCapture({
      tool: 'claude',
      sessionTag: 'a1b2c3d4',
      provider: 'anthropic',
      apiFormat: 'anthropic-messages',
      capturedAt: '2026-09-09T10:00:00.000Z',
      request: {
        path: '/v1/messages',
        body: {
          model: 'claude-opus-5',
          system: 'You are Claude Code',
          messages: [{ role: 'user', content: 'fix the login bug' }],
        },
      },
      response: {
        body: {
          model: 'claude-opus-5-20260101',
          usage: { input_tokens: 42, output_tokens: 7 },
        },
      },
    })

    expect(parsed.tool).toBe('claude')
    expect(parsed.sessionTag).toBe('a1b2c3d4')
    // The response is authoritative: it names the exact model version served.
    expect(parsed.model).toBe('claude-opus-5-20260101')
    expect(parsed.usage.inputTokens).toBe(42)
    expect(parsed.request?.messages).toHaveLength(1)
    expect(parsed.capturedAt).toBe(Date.parse('2026-09-09T10:00:00.000Z'))
  })

  it('parses a streamed capture, where the body is raw SSE text', () => {
    const parsed = parseCapture({
      apiFormat: 'anthropic-messages',
      provider: 'anthropic',
      capturedAt: '2026-09-09T10:00:00.000Z',
      request: { path: '/v1/messages', body: { model: 'claude-opus-5', messages: [] } },
      response: {
        streaming: true,
        body: 'data: {"type":"message_delta","usage":{"output_tokens":99}}\n\n',
      },
    })
    expect(parsed.usage.outputTokens).toBe(99)
  })

  it('does not fall over on a capture it cannot parse', () => {
    const parsed = parseCapture({ apiFormat: 'unknown', request: {}, response: {} })
    expect(parsed.request).toBeNull()
    expect(parsed.usage.found).toBe(false)
    expect(parsed.model).toBe('unknown')
  })
})
