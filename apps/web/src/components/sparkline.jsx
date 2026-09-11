/**
 * A sparkline, in inline SVG.
 *
 * Recharts is in the stack for real charts. This is sixty pixels wide and sits
 * in a table cell fifty times over — a charting library would bring axes,
 * tooltips and a responsive container to draw eight line segments.
 *
 * What it shows is whether a session's context grew, and how sharply. That
 * trend is the thing the sessions list is asked for: a window that climbs
 * steadily is about to become expensive.
 *
 * @module
 */

import { tokens } from '../lib/format.js'
import { cn } from '../lib/utils.js'

/**
 * @param {{ values: number[], width?: number, height?: number, limit?: number,
 *           className?: string }} props
 */
export function Sparkline({ values, width = 64, height = 18, limit, className }) {
  const points = (values ?? []).filter((value) => Number.isFinite(value))
  if (points.length < 2) {
    return (
      <span className={cn('inline-block text-[var(--color-text-muted)]', className)}>
        —
      </span>
    )
  }

  const high = Math.max(...points)
  const low = Math.min(...points)
  const span = high - low || 1
  const step = width / (points.length - 1)

  const path = points
    .map((value, index) => {
      const x = index * step
      // SVG y grows downward, so the tallest value has to sit at the top.
      const y = height - ((value - low) / span) * (height - 2) - 1
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const first = points[0] ?? 0
  const last = points[points.length - 1] ?? 0
  const growing = last > first

  // Red once the window is nearly full: at that point the trend is not a
  // curiosity, it is the thing about to interrupt the session.
  const full = limit ? last / limit : 0
  const stroke =
    full >= 0.9
      ? 'var(--color-status-critical)'
      : growing
        ? 'var(--color-status-warning)'
        : 'var(--color-status-good)'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={`Context ${growing ? 'grew' : 'held'} from ${tokens(first)} to ${tokens(last)} over ${points.length} turns`}
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={height - ((last - low) / span) * (height - 2) - 1}
        r="1.75"
        fill={stroke}
      />
    </svg>
  )
}
