/**
 * The stat row that heads a screen.
 *
 * Numbers are the content, so they get the size and the primary ink; the label
 * recedes. `tnum` only where a column has to align.
 *
 * @module
 */

import { cn } from '../lib/utils.js'

/**
 * @param {{ label: string, value: any, hint?: any, tone?: string,
 *           className?: string }} props
 */
export function Stat({ label, value, hint, tone, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </div>
      <div
        className="tnum truncate text-xl font-semibold"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </div>
      {hint ? (
        <div className="truncate text-xs text-[var(--color-text-secondary)]">{hint}</div>
      ) : null}
    </div>
  )
}

/** @param {any} props */
export function StatRow({ className, ...props }) {
  return (
    <div className={cn('grid grid-cols-2 gap-6 sm:grid-cols-4', className)} {...props} />
  )
}
