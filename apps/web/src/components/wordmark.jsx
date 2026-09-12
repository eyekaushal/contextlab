/**
 * The mark.
 *
 * A context window, drawn as what it actually is: a fixed-width bar, filled in
 * the order the categories are assigned, with the last slice empty because
 * there is always a little room left until suddenly there is not. It is the
 * same shape as the composition bar on every screen below it, which is the
 * point — the mark is a small copy of the thing the product shows you.
 *
 * Inline SVG rather than a file: four rectangles do not deserve a network
 * request, and the colours have to be the live palette so the mark can never
 * drift from the charts.
 *
 * @module
 */

import { cn } from '../lib/utils.js'

/** The four slices, in the fixed category order. The last is the empty room. */
const SLICES = [
  { x: 0, width: 9, color: 'var(--color-cat-tool-results)' },
  { x: 10, width: 5, color: 'var(--color-cat-system-prompt)' },
  { x: 16, width: 3, color: 'var(--color-cat-tool-definitions)' },
]

/**
 * @param {{ className?: string }} props
 */
export function Mark({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      fill="none"
    >
      <rect
        x="0.75"
        y="5.75"
        width="22.5"
        height="12.5"
        rx="2.25"
        stroke="var(--color-baseline)"
        strokeWidth="1.5"
      />
      {SLICES.map((slice) => (
        <rect
          key={slice.x}
          x={slice.x + 2.5}
          y="9"
          width={slice.width}
          height="6"
          rx="1"
          fill={slice.color}
        />
      ))}
    </svg>
  )
}

/**
 * @param {{ className?: string }} props
 */
export function Wordmark({ className }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Mark className="size-5" />
      <div className="min-w-0 leading-none">
        <div className="text-sm font-semibold tracking-tight">contextlab</div>
        <div className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
          what is filling the window
        </div>
      </div>
    </div>
  )
}
