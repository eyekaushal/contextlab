/**
 * Exact token counts from Anthropic's free `count_tokens` endpoint.
 *
 * Our local estimate uses cl100k, which is 5-10% off for Anthropic because
 * their tokenizer is proprietary. Usually that does not matter: the response
 * carries the real count and `rescaleToActual` corrects everything.
 *
 * It matters when the response carries no usage at all — a 429, a network
 * failure, a stream that died. Those turns are otherwise stuck with an
 * approximation, and they are disproportionately the ones someone is looking at
 * when something has gone wrong.
 *
 * Requires a key, so it is opt-in and never happens on the ingest path by
 * default. contextlab does not hold credentials; the caller supplies one.
 *
 * @module
 */

export const COUNT_TOKENS_URL = 'https://api.anthropic.com/v1/messages/count_tokens'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * @typedef {Object} CountResult
 * @property {boolean} ok
 * @property {number} [inputTokens]
 * @property {string} [reason]
 */

/**
 * @param {Object} request
 * @param {string} request.model
 * @param {unknown} [request.system]
 * @param {unknown[]} [request.messages]
 * @param {unknown[]} [request.tools]
 * @param {{ apiKey?: string, fetch?: typeof globalThis.fetch, url?: string,
 *           timeoutMs?: number }} [options]
 * @returns {Promise<CountResult>}
 */
export async function countTokensExact(request, options = {}) {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, reason: 'no ANTHROPIC_API_KEY' }
  if (!request?.model) return { ok: false, reason: 'no model' }

  const doFetch = options.fetch ?? globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)

  try {
    const response = await doFetch(options.url ?? COUNT_TOKENS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: request.model,
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages ?? [],
        ...(request.tools?.length ? { tools: request.tools } : {}),
      }),
    })

    if (!response.ok) {
      return { ok: false, reason: `count_tokens returned ${response.status}` }
    }

    const body = /** @type {any} */ (await response.json())
    const inputTokens = Number(body?.input_tokens)
    if (!Number.isFinite(inputTokens)) {
      return { ok: false, reason: 'no input_tokens in the response' }
    }
    return { ok: true, inputTokens }
  } catch (error) {
    // This is an accuracy upgrade, never a requirement. A failure leaves the
    // local estimate in place and is not worth interrupting anyone about.
    return { ok: false, reason: String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * How far off our local estimate was.
 *
 * Useful on its own: running this over a few real turns is how we would know
 * whether the cl100k approximation is drifting for a model we do not tokenize
 * natively.
 *
 * @param {number} estimated
 * @param {number} exact
 * @returns {{ estimated: number, exact: number, delta: number, errorShare: number }}
 */
export function estimateError(estimated, exact) {
  const delta = estimated - exact
  return {
    estimated,
    exact,
    delta,
    errorShare: exact > 0 ? Math.abs(delta) / exact : 0,
  }
}
