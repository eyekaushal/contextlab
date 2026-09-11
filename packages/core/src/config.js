/**
 * User settings, from `~/.contextlab/config.toml`.
 *
 * Includes a TOML parser covering the subset a config file actually uses:
 * sections, key/value pairs, strings, numbers, booleans and flat arrays.
 * Anything outside that subset raises an error naming the line — a config
 * parser that silently misreads a budget is worse than one that refuses it.
 *
 * Written out rather than taken as a dependency because `core` is the pure test
 * surface and this is forty lines of string handling. If the config grows
 * inline tables or multi-line strings, take the dependency instead of extending
 * this.
 *
 * Pure: parsing only. Reading the file is the CLI's job.
 *
 * @module
 */

/**
 * @typedef {Object} Budget
 * @property {number} [daily]     USD per calendar day
 * @property {number} [monthly]   USD per calendar month
 * @property {number} [session]   USD for any single session
 * @property {number} [warnAt]    fraction of the limit that triggers a warning
 */

/**
 * @typedef {Object} Config
 * @property {Budget} budget
 * @property {{ mode: 'api' | 'subscription' | 'auto' }} billing
 * @property {Record<string, unknown>} [raw]
 */

/** What you get with no config file at all. */
export const DEFAULT_CONFIG = {
  budget: { warnAt: 0.8 },
  billing: { mode: /** @type {'auto'} */ ('auto') },
}

/**
 * Parse the subset of TOML a config file needs.
 *
 * @param {string} text
 * @returns {Record<string, any>}
 */
export function parseToml(text) {
  /** @type {Record<string, any>} */
  const root = {}
  let section = root

  const lines = String(text ?? '').split(/\r?\n/)

  lines.forEach((raw, index) => {
    const line = stripComment(raw).trim()
    if (line === '') return

    const heading = line.match(/^\[([^\]]+)\]$/)
    if (heading) {
      section = root
      for (const part of (heading[1] ?? '').split('.')) {
        const key = part.trim()
        if (!key) throw new Error(`config.toml line ${index + 1}: empty section name`)
        if (!section[key]) section[key] = {}
        section = section[key]
      }
      return
    }

    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (!pair) {
      throw new Error(`config.toml line ${index + 1}: cannot read "${raw.trim()}"`)
    }
    section[String(pair[1])] = parseValue(String(pair[2]), index + 1)
  })

  return root
}

/**
 * @param {string} line
 * @returns {string}
 */
function stripComment(line) {
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"' || char === "'") quoted = !quoted
    // A # inside a quoted string is content, not a comment.
    if (char === '#' && !quoted) return line.slice(0, i)
  }
  return line
}

/**
 * @param {string} text
 * @param {number} line
 * @returns {unknown}
 */
function parseValue(text, line) {
  const value = text.trim()

  if (value === 'true') return true
  if (value === 'false') return false

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (inner === '') return []
    return splitTop(inner).map((item) => parseValue(item, line))
  }

  // TOML allows underscores as digit separators.
  const numeric = Number(value.replaceAll('_', ''))
  if (value !== '' && Number.isFinite(numeric)) return numeric

  throw new Error(`config.toml line ${line}: cannot read value "${text.trim()}"`)
}

/**
 * Split a flat array's items, ignoring commas inside quotes.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitTop(text) {
  const items = []
  let depth = 0
  let quoted = false
  let current = ''

  for (const char of text) {
    if (char === '"' || char === "'") quoted = !quoted
    if (!quoted && (char === '[' || char === '{')) depth += 1
    if (!quoted && (char === ']' || char === '}')) depth -= 1
    if (char === ',' && depth === 0 && !quoted) {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') items.push(current)
  return items
}

/**
 * Turn parsed TOML into a config, filling in defaults.
 *
 * Unknown keys are kept in `raw` rather than dropped, so a setting from a newer
 * version does not silently vanish when an older binary rewrites the file.
 *
 * @param {Record<string, any>} parsed
 * @returns {Config}
 */
export function toConfig(parsed = {}) {
  const budget = parsed.budget ?? {}
  const billing = parsed.billing ?? {}
  const mode = ['api', 'subscription', 'auto'].includes(billing.mode)
    ? billing.mode
    : 'auto'

  return {
    budget: {
      ...(typeof budget.daily === 'number' ? { daily: budget.daily } : {}),
      ...(typeof budget.monthly === 'number' ? { monthly: budget.monthly } : {}),
      ...(typeof budget.session === 'number' ? { session: budget.session } : {}),
      warnAt:
        typeof budget.warn_at === 'number'
          ? clampFraction(budget.warn_at)
          : typeof budget.warnAt === 'number'
            ? clampFraction(budget.warnAt)
            : 0.8,
    },
    billing: { mode },
    raw: parsed,
  }
}

/**
 * @param {string} text
 * @returns {Config}
 */
export function loadConfig(text) {
  if (!text || text.trim() === '') return { ...DEFAULT_CONFIG, raw: {} }
  return toConfig(parseToml(text))
}

/**
 * @param {number} value
 * @returns {number}
 */
function clampFraction(value) {
  if (!Number.isFinite(value)) return 0.8
  // Accept either 0.8 or 80, because both readings of "warn at 80%" are natural.
  const fraction = value > 1 ? value / 100 : value
  return Math.min(1, Math.max(0, fraction))
}

/** An example file, written on first run so the settings are discoverable. */
export const EXAMPLE_CONFIG = `# contextlab settings
# Everything here is optional.

[budget]
# Warn, then flag, as spend approaches these. Figures are USD of equivalent
# API cost, so they mean the same thing on a subscription as on an API key.
daily = 5.00
monthly = 100.00
session = 2.00

# Warn at this fraction of a limit. 0.8 and 80 both mean 80%.
warn_at = 0.8

[billing]
# api | subscription | auto
#
# auto reads it from the request: an x-api-key header is a metered API key,
# an OAuth bearer token is a subscription that costs nothing extra per turn.
mode = "auto"
`
