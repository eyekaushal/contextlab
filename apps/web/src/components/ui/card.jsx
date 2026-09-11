/**
 * Card — the surface every panel sits on.
 *
 * shadcn/ui is a pattern, not a dependency: these are written into the repo and
 * owned here, which is also why they are .jsx rather than the .tsx the shadcn
 * CLI emits.
 *
 * @module
 */

import { cn } from '../../lib/utils.js'

/** @param {any} props */
export function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--color-border-subtle)]',
        'bg-[var(--color-surface)]',
        className,
      )}
      {...props}
    />
  )
}

/** @param {any} props */
export function CardHeader({ className, ...props }) {
  return (
    <div
      className={cn('flex items-baseline justify-between gap-3 px-4 pt-4', className)}
      {...props}
    />
  )
}

/** @param {any} props */
export function CardTitle({ className, ...props }) {
  return (
    <h2
      className={cn(
        'text-sm font-medium tracking-tight text-[var(--color-text-secondary)]',
        className,
      )}
      {...props}
    />
  )
}

/** @param {any} props */
export function CardContent({ className, ...props }) {
  return <div className={cn('p-4', className)} {...props} />
}
