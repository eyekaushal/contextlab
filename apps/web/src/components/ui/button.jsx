/**
 * @module
 */

import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded text-sm font-medium transition-colors ' +
    'disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        solid:
          'bg-[var(--color-cat-system-prompt)] text-white hover:bg-[color-mix(in_oklab,var(--color-cat-system-prompt)_85%,white)]',
        ghost:
          'text-[var(--color-text-secondary)] hover:bg-[var(--color-gridline)] hover:text-[var(--color-text-primary)]',
        outline:
          'border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-baseline)] hover:text-[var(--color-text-primary)]',
      },
      size: {
        sm: 'h-7 px-2',
        md: 'h-8 px-3',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
)

/** @param {any} props */
export function Button({ className, variant, size, ...props }) {
  return (
    <button
      type="button"
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  )
}
