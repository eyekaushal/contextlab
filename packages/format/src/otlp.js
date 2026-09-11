/**
 * Conversion to and from OTLP/JSON traces.
 *
 * This is the payoff for having built a profile rather than a new format. A
 * session becomes a trace, a turn becomes a span, and the `gen_ai.*` attributes
 * are already spelled the way every GenAI-aware backend expects — so an export
 * drops into an existing pipeline without anyone writing a mapping.
 *
 * Round-tripping is lossless for everything the schema defines, because the
 * `contextlab.*` attributes ride along as ordinary span attributes rather than
 * being flattened away.
 *
 * @module
 */

import { buildDocument } from './document.js'

const NANOS_PER_MS = 1_000_000

/**
 * Turn a document into an OTLP/JSON trace payload.
 *
 * @param {any} document
 * @returns {Record<string, unknown>}
 */
export function toOtlp(document) {
  const scopeSpans = []

  for (const session of document.sessions ?? []) {
    const traceId = hexId(String(session.id), 32)
    const sessionSpanId = hexId(`${session.id}:session`, 16)
    const spans = []

    const start = msOf(session.startedAt ?? session.turns?.[0]?.startTime)
    const end = msOf(session.endedAt ?? session.turns?.at(-1)?.startTime ?? start)

    // The session is a parent span, so a trace viewer shows turns nested inside
    // the conversation they belong to rather than as unrelated siblings.
    spans.push({
      traceId,
      spanId: sessionSpanId,
      name: `session ${session['contextlab.tool'] ?? ''}`.trim(),
      kind: 'SPAN_KIND_INTERNAL',
      startTimeUnixNano: String(start * NANOS_PER_MS),
      endTimeUnixNano: String(end * NANOS_PER_MS),
      attributes: toAttributes({
        ...session.attributes,
        'contextlab.session.id': session.id,
        'contextlab.tool': session['contextlab.tool'],
        'contextlab.api_format': session['contextlab.api_format'],
        'contextlab.transport': session['contextlab.transport'],
        'contextlab.project.path': session['contextlab.project']?.path,
        'contextlab.project.name': session['contextlab.project']?.name,
        ...flatten('contextlab.totals', session['contextlab.totals']),
        'contextlab.findings.count': session['contextlab.findings']?.length,
      }),
      status: { code: 'STATUS_CODE_UNSET' },
    })

    for (const turn of session.turns ?? []) {
      const startedAt = msOf(turn.startTime)
      spans.push({
        traceId,
        spanId: hexId(String(turn.id), 16),
        parentSpanId: sessionSpanId,
        // The semantic conventions name an inference span for the operation
        // and the model.
        name: `${turn.attributes?.['gen_ai.operation.name'] ?? 'chat'} ${
          turn.attributes?.['gen_ai.request.model'] ?? ''
        }`.trim(),
        kind: 'SPAN_KIND_CLIENT',
        startTimeUnixNano: String(startedAt * NANOS_PER_MS),
        endTimeUnixNano: String((startedAt + (turn.durationMs ?? 0)) * NANOS_PER_MS),
        attributes: toAttributes({
          ...turn.attributes,
          'contextlab.turn.sequence': turn.sequence,
          ...flatten('contextlab.context', turn['contextlab.context']),
          ...flatten('contextlab.cache', turn['contextlab.cache']),
          ...flatten('contextlab.cost', turn['contextlab.cost']),
          ...compositionAttributes(turn['contextlab.composition']),
        }),
        status: { code: 'STATUS_CODE_UNSET' },
      })
    }

    scopeSpans.push({
      scope: { name: 'contextlab', version: document.version },
      spans,
    })
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: toAttributes({
            'service.name': document.producer?.name ?? 'contextlab',
            'service.version': document.producer?.version,
            'telemetry.sdk.name': 'contextlab',
          }),
        },
        scopeSpans,
      },
    ],
  }
}

/**
 * Read an OTLP/JSON trace payload back into a document.
 *
 * Only spans we recognise are reconstructed. Someone else's OTLP export will
 * not become a contextlab document by accident, and it should not.
 *
 * @param {any} payload
 * @param {{ now?: number }} [options]
 * @returns {Record<string, unknown>}
 */
