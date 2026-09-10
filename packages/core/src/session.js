/**
 * Grouping independent API calls back into conversations.
 *
 * This is the hardest part of the whole product. Requests arrive one at a time
 * with no shared identifier in most formats, and two of the seven tools resend
 * the entire history every turn with nothing to distinguish one session from
 * the next. See notes/WIRE-FORMATS.md section 5.
 *
 * Three strategies, first hit wins:
 *
 *   1. an explicit session id, when the tool provides one
 *   2. response chaining, when the format threads previous_response_id
 *   3. a content fingerprint over the system prompt and first real user message
 *
 * Pure: the tracker holds state, but takes its clock as an argument and touches
 * nothing outside itself.
 *
 * @module
 */

/**
 * Two sessions that open with the same prompt in the same repo fingerprint
 * identically. If the same fingerprint reappears after this long, it is a new
 * conversation rather than a continuation.
 */
export const SESSION_TTL_MS = 5 * 60 * 1000

/**
 * A 64-bit FNV-1a, written out so `core` keeps no dependency and runs anywhere.
 *
 * Not cryptographic and does not need to be — it only has to keep two
 * different conversations apart on one developer's machine.
 *
 * @param {string} text
 * @returns {string} 16 hex characters
 */
export function fingerprint(text) {
  let high = 0x811c9dc5
  let low = 0x01000193
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    high ^= code
    high = Math.imul(high, 0x01000193) >>> 0
    low ^= code + i
    low = Math.imul(low, 0x85ebca6b) >>> 0
  }
  return (high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0')).slice(
    0,
    16,
  )
}

/** Where each tool states its session id. */
const EXPLICIT_ID_HEADERS = [
  'x-claude-code-session-id',
  'x-session-id',
  'x-conversation-id',
]

/**
 * Pull an explicit session id out of a request, if the tool gave us one.
 *
 * @param {Object} input
 * @param {Record<string, string | string[] | undefined>} [input.headers]
 * @param {Record<string, unknown>} [input.body]
 * @param {string | null} [input.sessionTag]  from our own proxy URL
 * @returns {string | null}
 */
export function explicitSessionId(input) {
  const headers = input.headers ?? {}
  for (const name of EXPLICIT_ID_HEADERS) {
    const value = headers[name]
    const flat = Array.isArray(value) ? value[0] : value
    if (typeof flat === 'string' && flat !== '') return flat
  }

  const body = input.body ?? {}

  // Anthropic carries it inside metadata.user_id, of all places.
  const metadata = body.metadata
  if (metadata && typeof metadata === 'object') {
    const userId = /** @type {Record<string, unknown>} */ (metadata).user_id
    if (typeof userId === 'string') {
      const match = userId.match(/session_([a-f0-9-]+)/i)
      if (match?.[1]) return match[1]
    }
  }

  // Gemini Code Assist, inside its request wrapper.
  const wrapped = body.request
  if (wrapped && typeof wrapped === 'object') {
    const id = /** @type {Record<string, unknown>} */ (wrapped).session_id
    if (typeof id === 'string' && id !== '') return id
  }
  const sessionId = body.session_id
  if (typeof sessionId === 'string' && sessionId !== '') return sessionId

  // Our own URL tag is the weakest of the explicit signals: it identifies a
  // CLI run, not a conversation, so two sessions started from one run share it.
  if (input.sessionTag) return `tag:${input.sessionTag}`

  return null
}

/**
 * Patterns that reveal the working directory, tried in order.
 *
 * Codex sessions in different repos share a system prompt and an agent config,
 * so without the directory every project's sessions collapse into one.
 */
const CWD_PATTERNS = [
  /[Pp]rimary working directory[:\s]+[`]?([/~][^\s`\n]+)/,
  /<cwd>([^<]+)<\/cwd>/,
  /working in the director(?:y|ies)[:\s]+([/~][^\s\n]+)/i,
  /working directory (?:is |= ?)[`"]?([/~][^\s`"'\n]+)/i,
  /\bcwd[:\s]+[`"]?([/~][^\s`"'\n]+)/,
]

/**
 * @param {string} text  system prompt and user messages, concatenated
 * @returns {string | null}
 */
export function workingDirectoryFrom(text) {
  for (const pattern of CWD_PATTERNS) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].replace(/[.,;:]$/, '')
  }
  return null
}

/**
 * The first user message that is actually the user talking.
 *
 * Agents open with boilerplate — an environment block, an injected AGENTS.md,
 * a directory listing. Fingerprinting on that makes every session in a repo
 * identical, which is exactly the collision we are trying to avoid.
 *
 * @param {import('./parse/shared.js').ParsedRequest} parsed
 * @returns {string}
 */
