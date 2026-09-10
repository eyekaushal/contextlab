/**
 * The session summary: everything the rules are allowed to look at.
 *
 * Rules are plain functions with no access to a database, a network or a
 * clock. They read this object and nothing else, which is what makes a
 * recommendation reproducible — the same session produces the same advice
 * forever, offline.
 *
 * Pure.
 *
 * @module
 */

/**
 * @typedef {Object} TurnInput
 * @property {import('../compose/index.js').Composition} composition
 * @property {number} [capturedAt]
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 * @property {number} [cacheReadTokens]
 * @property {number} [cacheWriteTokens]
 * @property {number} [thinkingTokens]
 * @property {number} [costUsd]
 */

/**
 * @typedef {Object} RepeatedBlock
 * @property {string} key
 * @property {string} category
 * @property {number} tokens        size of one copy
 * @property {number} turnsPresent  how many turns carried it
 * @property {number} tokensResent  tokens paid for beyond the first turn
 * @property {string} [toolName]
 * @property {string} [filePath]
 * @property {string} [preview]
 */

/**
 * @typedef {Object} RepeatedCall
 * @property {string} name
 * @property {string} signature   name plus arguments
 * @property {number} count
 * @property {number} tokens      calls and their results, together
 * @property {string} [filePath]
 * @property {string} [preview]
 */

/**
 * @typedef {Object} SessionSummary
 * @property {string} sessionId
 * @property {string} tool
 * @property {string} model
 * @property {string} provider
 * @property {string} billingMode
 * @property {number} turnCount
 * @property {number | null} contextLimit
 * @property {number} inputPricePerMillion
 * @property {number} peakContextTokens
 * @property {number} firstContextTokens
 * @property {number} lastContextTokens
 * @property {number} totalCostUsd
 * @property {Record<string, number>} categories  summed across turns
 * @property {{ inputTokens: number, outputTokens: number, cacheReadTokens: number,
 *             cacheWriteTokens: number, thinkingTokens: number }} usage
 * @property {import('../attribute/index.js').AttributionResult} attribution
 * @property {RepeatedBlock[]} repeatedBlocks
 * @property {RepeatedCall[]} repeatedCalls
 * @property {{ seq: number, contextTokens: number }[]} turns
 * @property {number} imageTokensPerTurn
 * @property {number} turnsWithImages
 */

/**
 * A small, stable, non-cryptographic hash.
 *
 * Written out rather than imported so `core` keeps no dependency and stays
 * runnable anywhere. It only has to be deterministic and collision-resistant
 * enough to tell two tool results apart.
 *
 * @param {string} text
 * @returns {string}
 */
