/**
 * Turning database rows into API responses.
 *
 * SQLite columns are snake_case; the dashboard is JavaScript. Converting once
 * here means the frontend never has to know a column name, and renaming a
 * column later is a change in two files rather than twenty components.
 *
 * @module
 */

/**
 * @param {string} name
 * @returns {string}
 */
function camel(name) {
  return name.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase())
}

/**
 * @param {Record<string, unknown> | undefined | null} row
 * @returns {Record<string, unknown> | null}
 */
export function toCamel(row) {
  if (!row) return null
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, value] of Object.entries(row)) out[camel(key)] = value
  return out
}

/**
 * @param {Record<string, unknown>[]} rows
 * @returns {Record<string, unknown>[]}
 */
export function toCamelAll(rows) {
  return rows.map((row) => /** @type {Record<string, unknown>} */ (toCamel(row)))
}

/**
 * SQLite has no boolean type, so flags come back as 0 and 1.
 *
 * @param {Record<string, unknown> | null} row
 * @param {string[]} fields
 * @returns {Record<string, unknown> | null}
 */
export function withBooleans(row, fields) {
  if (!row) return null
  for (const field of fields) {
    if (field in row) row[field] = row[field] === 1 || row[field] === true
  }
  return row
}
