/**
 * One category per content block.
 *
 * The rules in WIRE-FORMATS.md section 7 are written against the raw wire
 * shapes — `function_call`, `output_text`, `part.functionResponse`. By the time
 * a block reaches here, `parse/` has already mapped all of those onto the
 * normalized types, so this file only deals with the normalized form. The
 * per-format mapping lives in the parsers, where the format is known.
 *
 * Pure.
 *
 * @module
 */

/** Claude Code and friends inject these mid-conversation. */
const SYSTEM_REMINDER = '<system-reminder>'

/**
 * @param {import('../parse/shared.js').Block} block
 * @param {string} [role] the role of the message the block belongs to
 * @returns {string} one of CATEGORIES
 */
export function classifyBlock(block, role = '') {
  switch (block.type) {
    case 'tool_use':
      return 'tool_calls'
    case 'tool_result':
      return 'tool_results'
    case 'thinking':
      return 'thinking'
    case 'image':
      return 'images'
    case 'text':
      return classifyText(block.text ?? '', role)
    default:
      return 'other'
  }
}

/**
 * Text is the ambiguous one: the same block type is the user's question, the
 * model's answer, or something the harness injected without either of them
 * asking. Blaming an injected reminder on the user makes the composition chart
 * point at the wrong thing to fix.
 *
 * @param {string} text
 * @param {string} role
 * @returns {string}
 */
function classifyText(text, role) {
  if (text.includes(SYSTEM_REMINDER)) return 'system_injections'
  if (role === 'system' || role === 'developer') return 'system_prompt'
  if (role === 'tool' || role === 'function') return 'tool_results'
  if (role === 'assistant' || role === 'model') return 'assistant_text'
  return 'user_text'
}

/**
 * A message can hold blocks of several categories at once — an assistant turn
 * that reasons, says something, and then calls two tools is four blocks across
 * three categories.
 *
 * @param {import('../parse/shared.js').Message} message
 * @returns {string[]} one category per block, in order
 */
export function classifyMessage(message) {
  return message.blocks.map((block) => classifyBlock(block, message.role))
}