export function hashText(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Build the summary from a session's turns.
 *
 * @param {TurnInput[]} turns
 * @param {{ sessionId?: string, tool?: string, model?: string, provider?: string,
 *           billingMode?: string, contextLimit?: number | null,
 *           inputPricePerMillion?: number,
 *           attribution?: import('../attribute/index.js').AttributionResult }} [options]
 * @returns {SessionSummary}
 */
export function summarizeSession(turns, options = {}) {
  const rate = options.inputPricePerMillion ?? 0

  /** @type {Record<string, number>} */
  const categories = {}
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    thinkingTokens: 0,
  }

  /** @type {Map<string, RepeatedBlock & { turnsSeen: Set<number> }>} */
  const blocks = new Map()
  /** @type {Map<string, RepeatedCall>} */
  const calls = new Map()

  /** @type {{ seq: number, contextTokens: number }[]} */
  const turnRows = []
  let totalCostUsd = 0
  let imageTokens = 0
  let turnsWithImages = 0

  turns.forEach((turn, seq) => {
    const { composition } = turn
    turnRows.push({ seq, contextTokens: composition.totalTokens })
    totalCostUsd += turn.costUsd ?? 0

    usage.inputTokens += turn.inputTokens ?? 0
    usage.outputTokens += turn.outputTokens ?? 0
    usage.cacheReadTokens += turn.cacheReadTokens ?? 0
    usage.cacheWriteTokens += turn.cacheWriteTokens ?? 0
    usage.thinkingTokens += turn.thinkingTokens ?? 0

    for (const [category, tokens] of Object.entries(composition.categories)) {
      categories[category] = (categories[category] ?? 0) + tokens
    }

    let turnImageTokens = 0
    /** @type {Map<string, { name: string, filePath: string | null }>} */
    const callsThisTurn = new Map()

    for (const message of composition.messages) {
      for (const block of message.blocks) {
        if (block.type === 'image') turnImageTokens += block.tokens

        if (block.type === 'tool_use') {
          const name = block.name || 'unknown tool'
          const filePath = pathOf(block.input)
          if (block.id) callsThisTurn.set(block.id, { name, filePath })

          // A call is "the same call" when its arguments match, which is what
          // makes a retry loop visible.
          const signature = `${name}(${stableStringify(block.input)})`
          const key = hashText(signature)
          const existing = calls.get(key)
          if (existing) {
            existing.count += 1
            existing.tokens += block.tokens
          } else {
            calls.set(key, {
              name,
              signature,
              count: 1,
              tokens: block.tokens,
              ...(filePath ? { filePath } : {}),
            })
          }
        }

        const identity = blockIdentity(block)
        if (identity === null) continue

        const call = block.toolUseId ? callsThisTurn.get(block.toolUseId) : undefined
        const existing = blocks.get(identity)
        if (existing) {
          existing.turnsSeen.add(seq)
          continue
        }
        blocks.set(identity, {
          key: identity,
          category: block.category,
          tokens: block.tokens,
          turnsPresent: 0,
          tokensResent: 0,
          turnsSeen: new Set([seq]),
          ...(call?.name ? { toolName: call.name } : {}),
          ...(call?.filePath ? { filePath: call.filePath } : {}),
          ...(previewOf(block) ? { preview: previewOf(block) } : {}),
        })
      }
    }

    if (turnImageTokens > 0) {
      turnsWithImages += 1
      imageTokens = Math.max(imageTokens, turnImageTokens)
    }
  })

  /** @type {RepeatedBlock[]} */
  const repeatedBlocks = []
  for (const block of blocks.values()) {
    const { turnsSeen, ...rest } = block
    const turnsPresent = turnsSeen.size
    repeatedBlocks.push({
      ...rest,
      turnsPresent,
      // The first send is work you asked for. Every send after it is the price
      // of leaving it in the history.
      tokensResent: rest.tokens * Math.max(0, turnsPresent - 1),
    })
  }
  repeatedBlocks.sort((a, b) => b.tokensResent - a.tokensResent)

  const repeatedCalls = [...calls.values()].sort((a, b) => b.count - a.count)
  const contexts = turnRows.map((row) => row.contextTokens)

  return {
    sessionId: options.sessionId ?? '',
    tool: options.tool ?? '',
    model: options.model ?? turns[0]?.composition.model ?? 'unknown',
    provider: options.provider ?? '',
    billingMode: options.billingMode ?? 'unknown',
    turnCount: turns.length,
    contextLimit: options.contextLimit ?? null,
    inputPricePerMillion: rate,
    peakContextTokens: contexts.length > 0 ? Math.max(...contexts) : 0,
    firstContextTokens: contexts[0] ?? 0,
    lastContextTokens: contexts[contexts.length - 1] ?? 0,
    totalCostUsd,
    categories,
    usage,
    attribution: options.attribution ?? {
      entries: [],
      totalTokens: 0,
      attributedTokens: 0,
    },
    repeatedBlocks,
    repeatedCalls,
    turns: turnRows,
    imageTokensPerTurn: imageTokens,
    turnsWithImages,
  }
}

/**
 * What makes two blocks in different turns "the same block".
 *
 * Only content that gets re-sent is worth tracking, so calls and results are
 * identified by their text and everything else is ignored.
 *
 * @param {import('../compose/index.js').ComposedBlock} block
 * @returns {string | null}
 */
function blockIdentity(block) {
  if (block.type === 'tool_result') {
    return `result:${hashText(block.content ?? '')}`
  }
  if (block.type === 'image') return null
  if (block.type === 'text' || block.type === 'thinking') {
    const text = block.text ?? ''
    return text.length > 0 ? `${block.type}:${hashText(text)}` : null
  }
  return null
}

/**
 * @param {import('../compose/index.js').ComposedBlock} block
 * @returns {string}
 */
function previewOf(block) {
  const text = block.content ?? block.text ?? ''
  return text.slice(0, 200)
}

/**
 * @param {Record<string, unknown> | undefined} input
 * @returns {string | null}
 */
function pathOf(input) {
  if (!input) return null
  for (const key of ['file_path', 'filePath', 'absolute_path', 'path']) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

/**
 * Stringify with sorted keys, so two identical calls hash identically
 * regardless of the order the provider happened to serialise them in.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(/** @type {Record<string, unknown>} */ (value)).sort(
    ([a], [b]) => a.localeCompare(b),
  )
  return `{${entries.map(([key, item]) => `${key}:${stableStringify(item)}`).join(',')}}`
}
