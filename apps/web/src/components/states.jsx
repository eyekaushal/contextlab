/**
 * What a screen shows when it has nothing, is loading, or broke.
 *
 * An empty dashboard is the first thing a new user sees, so it says what to
 * type rather than "no data".
 *
 * @module
 */

import { Skeleton } from './ui/skeleton.jsx'

/**
 * @param {{ title: string, hint?: string, command?: string }} props
 */
export function Empty({ title, hint, command }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <p className="text-sm text-[var(--color-text-secondary)]">{title}</p>
      {hint ? <p className="text-xs text-[var(--color-text-muted)]">{hint}</p> : null}
      {command ? (
        <code className="mt-1 rounded bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-cat-system-prompt)]">
          {command}
        </code>
      ) : null}
    </div>
  )
}

/** @param {{ message: string }} props */
export function Failed({ message }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-20 text-center">
      <p className="text-sm text-[var(--color-status-critical)]">Could not load this.</p>
      <p className="font-mono text-xs text-[var(--color-text-muted)]">{message}</p>
    </div>
  )
}

/** @param {{ rows?: number }} props */
export function Loading({ rows = 5 }) {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders that never reorder
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  )
}
