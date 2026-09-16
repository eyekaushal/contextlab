/**
 * The working-out behind a finding's number.
 *
 * `docs/DECISIONS.md` — *every finding shows its working out* — rests on one
 * promise: the reader can check the headline against the terms that produced
 * it. That promise was broken. The card derived an equation on its own from
 * whatever two numbers a rule happened to leave in `evidence`, and on four of
 * the ten rules the equation it printed did not produce the number beside it:
 *
 *     20,057 tokens × 8 turns = 144,454      (20,057 × 8 is 160,456)
 *
 * The rule had claimed only the excess over a 2,000-token file — correct — and
 * the card had multiplied the wrong things.
 *
 * So the rule now states its working, in a form small enough to be checked:
 * a product of factors, each optionally a subtraction. Every formula the ten
 * rules use fits it. The card renders what the rule states and derives
 * nothing; a test evaluates every rule's working and fails if it does not
 * reproduce that rule's number exactly.
 *
 * Pure.
 *
 * @module
 */

/**
 * @typedef {Object} Term
 * @property {number} value
 * @property {string} label   what the number is — "tokens per turn", "kept"
 */

/**
 * @typedef {Object} Factor
 * @property {number} value
 * @property {string} label
 * @property {Term} [minus]   subtracted before multiplying: (value − minus)
 */

/**
 * @typedef {Object} Working
 * @property {Factor[]} factors   multiplied together, left to right
 * @property {'tokens' | 'usd'} unit   what the product is
 */

/**
 * @param {Factor} factor
 * @returns {number}
 */
function factorValue(factor) {
  return factor.value - (factor.minus?.value ?? 0)
}

/**
 * What the working comes to.
 *
 * Tokens are rounded to a whole number, as every rule rounds its own claim.
 * Money is not — a cent is already the unit the reader sees, and rounding here
 * would hide a rule that is off by a fraction of one.
 *
 * @param {Working} working
 * @returns {number}
 */
export function evaluateWorking(working) {
  const product = working.factors.reduce(
    (total, factor) => total * factorValue(factor),
    1,
  )
  return working.unit === 'tokens' ? Math.round(product) : product
}

/**
 * Does this working reproduce the finding's own number?
 *
 * The check a test runs over every rule. Money is compared to within a
 * millionth of a cent, because it is computed from prices that are themselves
 * fractions; tokens must match exactly.
 *
 * @param {Working} working
 * @param {number} claimed   the finding's `wastedTokens` or `wastedCostUsd`
 * @returns {boolean}
 */
export function workingMatches(working, claimed) {
  const evaluated = evaluateWorking(working)
  return working.unit === 'tokens'
    ? evaluated === claimed
    : Math.abs(evaluated - claimed) < 1e-8
}

/**
 * The working as one line of text, for the terminal and for tests.
 *
 *     (20,057 tokens per turn − 2,000 kept) × 8 turns = 144,454 tokens
 *
 * A factor with a subtraction is parenthesised only when there is something to
 * separate it from; a lone factor needs no brackets.
 *
 * @param {Working} working
 * @param {(value: number) => string} [format]
 * @returns {string}
 */
export function describeWorking(working, format = defaultFormat) {
  const parts = working.factors.map((factor, index) => {
    // In a money working the first term is the amount; the rest are ratios.
    const amount = working.unit === 'usd' && index === 0
    const head =
      `${amount ? `$${factor.value.toFixed(2)}` : format(factor.value)} ${factor.label}`.trim()
    if (!factor.minus) return head
    const inner = `${head} − ${format(factor.minus.value)} ${factor.minus.label}`.trim()
    return working.factors.length > 1 ? `(${inner})` : inner
  })
  const result = evaluateWorking(working)
  const shown =
    working.unit === 'usd' ? `$${result.toFixed(2)}` : `${format(result)} tokens`
  return `${parts.join(' × ')} = ${shown}`
}

/**
 * @param {number} value
 * @returns {string}
 */
function defaultFormat(value) {
  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  // A rate, a share, a fractional per-turn figure: two decimals is enough to
  // check with, and more is noise.
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
