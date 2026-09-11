/**
 * What changed between this turn and the one before it.
 *
 * The prior tool drew two near-identical full bars side by side. At 140,000
 * tokens each, a category moving by 1,400 is invisible — and the tooltip
 * covered the bars while you tried to find it.
 *
 * So this shows only the delta: one row per category that actually moved,
 * signed, largest first. Nothing that stayed the same is drawn at all.
 *
 * @module
 */

import { categoryColor, categoryLabel, tokens } from '../lib/format.js'
import { cn } from '../lib/utils.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.jsx'

/**
 * @param {{ rows: any[], className?: string }} props
 */
export function ContextDiff({ rows = [], className }) {
  const moved = rows.filter((row) => Number(row.delta) !== 0)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Since the previous turn</CardTitle>
        {moved.length > 0 ? (
          <span className="tnum text-xs text-[var(--color-text-muted)]">
            {signed(moved.reduce((sum, row) => sum + Number(row.delta), 0))} total
          </span>
        ) : null}
      </CardHeader>

      <CardContent className="pt-2">
        {moved.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Nothing changed, or this is the first turn.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {moved.map((row) => (
              <Row key={row.category} row={row} max={largest(moved)} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * @param {{ row: any, max: number }} props
 */
function Row({ row, max }) {
  const delta = Number(row.delta)
  const width = max > 0 ? (Math.abs(delta) / max) * 100 : 0
  const grew = delta > 0

  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: categoryColor(row.category) }}
      />
      <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">
        {categoryLabel(row.category)}
      </span>

      {/* A bar anchored at the centre, so growth and shrinkage read as
          opposite directions rather than as two similar-looking lengths. */}
      <div className="relative h-1.5 w-24 shrink-0 rounded-full bg-[var(--color-gridline)]">
        <div
          className={cn('absolute top-0 h-full rounded-full')}
          style={{
            width: `${width / 2}%`,
            left: grew ? '50%' : undefined,
            right: grew ? undefined : '50%',
            backgroundColor: grew
              ? 'var(--color-status-warning)'
              : 'var(--color-status-good)',
          }}
        />
      </div>

      <span
        className={cn(
          'tnum w-20 shrink-0 text-right text-xs',
          grew ? 'text-[var(--color-status-warning)]' : 'text-[var(--color-status-good)]',
        )}
      >
        {signed(delta)}
      </span>
    </li>
  )
}

/**
 * @param {number} value
 * @returns {string}
 */
function signed(value) {
  // A minus sign, not a hyphen: at small sizes a hyphen reads as a dash.
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${tokens(Math.abs(value))}`
}

/**
 * @param {any[]} rows
 * @returns {number}
 */
function largest(rows) {
  return Math.max(...rows.map((row) => Math.abs(Number(row.delta))), 1)
}
