/**
 * Is this turn metered, or already paid for?
 *
 * A Claude Max or ChatGPT Plus user pays nothing extra for a given turn. Telling
 * them it cost $3.20 is simply false — and it is the kind of false that makes
 * someone stop trusting every other number on the screen.
 *
 * The signal is in the request headers, and it survives redaction: we destroy
 * header *values*, never the names, and `anthropic-beta` is not a credential.
 * So a capture still says how the caller authenticated without ever having
 * stored how they authenticated.
 *
 * Pure.
 *
 * @module
 */

/** @typedef {'api' | 'subscription' | 'unknown'} BillingMode */

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} name
 * @returns {string}
 */
function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (value === undefined) return ''
  return Array.isArray(value) ? (value[0] ?? '') : value
}

/**
 * Work out how a request was paid for.
 *
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {{ provider?: string, path?: string }} [context]
 * @returns {BillingMode}
 */
export function detectBillingMode(headers = {}, context = {}) {
  // An API key is a metered key, full stop. Both spellings.
  if (header(headers, 'x-api-key') || header(headers, 'x-goog-api-key')) return 'api'

  const beta = header(headers, 'anthropic-beta')
  // Claude Code signed in with an account sends an OAuth beta flag alongside a
  // bearer token. An API-key caller never does.
  if (/oauth/i.test(beta)) return 'subscription'

  // ChatGPT's own backend is only reachable with a ChatGPT session, never with
  // a metered API key.
  const provider = String(context.provider ?? '')
  if (provider === 'chatgpt') return 'subscription'
  if (/^\/(backend-api|codex)\//.test(String(context.path ?? ''))) return 'subscription'

  const authorization = header(headers, 'authorization')
  if (authorization) {
    // A redacted header still tells us one was sent, but not which kind — so
    // for providers where a bearer token could be either, say so.
    if (provider === 'openai' || provider === 'gemini' || provider === 'vertex') {
      return 'api'
    }
    return 'unknown'
  }

  return 'unknown'
}

/**
 * Apply the user's override, if they set one.
 *
 * Detection is a heuristic over headers we do not control. A user who knows
 * they are on a subscription should be able to say so once and stop being told
 * otherwise.
 *
 * @param {BillingMode} detected
 * @param {{ mode?: string }} [billingConfig]
 * @returns {BillingMode}
 */
export function resolveBillingMode(detected, billingConfig = {}) {
  const configured = billingConfig.mode
  if (configured === 'api' || configured === 'subscription') return configured
  return detected
}

/**
 * Which cost figure to lead with, and what to call it.
 *
 * Both numbers exist on every turn. This decides which one a screen should put
 * first, and the label that keeps it honest.
 *
 * @param {BillingMode} mode
 * @returns {{ field: 'actual' | 'equivalent', label: string, note: string }}
 */
export function costPresentation(mode) {
  if (mode === 'subscription') {
    return {
      field: 'equivalent',
      label: 'Equivalent API cost',
      note: 'Included in your plan — this is what it would have cost on the API.',
    }
  }
  if (mode === 'api') {
    return { field: 'actual', label: 'Cost', note: 'Billed to your API key.' }
  }
  return {
    field: 'equivalent',
    label: 'Equivalent API cost',
    // Saying "we are not sure" is better than picking one and being wrong.
    note: 'Billing method unknown. Set billing.mode in config.toml to be sure.',
  }
}
