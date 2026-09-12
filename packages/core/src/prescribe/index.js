/**
 * The rules engine behind `contextlab optimize`.
 *
 * Deterministic by construction: ten plain functions over a summary object,
 * ranked by the money they say you are losing. No model is called, nothing is
 * sampled, nothing depends on the time of day. Run it twice on the same session
 * and you get the same answer, offline.
 *
 * Pure.
 *
 * @module
 */

import { reconcileFindings } from './reconcile.js'
import { RULES } from './rules.js'

export * from './reconcile.js'
export * from './rules.js'
export { hashText, stableStringify, summarizeSession } from './summary.js'

/** @typedef {import('./rules.js').Finding} Finding */
/** @typedef {import('./summary.js').SessionSummary} SessionSummary */

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 }

/**
 * Run every rule against a session.
 *
 * A rule that throws is skipped rather than allowed to take the whole report
 * down with it — nine findings and a logged failure beats none.
 *
 * @param {SessionSummary} session
 * @param {{ alternative?: { model: string, inputPricePerMillion: number },
 *           onError?: (rule: string, error: unknown) => void }} [options]
 * @returns {Finding[]} ranked, most expensive first
 */
export function runRules(session, options = {}) {
  /** @type {Finding[]} */
  const findings = []

  for (const rule of RULES) {
    try {
      findings.push(...rule.run(session, options))
    } catch (error) {
      options.onError?.(rule.name, error)
    }
  }

  // Reconciled here rather than at the call site, so there is no path by which
  // a caller sums two rules that claimed the same tokens.
  return rankFindings(reconcileFindings(findings))
}

/**
 * Rank by money first, because that is the question the user is asking.
 *
 * Severity breaks ties, so a warning that costs nothing — running out of
 * context — still sorts above an info-level note that also costs nothing.
 *
 * @param {Finding[]} findings
 * @returns {Finding[]}
 */
export function rankFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      b.wastedCostUsd - a.wastedCostUsd ||
      b.wastedTokens - a.wastedTokens ||
      (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) ||
      a.title.localeCompare(b.title),
  )
}
