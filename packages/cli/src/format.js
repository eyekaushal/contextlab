/**
 * Terminal formatting.
 *
 * Written out rather than pulled from a colour library: it is forty lines, and
 * the CLI already carries Ink and commander. Respects NO_COLOR and detects a
 * pipe, so `contextlab cost | grep` gives clean text.
 *
 * @module
 */

const enabled =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  process.stdout.isTTY === true

/**
 * @param {string} code
 * @returns {(text: string) => string}
 */
function style(code) {
  return (text) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : text)
}

/**
 * Matches an ANSI colour sequence.
 *
 * Built with `String.fromCharCode` rather than written as a regex literal: a
 * literal escape character inside a pattern is invisible in most editors, and
 * every linter flags it. Stripping these is what lets `pad` count the
 * characters a reader actually sees.
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, 'g')

export const color = {
  bold: style('1'),
  dim: style('2'),
  red: style('31'),
  green: style('32'),
  yellow: style('33'),
  blue: style('34'),
  magenta: style('35'),
  cyan: style('36'),
  gray: style('90'),
}

/**
 * @param {number} value
 * @returns {string}
 */
export function tokens(value) {
  const n = Math.round(value)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}K`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

/**
 * @param {number} value
 * @returns {string}
 */
export function usd(value) {
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

/**
 * @param {number} value  0 to 1
 * @returns {string}
 */
export function percent(value) {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * A horizontal bar, for composition breakdowns.
 *
 * @param {number} share  0 to 1
 * @param {number} width
 * @returns {string}
 */
export function bar(share, width = 24) {
  const filled = Math.max(0, Math.min(width, Math.round(share * width)))
  return '█'.repeat(filled) + color.gray('░'.repeat(width - filled))
}

/**
 * @param {number} epochMs
 * @returns {string}
 */
export function when(epochMs) {
  if (!epochMs) return 'unknown'
  const delta = Date.now() - epochMs
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(epochMs).toISOString().slice(0, 10)
}

/**
 * Pad for column alignment, ignoring the invisible bytes in colour codes.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
export function pad(text, width) {
  const visible = text.replace(ANSI, '').length
  return text + ' '.repeat(Math.max(0, width - visible))
}

/**
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
export function truncate(text, width) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`
}

/**
 * @param {string} title
 * @returns {string}
 */
export function heading(title) {
  return `\n${color.bold(title)}\n`
}
