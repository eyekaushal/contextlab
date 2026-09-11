/**
 * Formatting numbers for reading.
 *
 * Shared with the CLI in spirit but not in code: the terminal needs padding and
 * ANSI, the browser needs neither. Keeping them separate is cheaper than an
 * abstraction over two very different output devices.
 *
 * @module
 */

/**
 * @param {number | null | undefined} value
 * @returns {string}
 */
export function tokens(value) {
  const n = Math.round(Number(value) || 0)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 100_000) return `${Math.round(n / 1000)}K`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString('en-US')
}

/**
 * @param {number | null | undefined} value
 * @returns {string}
 */
export function exact(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US')
}

/**
 * Money below a cent still matters when you are ranking waste, so it keeps its
 * digits rather than rounding to $0.00 and looking free.
 *
 * @param {number | null | undefined} value
 * @returns {string}
 */
export function usd(value) {
  const amount = Number(value) || 0
  if (amount === 0) return '$0.00'
  if (Math.abs(amount) < 0.01) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

/**
 * @param {number} value  0 to 1
 * @param {number} [digits]
 * @returns {string}
 */
export function percent(value, digits = 0) {
  return `${((Number(value) || 0) * 100).toFixed(digits)}%`
}

/**
 * @param {number | null | undefined} epochMs
 * @returns {string}
 */
export function when(epochMs) {
  const at = Number(epochMs)
  if (!at) return '—'
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(at).toISOString().slice(0, 10)
}

/**
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
export function truncate(text, width) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`
}

/**
 * A category's colour, by name.
 *
 * Resolved from the CSS custom properties defined in styles.css rather than
 * duplicated here, so there is exactly one place a palette value lives.
 *
 * @param {string} category
 * @returns {string}
 */
export function categoryColor(category) {
  return `var(--cat-${category}, var(--color-cat-other))`
}

/**
 * Human labels for the eleven categories.
 *
 * @type {Record<string, string>}
 */
export const CATEGORY_LABEL = {
  system_prompt: 'System prompt',
  tool_definitions: 'Tool definitions',
  tool_calls: 'Tool calls',
  tool_results: 'Tool results',
  user_text: 'User text',
  assistant_text: 'Assistant text',
  thinking: 'Thinking',
  system_injections: 'System injections',
  images: 'Images',
  cache_markers: 'Cache markers',
  other: 'Other',
}

/**
 * @param {string} category
 * @returns {string}
 */
export function categoryLabel(category) {
  return CATEGORY_LABEL[category] ?? category
}
