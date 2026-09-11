/**
 * @module
 */

import { cn } from '../../lib/utils.js'

/** @param {any} props */
export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'h-8 w-full rounded border border-[var(--color-border-subtle)] bg-[var(--color-page)]',
        'px-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]',
        'focus:border-[var(--color-cat-system-prompt)] focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}