export function fromOtlp(payload, options = {}) {
  /** @type {Map<string, any>} */
  const sessions = new Map()
  /** @type {{ name: string, version?: string }} */
  let producer = { name: 'contextlab' }

  for (const resourceSpan of payload?.resourceSpans ?? []) {
    // toOtlp writes the producer into the resource, so a round trip should
    // bring back who made the file rather than assuming it was us.
    const resource = fromAttributes(resourceSpan.resource?.attributes)
    if (typeof resource['service.name'] === 'string') {
      producer = {
        name: resource['service.name'],
        ...(typeof resource['service.version'] === 'string'
          ? { version: resource['service.version'] }
          : {}),
      }
    }

    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        const attributes = fromAttributes(span.attributes)
        const sessionId = attributes['contextlab.session.id']

        if (sessionId) {
          sessions.set(String(sessionId), {
            id: String(sessionId),
            attributes: genAiOnly(attributes),
            ...maybe('contextlab.tool', attributes),
            ...maybe('contextlab.api_format', attributes),
            ...maybe('contextlab.transport', attributes),
            ...projectOf(attributes),
            startedAt: isoOf(span.startTimeUnixNano),
            endedAt: isoOf(span.endTimeUnixNano),
            'contextlab.totals': unflatten('contextlab.totals', attributes),
            turns: sessions.get(String(sessionId))?.turns ?? [],
          })
          continue
        }

        if (!span.parentSpanId) continue
        const parent = [...sessions.values()].find(
          (candidate) => hexId(`${candidate.id}:session`, 16) === span.parentSpanId,
        )
        const bucket = parent ?? orphan(sessions, span.parentSpanId)

        bucket.turns.push({
          id: span.spanId,
          sequence: Number(attributes['contextlab.turn.sequence'] ?? bucket.turns.length),
          startTime: isoOf(span.startTimeUnixNano),
          durationMs: Math.max(
            0,
            Math.round(
              (Number(span.endTimeUnixNano) - Number(span.startTimeUnixNano)) /
                NANOS_PER_MS,
            ),
          ),
          attributes: genAiOnly(attributes),
          'contextlab.context': unflatten('contextlab.context', attributes),
          'contextlab.cache': unflatten('contextlab.cache', attributes),
          'contextlab.cost': unflatten('contextlab.cost', attributes),
        })
      }
    }
  }

  // Spans can arrive in any order; turns are ordered by what they say they are.
  for (const item of sessions.values()) {
    item.turns.sort(
      (/** @type {any} */ a, /** @type {any} */ b) => a.sequence - b.sequence,
    )
  }

  return buildDocument([...sessions.values()], {
    content: 'none',
    producer,
    now: options.now,
  })
}

/**
 * @param {Map<string, any>} sessions
 * @param {string} parentSpanId
 * @returns {any}
 */
function orphan(sessions, parentSpanId) {
  const key = `orphan:${parentSpanId}`
  const existing = sessions.get(key)
  if (existing) return existing
  const created = { id: key, attributes: {}, turns: [] }
  sessions.set(key, created)
  return created
}

/**
 * @param {Record<string, unknown>} attributes
 * @returns {Record<string, unknown>}
 */
function genAiOnly(attributes) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('gen_ai.')) out[key] = value
  }
  return out
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} attributes
 * @returns {Record<string, unknown>}
 */
function maybe(key, attributes) {
  return attributes[key] === undefined ? {} : { [key]: attributes[key] }
}

/**
 * @param {Record<string, unknown>} attributes
 * @returns {Record<string, unknown>}
 */
function projectOf(attributes) {
  const path = attributes['contextlab.project.path']
  const name = attributes['contextlab.project.name']
  if (path === undefined && name === undefined) return {}
  return {
    'contextlab.project': {
      ...(path === undefined ? {} : { path }),
      ...(name === undefined ? {} : { name }),
    },
  }
}

/**
 * OTLP attributes are flat, so nested objects are spread with dotted keys.
 *
 * @param {string} prefix
 * @param {Record<string, unknown> | undefined} object
 * @returns {Record<string, unknown>}
 */
function flatten(prefix, object) {
  if (!object) return {}
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(`${prefix}.${key}`, /** @type {any} */ (value)))
      continue
    }
    out[`${prefix}.${key}`] = value
  }
  return out
}

/**
 * @param {string} prefix
 * @param {Record<string, unknown>} attributes
 * @returns {Record<string, unknown>}
 */
function unflatten(prefix, attributes) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (!key.startsWith(`${prefix}.`)) continue
    const parts = key.slice(prefix.length + 1).split('.')
    let node = out
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        node[part] = value
        return
      }
      if (!node[part]) node[part] = {}
      node = node[part]
    })
  }
  return out
}

/**
 * Every category as its own attribute, because a trace backend can group and
 * chart a scalar but cannot do anything with a JSON blob.
 *
 * @param {any[] | undefined} composition
 * @returns {Record<string, unknown>}
 */
function compositionAttributes(composition) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const row of composition ?? []) {
    out[`contextlab.composition.${row.category}`] = row.tokens
  }
  return out
}

/**
 * @param {Record<string, unknown>} object
 * @returns {any[]}
 */
function toAttributes(object) {
  const out = []
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) continue
    out.push({ key, value: toAnyValue(value) })
  }
  return out
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function toAnyValue(value) {
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toAnyValue) } }
  }
  return { stringValue: JSON.stringify(value) }
}

/**
 * @param {any[] | undefined} attributes
 * @returns {Record<string, unknown>}
 */
function fromAttributes(attributes) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const attribute of attributes ?? []) {
    out[attribute.key] = fromAnyValue(attribute.value)
  }
  return out
}

/**
 * @param {any} value
 * @returns {unknown}
 */
function fromAnyValue(value) {
  if (!value || typeof value !== 'object') return value
  if ('stringValue' in value) return value.stringValue
  if ('boolValue' in value) return value.boolValue
  if ('intValue' in value) return Number(value.intValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(fromAnyValue)
  return undefined
}

/**
 * A stable hex id of the required width, derived from a string.
 *
 * OTLP wants fixed-length hex ids. Deriving them from our own ids rather than
 * generating random ones means exporting the same session twice produces the
 * same trace, which is what makes a re-export idempotent in a backend.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
export function hexId(text, width) {
  let hash = 0x811c9dc5
  let out = ''
  for (let round = 0; out.length < width; round += 1) {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i) + round
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    out += hash.toString(16).padStart(8, '0')
  }
  return out.slice(0, width)
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function msOf(value) {
  const at = Date.parse(String(value))
  return Number.isFinite(at) ? at : Date.now()
}

/**
 * @param {unknown} nanos
 * @returns {string}
 */
function isoOf(nanos) {
  const ms = Number(nanos) / NANOS_PER_MS
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString()
}
