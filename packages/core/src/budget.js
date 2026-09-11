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
