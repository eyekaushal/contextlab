/**
 * Reconciling findings into totals that can be defended.
 *
 * The bug this exists to kill: a session that cost $6.08 reported $10.31
 * recoverable. Two faults produced it.
 *
 * **Two rules claiming the same tokens.** A file read fifteen times is both a
 * redundant read and a stuck oversized result. Both rules are right; adding
 * their figures counts the same tokens twice. Every finding now carries a
 * `claimKey` naming *what* it is claiming, and only the largest claim on a key
 * survives.
 *
 * **A hypothetical summed with a loss.** "A working cache would have saved
 * $4.87" is not the same kind of number as "you paid for this log six times".
 * The first is a saving available from a change you have not made; the second is
 * money already gone. They are reported as separate figures and never added.
 *
 * Pure.
 *
 * @module
 */

import { CLAIM_POTENTIAL, CLAIM_RECOVERABLE } from './rules.js'

/** @typedef {import('./rules.js').Finding} Finding */

/**
 * @typedef {Object} Totals
 * @property {number} count
 * @property {number} critical
 * @property {number} recoverableUsd   money already spent that a change removes
 * @property {number} recoverableTokens
 * @property {number} potentialUsd     saving available from a different choice
 * @property {number} potentialTokens
 * @property {number} suppressed       claims dropped as duplicates
 * @property {boolean} capped          true if the total had to be clamped
 */

/**
 * Drop duplicate claims, keeping the largest on each key.
 *
 * A suppressed finding is not deleted — it is still worth reading, it just no
 * longer contributes to the total. It carries `countsTowardTotal: false` and
 * the rule that took its claim.
 *
 * @param {Finding[]} findings
 * @returns {Finding[]}
 */
export function reconcileFindings(findings) {
  /** @type {Map<string, Finding>} */
  const winners = new Map()

  for (const finding of findings) {
    if (finding.claim !== CLAIM_RECOVERABLE) continue
    const key = finding.claimKey ?? `${finding.rule}:${finding.title}`
    const held = winners.get(key)
    if (!held || finding.wastedTokens > held.wastedTokens) winners.set(key, finding)
  }

  return findings.map((finding) => {
    if (finding.claim !== CLAIM_RECOVERABLE) {
      return { ...finding, countsTowardTotal: false }
    }

    const key = finding.claimKey ?? `${finding.rule}:${finding.title}`
    const winner = winners.get(key)
    if (winner === finding) return { ...finding, countsTowardTotal: true }

    return {
      ...finding,
      countsTowardTotal: false,
      supersededBy: winner?.rule,
    }
  })
}

/**
 * Totals for the header.
 *
 * `spendUsd` is the session's equivalent cost. Recoverable is clamped to it,
 * because you cannot recover more than you spent — but the clamp is a seatbelt,
 * not the fix. If it ever binds, a rule is over-claiming and `capped` says so.
 * A test asserts it never binds on real data.
 *
 * @param {Finding[]} findings
 * @param {{ spendUsd?: number }} [options]
 * @returns {Totals}
 */
export function totalWaste(findings, options = {}) {
  const reconciled = findings.some((finding) => 'countsTowardTotal' in finding)
    ? findings
    : reconcileFindings(findings)

  let recoverableUsd = 0
  let recoverableTokens = 0
  let potentialUsd = 0
  let potentialTokens = 0
  let suppressed = 0

  for (const finding of reconciled) {
    if (finding.claim === CLAIM_POTENTIAL) {
      potentialUsd += finding.wastedCostUsd
      potentialTokens += finding.wastedTokens
      continue
    }
    if (/** @type {any} */ (finding).countsTowardTotal === false) {
      suppressed += 1
      continue
    }
    recoverableUsd += finding.wastedCostUsd
    recoverableTokens += finding.wastedTokens
  }

  const spend = Number(options.spendUsd)
  const capped = Number.isFinite(spend) && spend > 0 && recoverableUsd > spend

  return {
    count: reconciled.length,
    critical: reconciled.filter((finding) => finding.severity === 'critical').length,
    recoverableUsd: capped ? spend : recoverableUsd,
    recoverableTokens,
    potentialUsd,
    potentialTokens,
    suppressed,
    capped,
  }
}
