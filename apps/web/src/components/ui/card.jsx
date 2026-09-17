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
        'bg-[var(--color-surface)] shadow-[0_1px_0_rgb(0_0_0/0.25)]',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The band across the top of a panel — the reference dashboard's panel head.
 * Raised a step from the body and separated by a hairline, so a title reads as
 * a title and not as the first line of the content.
 *
 * @param {any} props
 */
export function CardHeader({ className, ...props }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-t-[var(--radius-card)] border-b',
        'border-[var(--color-border-subtle)] bg-[var(--color-raised)] px-3 py-2',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A card's title, with the icon that names what kind of thing the card is.
 *
 * Section titles in the Gotham reference are small caps with a mark beside
 * them; the mark is what lets a reader find the section again without reading.
 *
 * @param {any} props
 */
export function CardTitle({ className, icon: Icon, children, ...props }) {
  return (
    <h2
      className={cn(
        'flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]',
        className,
      )}
      {...props}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="size-3.5 text-[var(--color-text-muted)]" />
      ) : null}
      {children}
    </h2>
  )
}

/** @param {any} props */
export function CardContent({ className, ...props }) {
  return <div className={cn('p-4', className)} {...props} />
}
