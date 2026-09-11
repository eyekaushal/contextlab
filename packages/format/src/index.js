/**
 * @contextlab/format — the contextlab capture format.
 *
 * A conformant profile of the OpenTelemetry GenAI semantic conventions, plus
 * what OTel does not model: how a context window was composed, what each part
 * of it cost, and what was wasted.
 *
 * Publishable on its own, and deliberately dependency-free — a format package
 * should not make a validation-library decision on someone else's behalf.
 *
 * @module
 */

export { buildDocument, genAiSystem, session, turn } from './document.js'
export { fromOtlp, hexId, toOtlp } from './otlp.js'
export {
  CATEGORIES,
  CONTENT_LEVELS,
  ENTITY_TYPES,
  FORMAT_NAME,
  FORMAT_VERSION,
  SCHEMA,
  SCHEMA_ID,
  SEMCONV_VERSION,
} from './schema.js'
export { assertValid, validate } from './validate.js'
