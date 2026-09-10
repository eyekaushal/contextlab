/**
 * The eleven composition categories.
 *
 * These are fixed. WIRE-FORMATS.md section 7 is explicit: keep the eleven,
 * extend for RAG in v2 with `retrieved_chunks`, do not redesign. Every chart,
 * every rule and the stored `composition` table are keyed on these strings.
 *
 * @module
 */

/** @typedef {typeof CATEGORIES[number]} Category */

export const CATEGORIES = /** @type {const} */ ([
  'system_prompt',
  'tool_definitions',
  'tool_calls',
  'tool_results',
  'user_text',
  'assistant_text',
  'thinking',
  'system_injections',
  'images',
  'cache_markers',
  'other',
])

/**
 * Which categories a user can actually do something about. This is the column
 * that makes the product useful rather than merely informative — a finding
 * against an uncontrollable category is noise.
 *
 * @type {Record<string, 'yes' | 'partly' | 'indirect' | 'no'>}
 */
export const CONTROLLABLE = {
  system_prompt: 'partly',
  tool_definitions: 'yes',
  tool_calls: 'indirect',
  tool_results: 'yes',
  user_text: 'yes',
  assistant_text: 'no',
  thinking: 'yes',
  system_injections: 'partly',
  images: 'yes',
  cache_markers: 'no',
  other: 'no',
}

/**
 * A zeroed tally of all eleven, so charts and stored rows keep a stable shape
 * whether or not a session happens to contain a given category.
 *
 * @returns {Record<string, number>}
 */
export function emptyTally() {
  /** @type {Record<string, number>} */
  const tally = {}
  for (const category of CATEGORIES) tally[category] = 0
  return tally
}
