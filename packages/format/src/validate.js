/**
 * A validator for the subset of JSON Schema our schema uses.
 *
 * Written out rather than pulled from a library on purpose. This package exists
 * so other people can read and write the format, and a format package that
 * drags in a validation framework to check its own documents is asking for a
 * dependency decision it has no business making on someone else's behalf.
 *
 * The published schema is ordinary JSON Schema, so anyone who already has ajv
 * should use ajv. This is for everyone else.
 *
 * Errors carry a JSON Pointer path, because "expected integer" without a
 * location is not a diagnostic.
 *
 * @module
 */

import { SCHEMA } from './schema.js'

/**
 * @typedef {Object} ValidationError
 * @property {string} path     JSON Pointer into the document
 * @property {string} message
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {ValidationError[]} errors
 */

/**
 * @param {unknown} document
 * @param {object} [schema]
 * @returns {ValidationResult}
 */
export function validate(document, schema = SCHEMA) {
  /** @type {ValidationError[]} */
  const errors = []
  check(document, schema, '', schema, errors)
  return { valid: errors.length === 0, errors }
}

/**
 * Throw on an invalid document, with every problem in the message.
 *
 * @param {unknown} document
 * @param {object} [schema]
 * @returns {any} the document, for chaining
 */
export function assertValid(document, schema = SCHEMA) {
  const result = validate(document, schema)
  if (result.valid) return document

  const detail = result.errors
    .slice(0, 10)
    .map((error) => `  ${error.path || '/'}: ${error.message}`)
    .join('\n')
  const more =
    result.errors.length > 10 ? `\n  ...and ${result.errors.length - 10} more` : ''
  throw new Error(`Not a valid contextlab document:\n${detail}${more}`)
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/**
 * @param {unknown} value
 * @param {any} schema
 * @param {string} path
 * @param {any} root
 * @param {ValidationError[]} errors
 * @returns {void}
 */
function check(value, schema, path, root, errors) {
  if (!schema || typeof schema !== 'object') return

  if (schema.$ref) {
    check(value, resolve(schema.$ref, root), path, root, errors)
    return
  }

  if ('const' in schema && value !== schema.const) {
    errors.push({ path, message: `must be ${JSON.stringify(schema.const)}` })
    return
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: `must be one of ${schema.enum.join(', ')}` })
    return
  }

  if (schema.type && !isType(value, schema.type)) {
    errors.push({ path, message: `expected ${schema.type}, got ${nameOf(value)}` })
    return
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ path, message: `must be at least ${schema.minimum}` })
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({ path, message: `must be at most ${schema.maximum}` })
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ path, message: `must be at least ${schema.minLength} characters` })
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `must match ${schema.pattern}` })
    }
    // Only date-time is enforced. Formats we do not check are not claimed.
    if (schema.format === 'date-time' && !ISO_DATE_TIME.test(value)) {
      errors.push({ path, message: 'must be an ISO 8601 date-time' })
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      check(item, schema.items, `${path}/${index}`, root, errors)
    })
  }

  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push({ path, message: `missing required "${key}"` })
    }

    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key]
      if (property) {
        check(item, property, `${path}/${escapePointer(key)}`, root, errors)
        continue
      }
      if (schema.additionalProperties === false) {
        errors.push({
          path: `${path}/${escapePointer(key)}`,
          message: 'unexpected property',
        })
      }
    }
  }
}

/**
 * @param {string} ref
 * @param {any} root
 * @returns {any}
 */
function resolve(ref, root) {
  // Only local pointers, which is all our schema uses. A remote $ref would mean
  // the validator needed a network, and it does not have one.
  const parts = ref.replace(/^#\//, '').split('/')
  let node = root
  for (const part of parts)
    node = node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')]
  return node
}

/**
 * @param {string} key
 * @returns {string}
 */
function escapePointer(key) {
  return key.replaceAll('~', '~0').replaceAll('/', '~1')
}

/**
 * @param {unknown} value
 * @param {string} type
 * @returns {boolean}
 */
function isType(value, type) {
  switch (type) {
    case 'object':
      return isPlainObject(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return true
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function nameOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}
