/**
 * The ten rules.
 *
 * A rule is a plain function: it reads a SessionSummary, does arithmetic, and
 * returns findings. No LLM, no heuristic scoring, no randomness — a comparison
 * and a template string. The same session produces the same advice twice, which
 * is the only way a measurement tool earns trust.
 *
 * Every finding must answer three questions, or it is noise:
 *   what is wrong · what did it cost · what exactly do I change
 *
 * The last one is the hard part and the reason this file exists. "Your context
 * is large" is not a finding. "Remove playwright from .mcp.json, it costs 4,686
 * tokens a turn and you have never called it" is.
 *
 * Pure. See notes/WIRE-FORMATS.md section 11.
 *
 * @module
 */

const MILLION = 1_000_000

/**
 * @typedef {Object} Finding
 * @property {string} rule
 * @property {'critical' | 'warning' | 'info'} severity
 * @property {string} title
 * @property {string} detail
 * @property {string} fix
 * @property {number} wastedTokens
 * @property {number} wastedCostUsd
 * @property {'recoverable' | 'potential'} claim
 * @property {string} claimKey   what these tokens are, so two rules cannot
 *                               claim the same ones twice
 * @property {boolean} [countsTowardTotal] set by reconciliation; false when
 *                               another finding already claimed these tokens
 * @property {string} [supersededBy] the rule that took the claim
 * @property {Record<string, unknown>} [evidence]
 */

/**
 * What a finding is claiming.
 *
 * **recoverable** — tokens you were actually billed for that this specific
 * change would have removed. These are money already spent, so their sum can
 * never exceed what the session cost.
 *
 * **potential** — what a different choice would have saved: a working cache, a
 * cheaper model, a smaller thinking budget. Real, worth knowing, and *not money
 * you lost*. Adding it to recoverable is what produced "$10.31 recoverable from
 * a $6.08 session".
 *
 * The two are reported as separate figures and never summed together.
 */
export const CLAIM_RECOVERABLE = 'recoverable'
export const CLAIM_POTENTIAL = 'potential'

/** @typedef {import('./summary.js').SessionSummary} SessionSummary */

/**
 * Token counts are always whole numbers. Several rules derive waste from a
 * ratio, so each rounds before reporting — "896,578.2 tokens" reads as a bug
 * even when the arithmetic behind it is right.
 *
 * @param {number} tokens
 * @param {SessionSummary} session
 * @returns {number}
 */
function costOf(tokens, session) {
  return (tokens / MILLION) * session.inputPricePerMillion
}

/**
 * @param {number} value
 * @returns {string}
 */
function n(value) {
  return Math.round(value).toLocaleString('en-US')
}

/**
 * @param {number} value
 * @returns {string}
 */
function usd(value) {
  if (value >= 0.01) return `$${value.toFixed(2)}`
  return `$${value.toFixed(4)}`
}

// ---------------------------------------------------------------------------
// 1. An MCP server whose schemas ride along every turn and never get used.
// ---------------------------------------------------------------------------

export const UNUSED_MCP_TOKENS_PER_TURN = 2000

/**
 * @param {SessionSummary} session
 * @returns {Finding[]}
 */
