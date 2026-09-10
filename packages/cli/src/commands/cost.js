/**
 * `contextlab cost` — historical spend, by day or by project.
 *
 * @module
 */

import { costByDay, costByProject } from '@contextlab/store'
import { open } from '../context.js'
import { color, heading, pad, tokens, truncate, usd } from '../format.js'

/**
 * @param {{ by?: string, days?: string, project?: string, json?: boolean }} options
 * @returns {void}
 */
export function cost(options = {}) {
  const { db } = open()
  const by = options.by ?? 'day'

  if (by === 'project') {
    const rows = /** @type {any[]} */ (costByProject(db))
    if (options.json) return void console.log(JSON.stringify(rows, null, 2))
    printProjects(rows)
    return
  }

  const days = Number(options.days ?? 14)
  const rows = /** @type {any[]} */ (
    costByDay(db, { days, ...(options.project ? { project: options.project } : {}) })
  )
  if (options.json) return void console.log(JSON.stringify(rows, null, 2))
  printDays(rows, days)
}

/**
 * @param {any[]} rows
 * @param {number} days
 * @returns {void}
 */
function printDays(rows, days) {
  if (rows.length === 0) {
    console.log(
      color.gray('\nNothing recorded yet. Run an agent through the proxy first:'),
    )
    console.log(color.gray('  contextlab claude\n'))
    return
  }

  console.log(heading(`Spend, last ${days} days`))
  console.log(
    color.gray(
      `${pad('DAY', 12)}${pad('TURNS', 7)}${pad('SESSIONS', 10)}${pad('INPUT', 9)}${pad('CACHED', 9)}${pad('OUTPUT', 9)}COST`,
    ),
  )

  let total = 0
  for (const row of rows) {
    const equivalent = Number(row.equivalent_cost_usd) || 0
    total += equivalent
    console.log(
      pad(String(row.day), 12) +
        pad(String(row.turns), 7) +
        pad(String(row.sessions), 10) +
        pad(tokens(Number(row.input_tokens)), 9) +
        pad(color.gray(tokens(Number(row.cache_read_tokens))), 9) +
        pad(tokens(Number(row.output_tokens)), 9) +
        usd(equivalent),
    )
  }

  console.log(color.gray('─'.repeat(62)))
  console.log(`${pad(color.bold('TOTAL'), 47)}${color.bold(usd(total))}\n`)
}

/**
 * @param {any[]} rows
 * @returns {void}
 */
function printProjects(rows) {
  if (rows.length === 0) {
    console.log(color.gray('\nNothing recorded yet.\n'))
    return
  }

  console.log(heading('Spend by project'))
  console.log(
    color.gray(`${pad('PROJECT', 28)}${pad('SESSIONS', 10)}${pad('TURNS', 8)}COST`),
  )

  let total = 0
  for (const row of rows) {
    const equivalent = Number(row.equivalent_cost_usd) || 0
    total += equivalent
    console.log(
      pad(truncate(String(row.project), 26), 28) +
        pad(String(row.sessions), 10) +
        pad(String(row.turns), 8) +
        usd(equivalent),
    )
  }

  console.log(color.gray('─'.repeat(56)))
  console.log(`${pad(color.bold('TOTAL'), 46)}${color.bold(usd(total))}\n`)
}
