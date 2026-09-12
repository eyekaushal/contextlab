/**
 * Where the money went, in one row.
 *
 * The sessions screen was a table with nothing above it — no sense of "this is
 * the week", no indication of what is outstanding, no entry point into the
 * thing the reader came to do. A table is a list of rows; a dashboard states a
 * position first and then lets you go looking.
 *
 * Recoverable and potential stay separate here as everywhere else, and the
 * budget bar appears only when one is configured — an empty bar is a worse
 * answer than no bar.
 *
 * @module
 */

import { usd } from '../lib/format.js'
import { Stat, StatRow } from './stat.jsx'
import { Card } from './ui/card.jsx'

/**
 * @param {{ data: any, onOpenOptimize?: () => void }} props
 */
export function SummaryStrip({ data, onOpenOptimize }) {
  if (!data) return null

  const outstanding = Number(data.findings) || 0
  const critical = Number(data.critical) || 0

  return (
    <Card className="space-y-3 p-4">
      <StatRow className="sm:grid-cols-5">
        <Stat label="Today" value={usd(data.today)} hint="equivalent API cost" />
        <Stat label="7 days" value={usd(data.week)} hint={`${data.turns ?? 0} turns`} />
        <Stat
          label="All time"
          value={usd(data.total)}
          hint={`${data.sessions ?? 0} session${data.sessions === 1 ? '' : 's'}`}
        />
        <Stat
          label="Recoverable"
          value={usd(data.recoverable)}
          hint={`${usd(data.potential)} potential`}
          tone={Number(data.recoverable) > 0 ? 'var(--color-status-warning)' : undefined}
        />
        <Stat
          label="Outstanding"
          value={outstanding}
          hint={
            outstanding === 0
              ? 'nothing to fix'
              : `${critical} critical · finding${outstanding === 1 ? '' : 's'}`
          }
          tone={critical > 0 ? 'var(--color-status-critical)' : undefined}
        />
      </StatRow>

      {data.budget?.configured ? <BudgetBars budget={data.budget} /> : null}

      {outstanding > 0 && onOpenOptimize ? (
        <button
          type="button"
          onClick={onOpenOptimize}
          className="text-xs text-[var(--color-cat-system-prompt)] underline-offset-2 hover:underline"
        >
          What do I change first? →
        </button>
      ) : null}
    </Card>
  )
}

/**
 * @param {{ budget: any }} props
 */
function BudgetBars({ budget }) {
  const rows = budget.progress ?? []
  if (rows.length === 0) return null

  return (
    <div className="space-y-1.5 border-t border-[var(--color-border-subtle)] pt-2.5">
      {rows.map((/** @type {any} */ row) => (
        <div key={row.scope} className="flex items-center gap-2.5 text-xs">
          <span className="w-14 shrink-0 capitalize text-[var(--color-text-muted)]">
            {row.scope}
          </span>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-gridline)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (Number(row.share) || 0) * 100)}%`,
                backgroundColor:
                  row.level === 'exceeded'
                    ? 'var(--color-status-critical)'
                    : row.level === 'warning'
                      ? 'var(--color-status-warning)'
                      : 'var(--color-status-good)',
              }}
            />
          </div>
          <span className="tnum w-24 shrink-0 text-right text-[var(--color-text-secondary)]">
            {usd(row.spent)} / {usd(row.limit)}
          </span>
        </div>
      ))}
    </div>
  )
}