export function unusedMcpServer(session) {
  /** @type {Finding[]} */
  const findings = []
  if (session.turnCount === 0) return findings

  for (const entry of session.attribution.entries) {
    if (entry.entityType !== 'mcp_server') continue
    if (entry.calls > 0) continue

    const perTurn = entry.definitionTokens / session.turnCount
    if (perTurn < UNUSED_MCP_TOKENS_PER_TURN) continue

    // Every token of it is waste: it was defined, re-sent every turn, and
    // never called once.
    const wasted = entry.definitionTokens
    findings.push({
      rule: 'unused-mcp-server',
      severity: 'critical',
      title: `MCP server "${entry.entityName}" was never used`,
      detail:
        `Its tool definitions add ${n(perTurn)} tokens to every turn and were ` +
        `re-sent ${session.turnCount} times without a single call.`,
      fix:
        `Remove "${entry.entityName}" from .mcp.json, or start the agent with ` +
        `it disabled:\n\n  "mcpServers": {\n    "${entry.entityName}": { ... }  ` +
        `<- delete this\n  }`,
      claim: CLAIM_RECOVERABLE,
      claimKey: `mcp:${entry.entityName}`,
      wastedTokens: wasted,
      wastedCostUsd: costOf(wasted, session),
      evidence: { server: entry.entityName, perTurn, turns: session.turnCount },
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// 2. One enormous tool result, stuck in the history, paid for every turn since.
// ---------------------------------------------------------------------------

export const OVERSIZED_RESULT_TOKENS = 8000

/**
 * @param {SessionSummary} session
 * @returns {Finding[]}
 */
export function stuckOversizedResult(session) {
  /** @type {Finding[]} */
  const findings = []

  for (const block of session.repeatedBlocks) {
    if (block.category !== 'tool_results') continue
    if (block.tokens < OVERSIZED_RESULT_TOKENS) continue
    if (block.turnsPresent < 2) continue

    const source = block.toolName ? `${block.toolName}` : 'a tool call'
    findings.push({
      rule: 'stuck-oversized-result',
      severity: 'critical',
      title: `A ${n(block.tokens)}-token result from ${source} has been re-sent ${block.turnsPresent} times`,
      detail:
        `It entered the context once and has been uploaded again on every turn ` +
        `since, costing ${n(block.tokensResent)} tokens beyond the first send.` +
        (block.preview
          ? `\n\n  ${block.preview.slice(0, 120).replace(/\n/g, ' ')}...`
          : ''),
      fix:
        'Start a fresh session, or clear the history, once you have taken what ' +
        'you need from this output. If it came from a command, redirect it to a ' +
        'file and read the part you need:\n\n  npm install > /tmp/install.log 2>&1\n' +
        '  tail -50 /tmp/install.log',
      claim: CLAIM_RECOVERABLE,
      claimKey: block.filePath ? `file:${block.filePath}` : `block:${block.key}`,
      wastedTokens: block.tokensResent,
      wastedCostUsd: costOf(block.tokensResent, session),
      evidence: { tokens: block.tokens, turns: block.turnsPresent, tool: block.toolName },
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// 3. A memory file that has grown into a tax on every turn.
// ---------------------------------------------------------------------------

export const BLOATED_MEMORY_TOKENS = 2000

/**
 * @param {SessionSummary} session
 * @returns {Finding[]}
 */
export function bloatedMemoryFile(session) {
  /** @type {Finding[]} */
  const findings = []
  if (session.turnCount === 0) return findings

  for (const entry of session.attribution.entries) {
    if (entry.entityType !== 'prompt_segment') continue
    if (!/\.(md|markdown)$/i.test(entry.entityName)) continue

    const perTurn = entry.tokens / session.turnCount
    if (perTurn < BLOATED_MEMORY_TOKENS) continue

    // Claim only the excess: the file is useful, it is the size that is not.
    const excess = Math.round((perTurn - BLOATED_MEMORY_TOKENS) * session.turnCount)
    findings.push({
      rule: 'bloated-memory-file',
      severity: 'warning',
      title: `${entry.entityName} is ${n(perTurn)} tokens on every turn`,
      detail:
        `It is prepended to all ${session.turnCount} turns in this session. ` +
        `Trimming it to around ${n(BLOATED_MEMORY_TOKENS)} tokens would save ` +
        `${n(excess)} tokens over a session this length.`,
      fix:
        `Trim ${entry.entityName}. Move reference material an agent can look up ` +
        'on demand — long examples, changelogs, API dumps — into files it can ' +
        'read when needed, and keep only the instructions it must always follow.',
      claim: CLAIM_RECOVERABLE,
      claimKey: `segment:${entry.entityName}`,
      wastedTokens: excess,
      wastedCostUsd: costOf(excess, session),
      evidence: { file: entry.entityName, perTurn, turns: session.turnCount },
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// 4. Reading the same file twice, when it was already in the window.
// ---------------------------------------------------------------------------

/**
 * @param {SessionSummary} session
 * @returns {Finding[]}
 */
export function redundantReads(session) {
  /** @type {Finding[]} */
  const findings = []

  for (const entry of session.attribution.entries) {
    if (entry.entityType !== 'file') continue
    if (entry.calls < 2) continue
    if (entry.resultTokens <= 0) continue

    // One read was necessary. The rest re-fetched what was already there.
    const perRead = entry.resultTokens / entry.calls
    const wasted = Math.round(perRead * (entry.calls - 1))
    if (wasted < 500) continue

    findings.push({
      rule: 'redundant-read',
      severity: 'warning',
      title: `${entry.entityName} was read ${entry.calls} times`,
      detail:
        `Each read added about ${n(perRead)} tokens, and the file was already ` +
        'in the context window after the first one.',
      fix:
        'Ask the agent to work from what it has already read rather than ' +
        're-reading. If the file changed in between, the repeat is legitimate.',
      claim: CLAIM_RECOVERABLE,
      claimKey: `file:${entry.entityName}`,
      wastedTokens: wasted,
      wastedCostUsd: costOf(wasted, session),
      evidence: { file: entry.entityName, reads: entry.calls },
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// 5. Running out of room, with the trend pointing the wrong way.
// ---------------------------------------------------------------------------

export const CONTEXT_FULL_SHARE = 0.8

/**
 * @param {SessionSummary} session
 * @returns {Finding[]}
 */
export function approachingContextLimit(session) {
  const limit = session.contextLimit
  if (!limit || session.turnCount < 2) return []

  const share = session.lastContextTokens / limit
  if (share < CONTEXT_FULL_SHARE) return []
  if (session.lastContextTokens <= session.firstContextTokens) return []

  const headroom = limit - session.lastContextTokens
  return [
    {
      rule: 'approaching-context-limit',
      // A warning, not waste: nothing has been spent badly yet.
      severity: 'warning',
      title: `Context is ${Math.round(share * 100)}% full and still growing`,
      detail:
        `The last turn used ${n(session.lastContextTokens)} of ${n(limit)} tokens, ` +
        `up from ${n(session.firstContextTokens)} at the start. About ` +
        `${n(headroom)} tokens of headroom remain.`,
      fix:
        'Clear the large tool results you no longer need, or start a fresh ' +
        'session for the next piece of work. Hitting the limit mid-task forces ' +
        'the agent to compact, which loses detail you may still need.',
      claim: CLAIM_RECOVERABLE,
      claimKey: 'context-limit',
      wastedTokens: 0,
      wastedCostUsd: 0,
      evidence: { used: session.lastContextTokens, limit, share },
    },
  ]
}

// ---------------------------------------------------------------------------
// 6. A premium model doing work a cheap one would have done identically.
// ---------------------------------------------------------------------------

export const PREMIUM_INPUT_PRICE = 3
export const CHEAP_WORK_TOOLS = new Set([
  'read',
  'grep',
  'glob',
  'ls',
  'list',
  'search',
  'find',
  'cat',
  'view',
  'read_file',
  'list_directory',
  'search_file_content',
])

/**
 * @param {SessionSummary} session
 * @param {{ alternative?: { model: string, inputPricePerMillion: number } }} [options]
 * @returns {Finding[]}
 */
export function modelTooExpensiveForWork(session, options = {}) {
  const alternative = options.alternative
  if (!alternative) return []
  if (session.inputPricePerMillion < PREMIUM_INPUT_PRICE) return []
  if (session.turnCount < 5) return []
  if (alternative.inputPricePerMillion >= session.inputPricePerMillion) return []

  const tools = session.attribution.entries.filter(
    (entry) => entry.entityType === 'tool' && entry.calls > 0,
  )
  if (tools.length === 0) return []

  const allCheap = tools.every((entry) =>
    CHEAP_WORK_TOOLS.has(entry.entityName.toLowerCase()),
  )
  if (!allCheap) return []

  const ratio = alternative.inputPricePerMillion / session.inputPricePerMillion
  const saving = session.totalCostUsd * (1 - ratio)

  return [
    {
      rule: 'model-too-expensive',
      severity: 'info',
      title: `${session.turnCount} turns of reading and searching on ${session.model}`,
      detail:
        `Every tool call in this session was a read or a search. That work does ` +
        `not need a premium model. At ${alternative.model} rates the same session ` +
        `would have cost about ${usd(session.totalCostUsd * ratio)} instead of ` +
        `${usd(session.totalCostUsd)}.`,
      fix: `Use ${alternative.model} for exploration, and switch back for the edits.`,
      claim: CLAIM_POTENTIAL,
      claimKey: 'model',
      wastedTokens: 0,
      wastedCostUsd: Math.max(0, saving),
      evidence: { model: session.model, alternative: alternative.model, ratio },
    },
  ]
}

// ---------------------------------------------------------------------------
// 7. Paying full price for a prefix that should have been cached.
// ---------------------------------------------------------------------------

export const CACHE_HIT_FLOOR = 0.05
export const CACHE_READ_DISCOUNT = 0.9

/**
 * @param {SessionSummary} session
 * @returns {Finding[]}
 */
export function cacheNotWorking(session) {
  if (session.turnCount < 3) return []

  const billed = session.usage.inputTokens + session.usage.cacheReadTokens
  if (billed < 10_000) return []

  const hitRate = session.usage.cacheReadTokens / billed
  if (hitRate >= CACHE_HIT_FLOOR) return []

  // Turns after the first re-send a prefix that a working cache would have
  // charged at a tenth of the price.
  const resent = session.turns.slice(1).reduce((sum, turn) => sum + turn.contextTokens, 0)
  const wasted = Math.round(resent * CACHE_READ_DISCOUNT)

  return [
    {
      rule: 'cache-not-working',
      severity: 'critical',
      title: `Prompt caching is not working — ${Math.round(hitRate * 100)}% hit rate`,
      detail:
        `Across ${session.turnCount} turns, only ${n(session.usage.cacheReadTokens)} ` +
        `of ${n(billed)} input tokens were served from cache. Cached tokens cost ` +
        'about a tenth of fresh ones, so this is close to a tenfold overcharge on ' +
        'the repeated part of every turn.',
      fix:
        'Something near the start of the prompt is changing on every turn — a ' +
        'timestamp, a session id, a shuffled tool list. Caching matches on an ' +
        'exact prefix, so anything that varies at the head invalidates everything ' +
        'after it. Look at what sits before your first stable instruction.',
      claim: CLAIM_POTENTIAL,
      claimKey: 'cache',
      wastedTokens: wasted,
      wastedCostUsd: costOf(wasted, session),
      evidence: { hitRate, cacheReadTokens: session.usage.cacheReadTokens, billed },
    },
  ]
}

// ---------------------------------------------------------------------------
// 8. The same failing call, over and over.
// ---------------------------------------------------------------------------

export const ERROR_LOOP_REPEATS = 3

/**
 * @param {SessionSummary} session
 * @returns {Finding[]}
 */
export function stuckOnError(session) {
  /** @type {Finding[]} */
  const findings = []

  for (const call of session.repeatedCalls) {
    if (call.count < ERROR_LOOP_REPEATS) continue

    // The first attempt was reasonable. The identical repeats were not.
    const perCall = call.tokens / call.count
    const wasted = Math.round(perCall * (call.count - 1))

    findings.push({
      rule: 'stuck-on-error',
      severity: 'warning',
      title: `${call.name} was called ${call.count} times with identical arguments`,
      detail:
        `Repeating a call with the same arguments usually means the agent is ` +
        `looping on a failure rather than making progress. The repeats cost ` +
        `${n(wasted)} tokens.\n\n  ${call.signature.slice(0, 140)}`,
      fix:
        'Interrupt and tell the agent what is actually failing. A loop like this ' +
        'rarely resolves itself, and every attempt adds its output to the context.',
      claim: CLAIM_RECOVERABLE,
      claimKey: `call:${call.signature}`,
      wastedTokens: wasted,
      wastedCostUsd: costOf(wasted, session),
      evidence: { tool: call.name, count: call.count },
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// 9. A screenshot re-uploaded on every turn.
// ---------------------------------------------------------------------------

/**
 * @param {SessionSummary} session
 * @returns {Finding[]}
 */
export function imageOverhead(session) {
  if (session.turnsWithImages < 2) return []
  if (session.imageTokensPerTurn <= 0) return []

  const wasted = session.imageTokensPerTurn * (session.turnsWithImages - 1)
  return [
    {
      rule: 'image-overhead',
      severity: 'warning',
      title: `Images are re-sent on ${session.turnsWithImages} turns`,
      detail:
        `About ${n(session.imageTokensPerTurn)} tokens of image data ride along ` +
        'with each turn. Images stay in the history like any other content, so ' +
        'one screenshot is paid for on every turn that follows it.',
      fix:
        'Start a fresh session once the agent has described what it saw, or ' +
        'paste the relevant text instead of a screenshot where that is possible.',
      claim: CLAIM_RECOVERABLE,
      claimKey: 'images',
      wastedTokens: wasted,
      wastedCostUsd: costOf(wasted, session),
      evidence: { perTurn: session.imageTokensPerTurn, turns: session.turnsWithImages },
    },
  ]
}

// ---------------------------------------------------------------------------
// 10. Reasoning crowding out the work.
// ---------------------------------------------------------------------------

export const THINKING_SHARE_LIMIT = 0.4

/**
 * @param {SessionSummary} session
 * @returns {Finding[]}
 */
export function thinkingDominates(session) {
  const total = Object.values(session.categories).reduce((sum, value) => sum + value, 0)
  if (total <= 0) return []

  const thinking = session.categories.thinking ?? 0
  const share = thinking / total
  if (share < THINKING_SHARE_LIMIT) return []

  const excess = Math.round(thinking - total * THINKING_SHARE_LIMIT)
  return [
    {
      rule: 'thinking-dominates',
      severity: 'info',
      title: `Reasoning is ${Math.round(share * 100)}% of the context`,
      detail:
        `${n(thinking)} of ${n(total)} tokens across this session are extended ` +
        'thinking. Reasoning blocks stay in the history and are re-sent on later ' +
        'turns, so a high budget compounds.',
      fix:
        'Lower the thinking budget for routine work and raise it only for the ' +
        'turns that need it.',
      claim: CLAIM_POTENTIAL,
      claimKey: 'thinking',
      wastedTokens: Math.max(0, excess),
      wastedCostUsd: costOf(Math.max(0, excess), session),
      evidence: { thinking, total, share },
    },
  ]
}

/**
 * All ten, in the order they are defined above.
 *
 * @type {{ name: string, run: (session: SessionSummary, options?: any) => Finding[] }[]}
 */
export const RULES = [
  { name: 'unused-mcp-server', run: unusedMcpServer },
  { name: 'stuck-oversized-result', run: stuckOversizedResult },
  { name: 'bloated-memory-file', run: bloatedMemoryFile },
  { name: 'redundant-read', run: redundantReads },
  { name: 'approaching-context-limit', run: approachingContextLimit },
  { name: 'model-too-expensive', run: modelTooExpensiveForWork },
  { name: 'cache-not-working', run: cacheNotWorking },
  { name: 'stuck-on-error', run: stuckOnError },
  { name: 'image-overhead', run: imageOverhead },
  { name: 'thinking-dominates', run: thinkingDominates },
]
