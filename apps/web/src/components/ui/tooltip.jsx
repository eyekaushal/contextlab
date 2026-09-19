/**
 * Tooltip — a sentence that appears on hover, and on keyboard focus.
 *
 * Every icon-only control gets one. An icon with no word next to it is a
 * guess, and the eye-off icon in the findings table was a guess nobody got
 * right: it dismisses a finding, and nothing on the screen said so.
 *
 * Shown on hover, and on `:focus-visible` — keyboard focus — but not on the
 * focus a click leaves behind. The first version used `focus-within`, so a
 * clicked nav entry kept its tooltip open until you clicked somewhere else. Now
 * a click hides it until the pointer leaves and comes back.
 *
 * Linked with `aria-describedby`, so a screen reader hears the sentence the
 * pointer would see.
 *
 * @module
 */

import { useId, useState } from 'react'
import { cn } from '../../lib/utils.js'

/**
 * @param {{ text: string, children: any, side?: 'top' | 'bottom' | 'left' | 'right',
 *           className?: string }} props
 */
export function Tooltip({ text, children, side = 'top', className }) {
  const id = useId()
  // Set by a click, cleared when the pointer leaves: a control that was just
  // used does not need explaining until it is approached again.
  const [dismissed, setDismissed] = useState(false)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only observes pointer events; the control inside stays the interactive element
    <span
      className={cn('group/tip relative inline-flex', className)}
      aria-describedby={id}
      onClickCapture={() => setDismissed(true)}
      onMouseLeave={() => setDismissed(false)}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 w-max max-w-60 rounded border px-2 py-1 text-xs leading-snug',
          'border-[var(--color-border-subtle)] bg-[var(--color-raised)] text-[var(--color-text-primary)] shadow-lg',
          'opacity-0 transition-opacity delay-150',
          !dismissed &&
            'group-hover/tip:opacity-100 group-has-[:focus-visible]/tip:opacity-100',
          side === 'top' && 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
          side === 'bottom' && 'top-full left-1/2 mt-1.5 -translate-x-1/2',
          side === 'left' && 'right-full top-1/2 mr-1.5 -translate-y-1/2',
          side === 'right' && 'left-full top-1/2 ml-1.5 -translate-y-1/2',
        )}
      >
        {text}
      </span>
    </span>
  )
}
