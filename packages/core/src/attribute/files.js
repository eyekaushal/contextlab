/**
 * Which file a tool call touched.
 *
 * Every agent names the argument differently. This is a lookup table rather
 * than a chain of special cases, so supporting a new tool is one more key.
 *
 * Pure.
 *
 * @module
 */

/**
 * Argument names that carry a path, most specific first.
 *
 * `path` sits last deliberately: Grep and Glob use it for a *search directory*,
 * not the file they returned, so a more specific key wins when both are present.
 */
const PATH_KEYS = [
  'file_path',
  'filePath',
  'absolute_path',
  'notebook_path',
  'notebookPath',
  'target_file',
  'targetFile',
  'filename',
  'file_name',
  'fileName',
  'file',
  'uri',
  'path',
]

/** A value only counts as a path if it looks like one. */
const PATH_SHAPE = /^(\/|~\/|\.{1,2}\/|[a-zA-Z]:[\\/])/

/**
 * @param {Record<string, unknown> | undefined} input
 * @returns {string | null}
 */
export function filePathFrom(input) {
  if (!input || typeof input !== 'object') return null

  for (const key of PATH_KEYS) {
    const value = /** @type {Record<string, unknown>} */ (input)[key]
    if (typeof value !== 'string' || value === '') continue
    if (!PATH_SHAPE.test(value)) continue
    return value
  }
  return null
}

/**
 * Shorten a path for display without losing which file it is.
 *
 * @param {string} path
 * @param {string} [projectPath] strip this prefix if present
 * @returns {string}
 */
export function shortenPath(path, projectPath) {
  if (projectPath && path.startsWith(projectPath)) {
    const relative = path.slice(projectPath.length).replace(/^\//, '')
    if (relative) return relative
  }
  return path
}
