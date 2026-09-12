/**
 * `contextlab optimize` — ranked waste, and the exact change to make.
 *
 * The differentiator. Everything else in this tool measures; this one tells you
 * what to do about it.
 *
 * @module
 */

import { runRules, totalWaste } from '@contextlab/core/prescribe'
import { buildSessionSummary } from '@contextlab/server'
import { listSessions, replaceFindings } from '@contextlab/store'
import { open } from '../context.js'
import { color, heading, tokens, usd, when } from '../format.js'

/** @type {Record<string, (text: string) => string>} */
const SEVERITY_PAINT = {
  critical: color.red,
  warning: color.yellow,
  info: color.blue,
}

/**
 * @param {{ session?: string, limit?: string, all?: boolean, json?: boolean }} [options]
 * @returns {void}
 */
export function optimize(options = {}) {
  const { db } = open()

  const sessions = options.session
    ? [{ id: options.session }]
    : /** @type {any[]} */ (listSessions(db, { limit: options.all ? 25 : 1 }))

  if (sessions.length === 0) {
    console.log(
      color.gray('\nNothing recorded yet. Run an agent through the proxy first:'),
    )
    console.log(color.gray('  contextlab claude\n'))
    return
  }

  /** @type {any[]} */
  const reports = []

  for (const row of sessions) {
    const summary = buildSessionSummary(db, String(row.id))
    if (!summary) continue

    const findings = runRules(summary)
    // Findings are deterministic, so caching them is safe and makes the
    // dashboard's optimize screen free.
    replaceFindings(db, String(row.id), findings)
    reports.push({ session: row, summary, findings })
  }

  if (options.json) {
    console.log(JSON.stringify(reports, null, 2))
    return
  }

  for (const report of reports) {
    printReport(report, sessions.length > 1)
  }
}

/**
 * @param {any} report
 * @param {boolean} many
 * @returns {void}
 */
function printReport(report, many) {
  const { session, summary, findings } = report
  const total = totalWaste(findings, { spendUsd: summary.totalCostUsd })

  const label =
    `${session.tool || summary.tool || 'session'} · ${summary.model}` +
    (session.project_name ? ` · ${session.project_name}` : '') +
    (session.last_seen_at ? ` · ${when(Number(session.last_seen_at))}` : '')

  console.log(heading(label))
  console.log(
    color.gray(
      `  ${summary.turnCount} turns · ${tokens(summary.peakContextTokens)} peak context · ${usd(summary.totalCostUsd)} spent`,
    ),
  )

  if (findings.length === 0) {
    console.log(`\n  ${color.green('Nothing to fix.')} This session looks clean.\n`)
    return
  }

  // Three numbers that do not pretend to add up to one: what was spent, what a
  // change would give back, and what a different choice would have saved.
  console.log(
    `\n  ${color.bold(`${total.count} findings`)}` +
      (total.critical > 0 ? color.red(` · ${total.critical} critical`) : '') +
      ` · ${color.bold(usd(total.recoverableUsd))} recoverable of ` +
      `${usd(summary.totalCostUsd)} spent` +
      (total.potentialUsd > 0
        ? color.gray(
            `\n  ${usd(total.potentialUsd)} more available from changes you have not made`,
          )
        : '') +
      '\n',
  )

  findings.forEach((/** @type {any} */ finding, /** @type {number} */ index) => {
    const paint = SEVERITY_PAINT[finding.severity] ?? color.gray
    console.log(`  ${paint('●')} ${color.bold(finding.title)}`)
    const note =
      finding.claim === 'potential'
        ? ' · potential, not counted in recoverable'
        : finding.countsTowardTotal === false
          ? ` · already counted under ${finding.supersededBy}`
          : ''
    console.log(
      `    ${color.gray(`${tokens(finding.wastedTokens)} tokens · ${usd(finding.wastedCostUsd)}${note}`)}`,
    )
    for (const line of String(finding.detail).split('\n')) {
      console.log(`    ${color.gray(line)}`)
    }
    console.log(`\n    ${color.cyan('FIX')}`)
    for (const line of String(finding.fix).split('\n')) {
      console.log(`    ${line}`)
    }
    if (index < findings.length - 1) console.log()
  })

  console.log()
  if (many) console.log(color.gray('─'.repeat(60)))
}
