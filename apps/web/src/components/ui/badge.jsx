/**
 * Badge — a small label.
 *
 * A status variant always carries text. Colour alone never communicates state
 * here, per docs/DESIGN.md.
 *
 * @module
 */

import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

const badge = cva(
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium leading-none',
  {
    variants: {
      tone: {
        neutral: 'bg-[var(--color-gridline)] text-[var(--color-text-secondary)]',
        good: 'bg-[color-mix(in_oklab,var(--color-status-good)_22%,transparent)] text-[var(--color-status-good)]',
        warning:
          'bg-[color-mix(in_oklab,var(--color-status-warning)_20%,transparent)] text-[var(--color-status-warning)]',
        serious:
          'bg-[color-mix(in_oklab,var(--color-status-serious)_20%,transparent)] text-[var(--color-status-serious)]',
        critical:
          'bg-[color-mix(in_oklab,var(--color-status-critical)_22%,transparent)] text-[var(--color-status-critical)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

/** @param {any} props */
export function Badge({ className, tone, ...props }) {
  return <span className={cn(badge({ tone }), className)} {...props} />
}
