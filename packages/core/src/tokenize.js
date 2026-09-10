/**
 * Token counting.
 *
 * Pure: the encoders ship as bundled rank tables inside js-tiktoken, so nothing
 * here reads a file or touches the network.
 *
 * These numbers are an *estimate*. They exist to fill the gauge while a request
 * is in flight; once the response lands, `rescaleToActual` in `compose/`
 * replaces them with the provider's real counts. See WIRE-FORMATS.md section 6.
 *
 * @module
 */

import { getEncoding } from 'js-tiktoken'

/**
 * OpenAI's newer models use o200k_base; everything before them uses
 * cl100k_base.
 *
 * Anthropic and Gemini have proprietary tokenizers we cannot run locally.
 * cl100k_base lands within about 5-10% for them — far better than chars/4, and
 * only used until the real count arrives.
 */
const O200K_MODELS = /^(gpt-5|gpt-4\.1|gpt-4o|o1|o3|o4|chatgpt-4o)/

/** @type {Map<string, import('js-tiktoken').Tiktoken>} */
const encoders = new Map()

/**
 * Which encoder to use for a model name.
 *
 * @param {string} [model]
 * @returns {'o200k_base' | 'cl100k_base'}
 */
export function encodingNameFor(model = '') {
  const name = model.toLowerCase().replace(/^models\//, '')
  return O200K_MODELS.test(name) ? 'o200k_base' : 'cl100k_base'
}

/**
 * Load an encoder, memoised. Returns null if it cannot be built, in which case
 * callers fall back to the character estimate.
 *
 * @param {string} [model]
 * @returns {import('js-tiktoken').Tiktoken | null}
 */
export function encoderFor(model) {
  const name = encodingNameFor(model)
  const cached = encoders.get(name)
  if (cached) return cached
  try {
    const encoder = getEncoding(name)
    encoders.set(name, encoder)
    return encoder
  } catch {
    return null
  }
}

/**
 * The fallback every path degrades to: roughly four characters per token.
 *
 * @param {number} chars
 * @returns {number}
 */
export function estimateFromChars(chars) {
  return Math.ceil(Math.max(0, chars) / 4)
}

/**
 * Count the tokens in a string.
 *
 * @param {string} text
 * @param {string} [model]
 * @returns {number}
 */
export function countTokens(text, model) {
  if (typeof text !== 'string' || text === '') return 0

  const encoder = encoderFor(model)
  if (!encoder) return estimateFromChars(text.length)

  try {
    return encoder.encode(text).length
  } catch {
    // Captured content can contain literal special-token text such as
    // "<|endoftext|>", which the encoder refuses by default. An estimate is
    // better than throwing inside a measurement tool.
    return estimateFromChars(text.length)
  }
}

/**
 * Count a JSON structure the way a provider bills it — the serialised form.
 *
 * @param {unknown} value
 * @param {string} [model]
 * @returns {number}
 */
export function countJsonTokens(value, model) {
  if (value === undefined || value === null) return 0
  try {
    return countTokens(JSON.stringify(value), model)
  } catch {
    return 0
  }
}
