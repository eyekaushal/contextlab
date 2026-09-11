/**
 * The contextlab capture format, as a JSON Schema.
 *
 * A **profile** of the OpenTelemetry GenAI semantic conventions, not a new
 * format. Every attribute that OTel already defines is spelled exactly as OTel
 * spells it — `gen_ai.request.model`, `gen_ai.usage.input_tokens` — so an
 * exported file drops into an existing observability pipeline without a
 * translation layer.
 *
 * Our own namespace carries only what OTel does not model: how a context window
 * was composed, what each part of it cost, and what was wasted.
 *
 * The schema lives here as an object rather than a `.json` file so it can carry
 * comments explaining *why* a field exists. `scripts/write-schema.mjs` writes
 * the plain JSON alongside it for anyone validating with their own tooling.
 *
 * @module
 */

export const FORMAT_NAME = 'contextlab'
export const FORMAT_VERSION = '1.0.0'
export const SCHEMA_ID =
  'https://github.com/eyekaushal/contextlab/schema/contextlab-1.0.0.schema.json'

/**
 * Which revision of the OpenTelemetry GenAI semantic conventions the
 * `gen_ai.*` attributes follow. Stated in every document so a reader is never
 * guessing which spelling of a still-moving spec they are looking at.
 */
export const SEMCONV_VERSION = '1.37.0'

/** The eleven composition categories. Fixed — see notes/WIRE-FORMATS.md §7. */
export const CATEGORIES = [
  'system_prompt',
  'tool_definitions',
  'tool_calls',
  'tool_results',
  'user_text',
  'assistant_text',
  'thinking',
  'system_injections',
  'images',
  'cache_markers',
  'other',
]

/** What a run of tokens can be traced back to. */
export const ENTITY_TYPES = ['mcp_server', 'tool', 'file', 'prompt_segment']

/** How much message content a document carries. */
export const CONTENT_LEVELS = ['none', 'preview', 'full']

const nonNegativeInteger = { type: 'integer', minimum: 0 }
const nonNegativeNumber = { type: 'number', minimum: 0 }

