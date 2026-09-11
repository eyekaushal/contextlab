import { describe, expect, it } from 'vitest'
import {
  assertValid,
  buildDocument,
  CATEGORIES,
  FORMAT_VERSION,
  fromOtlp,
  genAiSystem,
  hexId,
  SCHEMA,
  session,
  toOtlp,
  validate,
} from '../src/index.js'

/**
 * @param {Partial<any>} [overrides]
 * @returns {any}
 */
function sessionRow(overrides = {}) {
  return {
    id: 'tag:a1b2c3d4',
    tool: 'claude',
    provider: 'anthropic',
    apiFormat: 'anthropic-messages',
    transport: 'reverse-proxy',
    model: 'claude-opus-4-5',
    projectPath: '/repo/contextlab',
    projectName: 'contextlab',
    startedAt: Date.parse('2026-09-11T10:00:00Z'),
    lastSeenAt: Date.parse('2026-09-11T10:08:00Z'),
    turnCount: 2,
    inputTokens: 270_000,
    outputTokens: 600,
    cacheReadTokens: 0,
    peakContextTokens: 142_000,
    costUsd: 1.35,
    equivalentCostUsd: 1.35,
    billingMode: 'api',
    findings: [
      {
        rule: 'unused-mcp-server',
        severity: 'critical',
        title: 'MCP server "playwright" was never used',
        detail: 'Adds 7,985 tokens to every turn.',
        fix: 'Remove from .mcp.json',
        wastedTokens: 47_911,
        wastedCostUsd: 0.24,
        evidence: { server: 'playwright', turns: 6 },
      },
    ],
    turns: [
      {
        id: 'cap-0',
        seq: 0,
        capturedAt: Date.parse('2026-09-11T10:00:00Z'),
        provider: 'anthropic',
        model: 'claude-opus-4-5',
        stopReason: 'end_turn',
        inputTokens: 132_000,
        outputTokens: 280,
        cacheReadTokens: 1000,
        contextTokens: 133_000,
        systemTokens: 21_000,
        toolsTokens: 8000,
        messagesTokens: 104_000,
        contextLimit: 200_000,
        completedMs: 3200,
        costUsd: 0.66,
        equivalentCostUsd: 0.66,
        composition: [
          { category: 'tool_results', tokens: 104_000, percent: 78.2 },
          { category: 'system_prompt', tokens: 21_000, percent: 15.8 },
        ],
        systemSegments: [{ kind: 'memory_file', label: 'CLAUDE.md', tokens: 20_800 }],
        attribution: [
          {
            entityType: 'mcp_server',
            entityName: 'playwright',
            tokens: 7985,
            definitionTokens: 7985,
            callTokens: 0,
            resultTokens: 0,
            calls: 0,
            costUsd: 0.04,
          },
        ],
        messages: [
          {
            index: 0,
            role: 'user',
            tokens: 36,
            blocks: [
              {
                blockType: 'text',
                category: 'user_text',
                role: 'user',
                tokens: 36,
                chars: 140,
                preview: 'the build is failing',
                text: 'the build is failing, in full',
                turnsPresent: 6,
              },
            ],
          },
        ],
      },
      {
        id: 'cap-1',
        seq: 1,
        capturedAt: Date.parse('2026-09-11T10:01:00Z'),
        provider: 'anthropic',
        model: 'claude-opus-4-5',
        inputTokens: 138_000,
        outputTokens: 320,
        contextTokens: 142_000,
        systemTokens: 21_000,
        toolsTokens: 8000,
        messagesTokens: 113_000,
        contextLimit: 200_000,
        costUsd: 0.69,
        equivalentCostUsd: 0.69,
        composition: [{ category: 'tool_results', tokens: 113_000, percent: 79.6 }],
      },
    ],
    ...overrides,
  }
}

/** @param {any} [options] */
const document = (options) =>
  buildDocument([session(sessionRow(), options)], {
    now: Date.parse('2026-09-11T12:00:00Z'),
    ...options,
  })

