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
import { Card } from './ui/card.jsx'

/**
 * @param {{ finding: any, className?: string }} props
 */
export function Finding({ finding, className }) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Severity severity={finding.severity} />
          <h3 className="min-w-0 text-sm font-medium">{finding.title}</h3>
        </div>

        <div className="tnum shrink-0 text-right text-sm">
          <div className="font-semibold text-[var(--color-text-primary)]">
            {usd(finding.wastedCostUsd)}
          </div>
          {finding.wastedTokens > 0 ? (
            <div className="text-[11px] text-[var(--color-text-muted)]">
              {exact(finding.wastedTokens)} tokens
            </div>
          ) : null}
        </div>
      </div>

      {finding.detail ? (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-text-secondary)]">
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
function Fix({ text }) {
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
        <span className="text-[11px] uppercase tracking-wide text-[var(--color-cat-system-prompt)]">
          Fix
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy the fix"
          className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <pre
        className={cn(
          'overflow-x-auto px-2.5 py-2 text-xs leading-relaxed text-[var(--color-text-secondary)]',
          isBlock ? 'font-mono' : 'whitespace-pre-wrap font-sans',
        )}
      >
        {text}
      </pre>
    </div>
  )
}
