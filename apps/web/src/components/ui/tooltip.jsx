/**
 * Tooltip — a sentence that appears on hover or focus.
 *
 * Every icon-only control gets one. An icon with no word next to it is a
 * guess, and the eye-off icon in the findings table was a guess nobody got
 * right: it dismisses a finding, and nothing on the screen said so.
 *
 * Plain CSS, no positioning library: shown on `:hover` and `:focus-within` of
 * the wrapper, so the keyboard gets it too. Linked with `aria-describedby`, so
 * a screen reader hears the sentence the pointer would see.
 *
 * @module
 */

import { useId } from 'react'
import { cn } from '../../lib/utils.js'

/**
 * @param {{ text: string, children: any, side?: 'top' | 'bottom' | 'left',
 *           className?: string }} props
 */
export function Tooltip({ text, children, side = 'top', className }) {
  const id = useId()

  return (
    <span
      className={cn('group/tip relative inline-flex', className)}
      aria-describedby={id}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 w-max max-w-60 rounded border px-2 py-1 text-xs leading-snug',
          'border-[var(--color-border-subtle)] bg-[var(--color-raised)] text-[var(--color-text-primary)] shadow-lg',
          'opacity-0 transition-opacity delay-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100',
          side === 'top' && 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
          side === 'bottom' && 'top-full left-1/2 mt-1.5 -translate-x-1/2',
          side === 'left' && 'right-full top-1/2 mr-1.5 -translate-y-1/2',
        )}
      >
        {text}
      </span>
    </span>
  )
}