export const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: SCHEMA_ID,
  title: 'contextlab capture document',
  description:
    'A portable record of one or more agent sessions: what filled the context ' +
    'window, what it cost, and what was wasted. A conformant profile of the ' +
    'OpenTelemetry GenAI semantic conventions.',
  type: 'object',
  required: ['format', 'version', 'exportedAt', 'sessions'],
  additionalProperties: false,
  properties: {
    format: { const: FORMAT_NAME },
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: 'Version of this format, not of the tool that wrote it.',
    },
    exportedAt: { type: 'string', format: 'date-time' },
    semconv: {
      type: 'string',
      description: 'OpenTelemetry semantic conventions version the gen_ai.* keys follow.',
    },
    content: {
      enum: CONTENT_LEVELS,
      description:
        'How much message content is included. Defaults to preview, because a ' +
        "shared session is somebody's source code and prompts.",
    },
    producer: {
      type: 'object',
      required: ['name'],
      additionalProperties: true,
      properties: {
        name: { type: 'string' },
        version: { type: 'string' },
      },
    },
    pricing: {
      type: 'object',
      description: 'Which price table the cost figures were computed against.',
      additionalProperties: true,
      properties: {
        source: { type: 'string' },
        updatedAt: { type: 'string' },
      },
    },
    sessions: { type: 'array', items: { $ref: '#/$defs/session' } },
  },

  $defs: {
    session: {
      type: 'object',
      required: ['id', 'attributes', 'turns'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        attributes: {
          type: 'object',
          description:
            'OTel GenAI attributes describing the session as a whole. Keys are ' +
            'spelled exactly as the semantic conventions spell them.',
          additionalProperties: true,
          properties: {
            'gen_ai.system': {
              type: 'string',
              description: 'The provider: anthropic, openai, gcp.gemini.',
            },
            'gen_ai.request.model': { type: 'string' },
            'gen_ai.response.model': { type: 'string' },
          },
        },
        'contextlab.tool': {
          type: 'string',
          description: 'The coding agent: claude, codex, aider, gemini, cline.',
        },
        'contextlab.api_format': { type: 'string' },
        'contextlab.transport': { enum: ['reverse-proxy', 'mitmproxy', 'import'] },
        'contextlab.project': {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            name: { type: 'string' },
          },
        },
        startedAt: { type: 'string', format: 'date-time' },
        endedAt: { type: 'string', format: 'date-time' },
        'contextlab.totals': { $ref: '#/$defs/totals' },
        'contextlab.findings': {
          type: 'array',
          items: { $ref: '#/$defs/finding' },
        },
        turns: { type: 'array', items: { $ref: '#/$defs/turn' } },
      },
    },

    turn: {
      type: 'object',
      required: ['id', 'sequence', 'startTime', 'attributes'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        sequence: nonNegativeInteger,
        startTime: { type: 'string', format: 'date-time' },
        durationMs: nonNegativeInteger,
        attributes: {
          type: 'object',
          description: 'OTel GenAI attributes for one inference call.',
          additionalProperties: true,
          properties: {
            'gen_ai.operation.name': { type: 'string' },
            'gen_ai.system': { type: 'string' },
            'gen_ai.request.model': { type: 'string' },
            'gen_ai.response.model': { type: 'string' },
            'gen_ai.response.finish_reasons': {
              type: 'array',
              items: { type: 'string' },
            },
            'gen_ai.usage.input_tokens': nonNegativeInteger,
            'gen_ai.usage.output_tokens': nonNegativeInteger,
          },
        },
        'contextlab.context': { $ref: '#/$defs/context' },
        'contextlab.cache': {
          type: 'object',
          description:
            'Cache accounting, which OTel does not model and which changes the ' +
            'bill by an order of magnitude.',
          additionalProperties: false,
          properties: {
            read_tokens: nonNegativeInteger,
            write_tokens: nonNegativeInteger,
          },
        },
        'contextlab.cost': { $ref: '#/$defs/cost' },
        'contextlab.composition': {
          type: 'array',
          items: { $ref: '#/$defs/compositionEntry' },
        },
        'contextlab.system_segments': {
          type: 'array',
          items: { $ref: '#/$defs/systemSegment' },
        },
        'contextlab.attribution': {
          type: 'array',
          items: { $ref: '#/$defs/attributionEntry' },
        },
        'contextlab.messages': {
          type: 'array',
          items: { $ref: '#/$defs/message' },
        },
      },
    },

    context: {
      type: 'object',
      description: 'The window itself. These three parts sum to `tokens` exactly.',
      additionalProperties: false,
      properties: {
        tokens: nonNegativeInteger,
        system_tokens: nonNegativeInteger,
        tools_tokens: nonNegativeInteger,
        messages_tokens: nonNegativeInteger,
        limit: nonNegativeInteger,
      },
    },

    cost: {
      type: 'object',
      description:
        'Both figures, always. A subscription user pays nothing marginal for a ' +
        'turn, but still needs the equivalent to compare sessions.',
      additionalProperties: false,
      properties: {
        currency: { type: 'string' },
        actual: nonNegativeNumber,
        equivalent: nonNegativeNumber,
        billing_mode: { enum: ['api', 'subscription', 'unknown'] },
      },
    },

    compositionEntry: {
      type: 'object',
      required: ['category', 'tokens'],
      additionalProperties: false,
      properties: {
        category: { enum: CATEGORIES },
        tokens: nonNegativeInteger,
        percent: { type: 'number', minimum: 0, maximum: 100 },
      },
    },

    systemSegment: {
      type: 'object',
      required: ['kind', 'label', 'tokens'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string' },
        label: { type: 'string' },
        tokens: nonNegativeInteger,
      },
    },

    attributionEntry: {
      type: 'object',
      required: ['entity_type', 'entity_name', 'tokens'],
      additionalProperties: false,
      properties: {
        entity_type: { enum: ENTITY_TYPES },
        entity_name: { type: 'string' },
        tokens: nonNegativeInteger,
        definition_tokens: nonNegativeInteger,
        call_tokens: nonNegativeInteger,
        result_tokens: nonNegativeInteger,
        calls: nonNegativeInteger,
        cost: nonNegativeNumber,
      },
    },

    message: {
      type: 'object',
      required: ['index', 'role'],
      additionalProperties: false,
      properties: {
        index: nonNegativeInteger,
        role: { type: 'string' },
        tokens: nonNegativeInteger,
        blocks: { type: 'array', items: { $ref: '#/$defs/block' } },
      },
    },

    block: {
      type: 'object',
      required: ['type', 'category', 'tokens'],
      additionalProperties: false,
      properties: {
        type: { type: 'string' },
        category: { enum: CATEGORIES },
        role: { type: 'string' },
        tokens: nonNegativeInteger,
        chars: nonNegativeInteger,
        tool_name: { type: 'string' },
        tool_use_id: { type: 'string' },
        file_path: { type: 'string' },
        mcp_server: { type: 'string' },
        turns_present: {
          type: 'integer',
          minimum: 1,
          description:
            'How many turns carried this exact content. Anything above one was ' +
            'paid for more than once.',
        },
        text: { type: 'string' },
      },
    },

    totals: {
      type: 'object',
      additionalProperties: false,
      properties: {
        turns: nonNegativeInteger,
        input_tokens: nonNegativeInteger,
        output_tokens: nonNegativeInteger,
        cache_read_tokens: nonNegativeInteger,
        cache_write_tokens: nonNegativeInteger,
        peak_context_tokens: nonNegativeInteger,
        cost: { $ref: '#/$defs/cost' },
      },
    },

    finding: {
      type: 'object',
      required: ['rule', 'severity', 'title'],
      additionalProperties: false,
      properties: {
        rule: { type: 'string' },
        severity: { enum: ['critical', 'warning', 'info'] },
        title: { type: 'string' },
        detail: { type: 'string' },
        fix: { type: 'string' },
        wasted_tokens: nonNegativeInteger,
        wasted_cost: nonNegativeNumber,
        evidence: { type: 'object', additionalProperties: true },
      },
    },
  },
}