describe('the document', () => {
  it('validates against its own schema', () => {
    const result = validate(document())
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('states which format, version and semconv revision it is', () => {
    const doc = document()
    expect(doc.format).toBe('contextlab')
    expect(doc.version).toBe(FORMAT_VERSION)
    // A reader must never be guessing which spelling of a moving spec this is.
    expect(doc.semconv).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('spells shared attributes exactly as OpenTelemetry spells them', () => {
    const [first] = /** @type {any[]} */ (document().sessions)
    const turn = first.turns[0]
    expect(turn.attributes['gen_ai.operation.name']).toBe('chat')
    expect(turn.attributes['gen_ai.request.model']).toBe('claude-opus-4-5')
    expect(turn.attributes['gen_ai.usage.input_tokens']).toBe(132_000)
    expect(turn.attributes['gen_ai.usage.output_tokens']).toBe(280)
    expect(turn.attributes['gen_ai.response.finish_reasons']).toEqual(['end_turn'])
  })

  it('maps providers onto the OTel enum rather than passing ours through', () => {
    expect(genAiSystem('anthropic')).toBe('anthropic')
    expect(genAiSystem('gemini')).toBe('gcp.gemini')
    expect(genAiSystem('vertex')).toBe('gcp.vertex_ai')
    expect(genAiSystem('chatgpt')).toBe('openai')
    // Something we have never seen still round-trips rather than vanishing.
    expect(genAiSystem('mystery')).toBe('mystery')
  })

  it('carries what OTel does not model', () => {
    const [first] = /** @type {any[]} */ (document().sessions)
    const turn = first.turns[0]
    expect(turn['contextlab.composition'][0].category).toBe('tool_results')
    expect(turn['contextlab.attribution'][0].entity_name).toBe('playwright')
    expect(turn['contextlab.system_segments'][0].label).toBe('CLAUDE.md')
    // Cache accounting is missing from the conventions and moves the bill by
    // an order of magnitude.
    expect(turn['contextlab.cache'].read_tokens).toBe(1000)
    expect(first['contextlab.findings'][0].rule).toBe('unused-mcp-server')
  })

  it('keeps the context invariant: the parts sum to the whole', () => {
    const [first] = /** @type {any[]} */ (document().sessions)
    for (const turn of first.turns) {
      const context = turn['contextlab.context']
      expect(context.system_tokens + context.tools_tokens + context.messages_tokens).toBe(
        context.tokens,
      )
    }
  })

  it('omits what it does not know rather than writing zeroes', () => {
    const doc = buildDocument([session({ id: 'bare', turns: [] })])
    const [first] = /** @type {any[]} */ (doc.sessions)
    expect(first['contextlab.project']).toBeUndefined()
    expect(first['contextlab.findings']).toBeUndefined()
    expect(validate(doc).valid).toBe(true)
  })
})

describe('content levels', () => {
  it('carries previews by default, not the text', () => {
    const [first] = /** @type {any[]} */ (document().sessions)
    const block = first.turns[0]['contextlab.messages'][0].blocks[0]
    // A shared session is somebody's source code and prompts.
    expect(block.text).toBe('the build is failing')
    expect(block.turns_present).toBe(6)
  })

  it('carries the full text when asked', () => {
    const [first] = /** @type {any[]} */ (document({ content: 'full' }).sessions)
    expect(first.turns[0]['contextlab.messages'][0].blocks[0].text).toBe(
      'the build is failing, in full',
    )
  })

  it('drops messages entirely at content: none, keeping every number', () => {
    const doc = document({ content: 'none' })
    const [first] = /** @type {any[]} */ (doc.sessions)
    expect(first.turns[0]['contextlab.messages']).toBeUndefined()
    expect(first.turns[0]['contextlab.composition']).toBeDefined()
    expect(doc.content).toBe('none')
    expect(validate(doc).valid).toBe(true)
  })

  it('refuses a content level it does not recognise', () => {
    expect(
      buildDocument([], { content: /** @type {any} */ ('everything') }).content,
    ).toBe('preview')
  })
})

describe('the validator', () => {
  it('names the field and the path when something is wrong', () => {
    const doc = /** @type {any} */ (document())
    doc.sessions[0].turns[0].attributes['gen_ai.usage.input_tokens'] = -5

    const result = validate(doc)
    expect(result.valid).toBe(false)
    expect(result.errors[0].path).toBe(
      '/sessions/0/turns/0/attributes/gen_ai.usage.input_tokens',
    )
    expect(result.errors[0].message).toContain('at least 0')
  })

  it('catches a missing required field', () => {
    const result = validate({ format: 'contextlab', version: '1.0.0', sessions: [] })
    expect(result.errors.some((error) => error.message.includes('exportedAt'))).toBe(true)
  })

  it('catches a category that is not one of the eleven', () => {
    const doc = /** @type {any} */ (document())
    doc.sessions[0].turns[0]['contextlab.composition'][0].category = 'invented'
    expect(validate(doc).valid).toBe(false)
  })

  it('rejects a document that is not ours at all', () => {
    expect(validate({ format: 'lhar', version: '1.0.0' }).valid).toBe(false)
    expect(validate(null).valid).toBe(false)
    expect(validate('a string').valid).toBe(false)
  })

  it('rejects an unexpected property rather than silently keeping it', () => {
    const doc = /** @type {any} */ (document())
    doc.sessions[0].surprise = true
    const result = validate(doc)
    expect(result.errors[0].message).toBe('unexpected property')
  })

  it('checks date-times are actually date-times', () => {
    const doc = /** @type {any} */ (document())
    doc.exportedAt = 'last tuesday'
    expect(validate(doc).valid).toBe(false)
  })

  it('throws with every problem listed, for a caller who wants to fail loudly', () => {
    expect(() => assertValid({ format: 'nope' })).toThrow(/Not a valid contextlab/)
    expect(assertValid(document())).toBeTruthy()
  })

  it('covers every category the schema claims to allow', () => {
    expect(SCHEMA.$defs.compositionEntry.properties.category.enum).toEqual(CATEGORIES)
  })
})

describe('OTLP conversion', () => {
  it('makes a session a trace and each turn a span inside it', () => {
    const payload = /** @type {any} */ (toOtlp(document()))
    const spans = payload.resourceSpans[0].scopeSpans[0].spans

    // One session span plus two turns.
    expect(spans).toHaveLength(3)
    expect(spans[0].parentSpanId).toBeUndefined()
    expect(spans[1].parentSpanId).toBe(spans[0].spanId)
    expect(spans[1].traceId).toBe(spans[0].traceId)
    expect(spans[1].name).toBe('chat claude-opus-4-5')
  })

  it('emits ids of the width OTLP requires, stably', () => {
    const payload = /** @type {any} */ (toOtlp(document()))
    const [first] = payload.resourceSpans[0].scopeSpans[0].spans
    expect(first.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(first.spanId).toMatch(/^[0-9a-f]{16}$/)
    // Exporting the same session twice must land on the same trace.
    expect(hexId('tag:a1b2c3d4', 32)).toBe(hexId('tag:a1b2c3d4', 32))
    expect(hexId('other', 32)).not.toBe(hexId('tag:a1b2c3d4', 32))
  })

  it('keeps gen_ai attributes on the span, where a backend expects them', () => {
    const payload = /** @type {any} */ (toOtlp(document()))
    const turn = payload.resourceSpans[0].scopeSpans[0].spans[1]
    const keys = turn.attributes.map((/** @type {any} */ a) => a.key)
    expect(keys).toContain('gen_ai.request.model')
    expect(keys).toContain('gen_ai.usage.input_tokens')

    const input = turn.attributes.find(
      (/** @type {any} */ a) => a.key === 'gen_ai.usage.input_tokens',
    )
    // OTLP wants integers as strings inside intValue.
    expect(input.value).toEqual({ intValue: '132000' })
  })

  it('flattens composition into one attribute per category, not a blob', () => {
    const payload = /** @type {any} */ (toOtlp(document()))
    const turn = payload.resourceSpans[0].scopeSpans[0].spans[1]
    const tools = turn.attributes.find(
      (/** @type {any} */ a) => a.key === 'contextlab.composition.tool_results',
    )
    // A backend can chart a scalar; it can do nothing with JSON in a string.
    expect(tools.value).toEqual({ intValue: '104000' })
  })

  it('round-trips a session back out of OTLP', () => {
    const original = document()
    const restored = /** @type {any} */ (fromOtlp(toOtlp(original)))
    const [before] = /** @type {any[]} */ (original.sessions)
    const [after] = restored.sessions

    expect(after.id).toBe(before.id)
    expect(after['contextlab.tool']).toBe('claude')
    expect(after['contextlab.project'].name).toBe('contextlab')
    expect(after.turns).toHaveLength(2)
    expect(after.turns[0].attributes['gen_ai.usage.input_tokens']).toBe(132_000)
    expect(after.turns[0]['contextlab.context'].tokens).toBe(133_000)
    expect(after.turns[1].sequence).toBe(1)
    expect(validate(restored).valid).toBe(true)
  })

  it("does not turn somebody else's OTLP into a contextlab document", () => {
    const foreign = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'a'.repeat(32),
                  spanId: 'b'.repeat(16),
                  name: 'GET /users',
                  startTimeUnixNano: '0',
                  endTimeUnixNano: '0',
                  attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }],
                },
              ],
            },
          ],
        },
      ],
    }
    const restored = /** @type {any} */ (fromOtlp(foreign))
    expect(restored.sessions).toEqual([])
  })

  it('survives an empty payload', () => {
    expect(/** @type {any} */ (fromOtlp({})).sessions).toEqual([])
    expect(/** @type {any} */ (toOtlp({ sessions: [] })).resourceSpans).toHaveLength(1)
  })
})
