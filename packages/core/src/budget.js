/**
 * Budgets and the alerts they produce.
 *
 * Budgets are stated in equivalent API cost, not actual spend. That is
 * deliberate: it means the same figure is meaningful whether you are on a
 * metered key or a subscription, and a subscription user can still ask "am I
 * burning more than usual today" without the answer being zero forever.
 *
 * Pure: spend comes in, alerts come out. No clock, no database.
 *
 * @module
 */

/**
 * @typedef {Object} BudgetAlert
 * @property {string} scope        daily | monthly | session
 * @property {'warning' | 'exceeded'} level
 * @property {number} spent
 * @property {number} limit
 * @property {number} share        spent / limit
 * @property {string} title
 * @property {string} detail
 */

/**
 * @typedef {Object} Spend
 * @property {number} [daily]
 * @property {number} [monthly]
 * @property {number} [session]
 */

const SCOPES = [
  { key: 'daily', noun: 'today' },
  { key: 'monthly', noun: 'this month' },
  { key: 'session', noun: 'in this session' },
]

/**
 * @param {Spend} spend
 * @param {import('./config.js').Budget} budget
 * @returns {BudgetAlert[]}
 */
export function evaluateBudget(spend = {}, budget = {}) {
  /** @type {BudgetAlert[]} */
  const alerts = []
  const warnAt = typeof budget.warnAt === 'number' ? budget.warnAt : 0.8

  for (const { key, noun } of SCOPES) {
    const limit = Number(budget[/** @type {'daily'} */ (key)])
    if (!Number.isFinite(limit) || limit <= 0) continue

    const spent = Number(spend[/** @type {'daily'} */ (key)]) || 0
    const share = spent / limit
    if (share < warnAt) continue

    const exceeded = spent >= limit
    alerts.push({
      scope: key,
      level: exceeded ? 'exceeded' : 'warning',
      spent,
      limit,
      share,
      title: exceeded
        ? `Over the ${key} budget`
        : `${Math.round(share * 100)}% of the ${key} budget`,
      detail: exceeded
        ? `${usd(spent)} spent ${noun}, against a ${usd(limit)} budget.`
        : `${usd(spent)} of ${usd(limit)} ${noun}.`,
    })
  }

  // Something already over the line outranks something merely approaching it.
  return alerts.sort(
    (a, b) =>
      Number(b.level === 'exceeded') - Number(a.level === 'exceeded') ||
      b.share - a.share,
  )
}

/**
 * Is any budget set at all?
 *
 * Screens use this to stay quiet rather than showing an empty budget panel to
 * someone who never asked for one.
 *
 * @param {import('./config.js').Budget} budget
 * @returns {boolean}
 */
export function hasBudget(budget = {}) {
  return ['daily', 'monthly', 'session'].some((key) => {
    const limit = Number(budget[/** @type {'daily'} */ (key)])
    return Number.isFinite(limit) && limit > 0
  })
}

/**
 * Progress against each configured budget, whether or not it has tripped.
 *
 * @param {Spend} spend
 * @param {import('./config.js').Budget} budget
 * @returns {{ scope: string, spent: number, limit: number, share: number,
 *             level: 'good' | 'warning' | 'exceeded' }[]}
 */
export function budgetProgress(spend = {}, budget = {}) {
  const warnAt = typeof budget.warnAt === 'number' ? budget.warnAt : 0.8
  /** @type {any[]} */
  const rows = []

  for (const { key } of SCOPES) {
    const limit = Number(budget[/** @type {'daily'} */ (key)])
    if (!Number.isFinite(limit) || limit <= 0) continue

    const spent = Number(spend[/** @type {'daily'} */ (key)]) || 0
    const share = spent / limit
    rows.push({
      scope: key,
      spent,
      limit,
      share,
      level: spent >= limit ? 'exceeded' : share >= warnAt ? 'warning' : 'good',
    })
  }
  return rows
}

/**
 * @param {number} value
 * @returns {string}
 */
function usd(value) {
  return `$${(Number(value) || 0).toFixed(2)}`
}

/** Round figures a person would actually type. */
export const DAILY_PRESETS = [5, 20, 50, 100]
export const MONTHLY_PRESETS = [50, 200, 500, 1000]

/**
 * A budget suggested from the reader's own history, not from a guess at the
 * ideal — there is no ideal, only theirs.
 *
 * Daily: the 90th percentile of daily spend, rounded up to the next preset —
 * "your busiest day was $10.48; $20 would have warned you once". Monthly: the
 * last thirty days with a quarter's headroom, rounded up the same way. Past the
 * largest preset the figure rounds to the next round hundred rather than
 * pretending the presets were a ceiling.
 *
 * Returns null figures when there is nothing to go on.
 *
 * @param {{ byDay: number[], last30Total: number }} history
 * @returns {{ daily: number | null, monthly: number | null,
 *             busiestDay: number, p90Day: number }}
 */
export function suggestBudget({ byDay, last30Total }) {
  const days = byDay
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  if (days.length === 0) return { daily: null, monthly: null, busiestDay: 0, p90Day: 0 }

  const p90 =
    days[Math.min(days.length - 1, Math.max(0, Math.ceil(days.length * 0.9) - 1))] ?? 0
  const busiest = days[days.length - 1] ?? 0

  return {
    daily: roundUpTo(p90, DAILY_PRESETS),
    monthly: roundUpTo(last30Total * 1.25, MONTHLY_PRESETS),
    busiestDay: busiest,
    p90Day: p90,
  }
}

/**
 * @param {number} value
 * @param {number[]} presets
 * @returns {number}
 */
function roundUpTo(value, presets) {
  const preset = presets.find((candidate) => candidate >= value)
  if (preset !== undefined) return preset
  return Math.ceil(value / 100) * 100
}
