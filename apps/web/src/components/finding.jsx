/**
 * A finding, with the change that fixes it.
 *
 * The fix block is the reason this component exists. A finding without one is a
 * restatement of the chart above it; a finding with a copyable config change is
 * something a reader acts on and moves past.
 *
 * @module
 */

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { exact, usd } from '../lib/format.js'
import { cn } from '../lib/utils.js'
import { Severity } from './health.jsx'
import { Badge } from './ui/badge.jsx'
import { Card } from './ui/card.jsx'

/**
 * @param {{ finding: any, className?: string }} props
 */
export function Finding({ finding, className }) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Severity severity={finding.severity} />
          <h3 className="min-w-0 text-sm font-medium">{finding.title}</h3>
          {finding.claim === 'potential' ? (
            <Badge>potential</Badge>
          ) : finding.countsTowardTotal === false ? (
            <Badge>counted under {finding.supersededBy}</Badge>
          ) : null}
        </div>

        <div className="tnum shrink-0 text-right text-sm">
          <div
            className={cn(
              'font-semibold',
              // A figure that is not in the headline must not look like one
              // that is.
              counted(finding)
                ? 'text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)]',
            )}
          >
            {usd(finding.wastedCostUsd)}
          </div>
          {finding.wastedTokens > 0 ? (
            <div className="text-xs text-[var(--color-text-muted)]">
              {exact(finding.wastedTokens)} tokens
            </div>
          ) : null}
        </div>
      </div>

      <Arithmetic finding={finding} />

      {finding.detail ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {finding.detail}
        </p>
      ) : null}

      {finding.fix ? <Fix text={finding.fix} /> : null}
    </Card>
  )
}

/**
 * @param {{ text: string }} props
 */
export function Fix({ text }) {
  const [copied, setCopied] = useState(false)

  // A fix that spans lines is usually a config block worth pasting whole; a
  // one-liner is usually prose. Only the former gets a monospace treatment.
  const isBlock = text.includes('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be refused. The text is on screen and selectable,
      // so this is a missing convenience rather than a failure worth reporting.
    }
  }

  return (
    <div className="mt-3 rounded border border-[var(--color-border-subtle)] bg-[var(--color-page)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-2.5 py-1">
        <span className="text-xs uppercase tracking-wide text-[var(--color-cat-system-prompt)]">
          Fix
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy the fix"
          className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <pre
        className={cn(
          'overflow-x-auto px-2.5 py-2 text-sm leading-relaxed text-[var(--color-text-secondary)]',
          isBlock ? 'font-mono' : 'whitespace-pre-wrap font-sans',
        )}
      >
        {text}
      </pre>
    </div>
  )
}

/**
 * The sum, shown rather than asserted.
 *
 * docs/DESIGN.md writes this line out explicitly:
 *
 *   12,400 tokens x 84 turns = 1,041,600 wasted  ·  $3.12
 *
 * It is the difference between a claim and a calculation — *if* the line is
 * the rule's own arithmetic. For a while it was not: this component built an
 * equation from whatever two evidence fields it could find and printed
 * `20,057 × 8 = 144,454`, which is false, under a number that was right.
 *
 * Now it renders `evidence.working` — the terms the rule itself multiplied —
 * and derives nothing. If a rule states no working, nothing is shown; a
 * fabricated equation is worse than none. A test in core holds every rule's
 * working to its own number, so what is printed here is what was computed.
 *
 * @param {{ finding: any }} props
 */
export function Arithmetic({ finding }) {
  const working = finding.evidence?.working
  if (!working || !Array.isArray(working.factors) || working.factors.length === 0) {
    return null
  }

  const money = working.unit === 'usd'
  const result = money
    ? usd(finding.wastedCostUsd)
    : `${exact(finding.wastedTokens)} wasted`

  return (
    <p className="tnum mt-2 font-mono text-sm text-[var(--color-text-secondary)]">
      {working.factors.map((/** @type {any} */ factor, /** @type {number} */ index) => (
        <span key={`${factor.label}:${factor.value}`}>
          {index > 0 ? ' \u00d7 ' : ''}
          <FactorText
            factor={factor}
            bracket={working.factors.length > 1}
            // In a money working the first term is the amount spent; the rest
            // are ratios. Only the amount wears a dollar sign.
            money={money && index === 0}
          />
        </span>
      ))}
      <span> = </span>
      <span className="text-[var(--color-text-primary)]">{result}</span>
      {money ? null : (
        <>
          {/* A JS string, not JSX text: JSX does not process escape sequences,
              and this once printed the six characters of the escape on screen. */}
          <span>{' \u00b7 '}</span>
          <span className="text-[var(--color-text-primary)]">
            {usd(finding.wastedCostUsd)}
          </span>
        </>
      )}
    </p>
  )
}

/**
 * One term of the working: `20,057 tokens per turn`, or with a subtraction,
 * `(20,057 tokens per turn − 2,000 kept)`.
 *
 * @param {{ factor: any, bracket: boolean, money?: boolean }} props
 */
function FactorText({ factor, bracket, money = false }) {
  const head =
    `${money ? usd(factor.value) : figure(factor.value)} ${factor.label}`.trim()
  if (!factor.minus) return <>{head}</>
  const inner =
    `${head} \u2212 ${figure(factor.minus.value)} ${factor.minus.label}`.trim()
  return <>{bracket ? `(${inner})` : inner}</>
}

/**
 * A whole number with separators; a rate or a share to two decimals.
 *
 * @param {number} value
 * @returns {string}
 */
function figure(value) {
  return Number.isInteger(value)
    ? exact(value)
    : value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/**
 * Does this finding contribute to the headline figure?
 *
 * @param {any} finding
 * @returns {boolean}
 */
export function counted(finding) {
  return finding.claim !== 'potential' && finding.countsTowardTotal !== false
}