export function firstRealUserMessage(parsed) {
  for (const message of parsed.messages) {
    if (message.role !== 'user') continue
    for (const block of message.blocks) {
      if (block.type !== 'text') continue
      const text = (block.text ?? '').trim()
      if (text === '') continue
      if (text.startsWith('#') || text.startsWith('<environment')) continue
      if (text.startsWith('<system-reminder>')) continue
      return text
    }
  }
  return ''
}

/**
 * The content fingerprint: what identifies a conversation with no id.
 *
 * @param {import('./parse/shared.js').ParsedRequest} parsed
 * @param {{ tool?: string }} [options]
 * @returns {string}
 */
export function contentFingerprint(parsed, options = {}) {
  const system = parsed.system.map((segment) => segment.text).join('\n')
  const firstMessage = firstRealUserMessage(parsed)
  const cwd = workingDirectoryFrom(`${system}\n${firstMessage}`) ?? ''

  // The working directory is only load-bearing for tools with no session id,
  // but including it always is harmless and keeps one code path.
  return fingerprint(`${cwd}\0${system}\0${firstMessage}\0${options.tool ?? ''}`)
}

/**
 * @typedef {Object} SessionIdentity
 * @property {string} sessionId
 * @property {'explicit' | 'chained' | 'fingerprint' | 'fingerprint-ttl'} how
 * @property {string} [fingerprint]
 * @property {string | null} [workingDirectory]
 */

/**
 * Track conversations across a stream of captures.
 *
 * Holds two maps: response ids for chained formats, and fingerprints with the
 * time they were last seen, for everything else.
 *
 * @returns {{ identify: (input: any, now?: number) => SessionIdentity,
 *             size: () => number }}
 */
export function createSessionTracker() {
  /** @type {Map<string, string>} response id -> session id */
  const chains = new Map()
  /** @type {Map<string, { sessionId: string, lastSeen: number }>} */
  const seen = new Map()

  /**
   * @param {Object} input
   * @param {import('./parse/shared.js').ParsedRequest | null} input.parsed
   * @param {Record<string, string | string[] | undefined>} [input.headers]
   * @param {Record<string, unknown>} [input.body]
   * @param {Record<string, unknown>} [input.responseBody]
   * @param {string | null} [input.sessionTag]
   * @param {string} [input.tool]
   * @param {number} [now]
   * @returns {SessionIdentity}
   */
  function identify(input, now = Date.now()) {
    // Worked out regardless of how the session is identified. It is what
    // groups sessions by project, and skipping it on the explicit path — the
    // common one, since our own proxy always supplies a tag — would leave
    // `cost --by project` empty for every real session.
    const workingDirectory = input.parsed
      ? workingDirectoryFrom(
          `${input.parsed.system.map((segment) => segment.text).join('\n')}\n${firstRealUserMessage(input.parsed)}`,
        )
      : null

    const explicit = explicitSessionId(input)
    if (explicit) {
      rememberResponse(input, explicit)
      return { sessionId: explicit, how: 'explicit', workingDirectory }
    }

    // Chained formats thread each response into the next request.
    const previous = input.body?.previous_response_id
    if (typeof previous === 'string' && chains.has(previous)) {
      const sessionId = /** @type {string} */ (chains.get(previous))
      rememberResponse(input, sessionId)
      return { sessionId, how: 'chained', workingDirectory }
    }

    if (!input.parsed) {
      const fallback = fingerprint(`unparseable\0${now}`)
      return { sessionId: fallback, how: 'fingerprint' }
    }

    const print = contentFingerprint(input.parsed, { tool: input.tool })

    const previousSeen = seen.get(print)
    if (previousSeen && now - previousSeen.lastSeen <= SESSION_TTL_MS) {
      previousSeen.lastSeen = now
      rememberResponse(input, previousSeen.sessionId)
      return {
        sessionId: previousSeen.sessionId,
        how: 'fingerprint',
        fingerprint: print,
        workingDirectory,
      }
    }

    // Same opening, but long enough ago that this is a new conversation rather
    // than a continuation. Mint a fresh id so the two do not merge.
    const sessionId = previousSeen ? fingerprint(`${print}\0${now}`) : print
    seen.set(print, { sessionId, lastSeen: now })
    rememberResponse(input, sessionId)

    return {
      sessionId,
      how: previousSeen ? 'fingerprint-ttl' : 'fingerprint',
      fingerprint: print,
      workingDirectory,
    }
  }

  /**
   * @param {any} input
   * @param {string} sessionId
   * @returns {void}
   */
  function rememberResponse(input, sessionId) {
    const id = input.responseBody?.id ?? input.responseBody?.response?.id
    if (typeof id === 'string' && id !== '') chains.set(id, sessionId)
  }

  return { identify, size: () => seen.size + chains.size }
}
