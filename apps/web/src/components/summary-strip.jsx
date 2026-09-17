/**
 * Where the money went, in five cards.
 *
 * The strip states the position before the table lists the rows. Five equal
 * tiles, each with its mark, its number large, and — where a prior period
 * exists — an arrow saying which way it moved. Today is measured against
 * yesterday and the week against the week before; all-time has no prior
 * period and shows none rather than inventing one.
 *
 * Recoverable and potential stay separate here as everywhere else. The budget
 * bar appears only when one is configured — an empty bar is a worse answer
 * than no bar.
 *
 * @module
 */

import { AlertOctagon, CalendarDays, CalendarRange, PiggyBank, Sigma } from 'lucide-react'
import { usd } from '../lib/format.js'
import { Stat } from './stat.jsx'
import { Card } from './ui/card.jsx'

/**
 * @param {{ data: any, onOpenOptimize?: () => void }} props
 */
export function SummaryStrip({ data, onOpenOptimize }) {
  if (!data) return null

  const outstanding = Number(data.findings) || 0
  const critical = Number(data.critical) || 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          icon={CalendarDays}
          label="Today"
          value={usd(data.today)}
          hint="equivalent API cost"
          delta={{
            current: Number(data.today) || 0,
            previous: Number(data.yesterday) || 0,
            label: 'vs yesterday',
            higherIsWorse: true,
          }}
        />
        <Stat
          icon={CalendarRange}
          label="7 days"
          value={usd(data.week)}
          hint={`${data.weekTurns ?? data.turns ?? 0} turns`}
          delta={{
            current: Number(data.week) || 0,
            previous: Number(data.priorWeek) || 0,
            label: 'vs the 7 days before',
            higherIsWorse: true,
          }}
        />
        <Stat
          icon={Sigma}
          label="All time"
          value={usd(data.total)}
          hint={`${data.sessions ?? 0} session${data.sessions === 1 ? '' : 's'} · ${data.turns ?? 0} turns`}
        />
        <Stat
          icon={PiggyBank}
          label="Recoverable"
          value={usd(data.recoverable)}
          hint={`${usd(data.potential)} more is potential`}
          tone={Number(data.recoverable) > 0 ? 'var(--color-status-warning)' : undefined}
        />
        <Stat
          icon={AlertOctagon}
          label="Outstanding"
          value={outstanding}
          hint={
            outstanding === 0
              ? 'nothing to fix'
              : `${critical} critical · ${outstanding === 1 ? 'finding' : 'findings'}`
          }
          tone={critical > 0 ? 'var(--color-status-critical)' : undefined}
        />
      </div>

      {data.budget?.configured ? <BudgetBars budget={data.budget} /> : null}

      {outstanding > 0 && onOpenOptimize ? (
        <button
          type="button"
          onClick={onOpenOptimize}
          className="text-sm text-[var(--color-cat-system-prompt)] underline-offset-2 hover:underline"
        >
          What do I change first? →
        </button>
      ) : null}
    </div>
  )
}

/**
 * @param {{ budget: any }} props
 */
function BudgetBars({ budget }) {
  const rows = budget.progress ?? []
  if (rows.length === 0) return null

  return (
    <Card className="space-y-1.5 px-4 py-3">
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
    </Card>
  )
}
