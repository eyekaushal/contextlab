/**
 * The stacked composition bar.
 *
 * Follows the chart rules in docs/DESIGN.md: a 2px gap between segments so
 * boundaries read without relying on hue, 4px rounded ends, values and labels
 * in text tokens rather than the series colour, and a tooltip that renders
 * below and to the right of the cursor so it never covers the mark it
 * describes.
 *
 * @module
 */

import { useState } from 'react'
import { categoryColor, categoryLabel, exact, percent, tokens } from '../lib/format.js'
import { cn } from '../lib/utils.js'

/**
 * @param {{ rows: any[], total?: number, height?: number, className?: string,
 *           onSelect?: (category: string) => void }} props
 */
export function CompositionBar({ rows, total, height = 28, className, onSelect }) {
  const [hover, setHover] = useState(/** @type {any} */ (null))
  const [point, setPoint] = useState({ x: 0, y: 0 })

  const visible = (rows ?? []).filter((row) => Number(row.tokens) > 0)
  const sum = total ?? visible.reduce((acc, row) => acc + Number(row.tokens), 0)
  if (visible.length === 0 || sum <= 0) {
    return (
      <div
        className={cn('rounded bg-[var(--color-gridline)]', className)}
        style={{ height }}
      />
    )
  }

  return (
    <div className={cn('relative', className)}>
      <div className="flex gap-[2px]" style={{ height }}>
        {visible.map((row, index) => {
          const share = Number(row.tokens) / sum
          return (
            <button
              key={row.category}
              type="button"
              aria-label={`${categoryLabel(row.category)}, ${exact(row.tokens)} tokens`}
              onMouseMove={(event) => {
                setHover(row)
                setPoint({ x: event.clientX, y: event.clientY })
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(row.category)}
              className={cn(
                'h-full min-w-[3px] transition-opacity',
                hover && hover.category !== row.category ? 'opacity-45' : 'opacity-100',
                index === 0 && 'rounded-l',
                index === visible.length - 1 && 'rounded-r',
              )}
              style={{
                width: `${share * 100}%`,
                backgroundColor: categoryColor(row.category),
              }}
            />
          )
        })}
      </div>

      {hover ? (
        <Tooltip point={point}>
          <div className="font-medium text-[var(--color-text-primary)]">
            {categoryLabel(hover.category)}
          </div>
          <div className="tnum text-[var(--color-text-secondary)]">
            {exact(hover.tokens)} tokens · {percent(Number(hover.tokens) / sum, 1)}
          </div>
        </Tooltip>
      ) : null}
    </div>
  )
}

/**
 * A tooltip anchored below and right of the cursor.
 *
 * The prior tool's tooltip covered the bars it described, which made the
 * context diff unreadable at exactly the moment someone was trying to read it.
 *
 * @param {{ point: { x: number, y: number }, children: any }} props
 */
export function Tooltip({ point, children }) {
  const OFFSET = 14
  return (
    <div
      role="tooltip"
      className={cn(
        'pointer-events-none fixed z-50 rounded border border-[var(--color-border-subtle)]',
        'bg-[var(--color-page)] px-2.5 py-1.5 text-xs shadow-lg',
      )}
      style={{ left: point.x + OFFSET, top: point.y + OFFSET }}
    >
      {children}
    </div>
  )
}

/**
 * The legend. Always present for two or more series.
 *
 * @param {{ rows: any[], total?: number, className?: string }} props
 */
export function CompositionLegend({ rows, total, className }) {
  const visible = (rows ?? []).filter((row) => Number(row.tokens) > 0)
  const sum = total ?? visible.reduce((acc, row) => acc + Number(row.tokens), 0)
  if (visible.length < 2) return null

  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1.5', className)}>
      {visible.map((row) => (
        <li key={row.category} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: categoryColor(row.category) }}
          />
          <span className="text-[var(--color-text-secondary)]">
            {categoryLabel(row.category)}
          </span>
          <span className="tnum text-[var(--color-text-muted)]">
            {tokens(row.tokens)}
            {sum > 0 ? ` · ${percent(Number(row.tokens) / sum)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}
