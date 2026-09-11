/**
 * Screen 4 — Optimize.
 *
 * Placeholder. Built in its own block: ranked waste, each row with the exact
 * config change and a copy button.
 *
 * @module
 */

/** @param {{ sessionId?: string, version?: number }} props */
export function Optimize({ sessionId }) {
  return (
    <div className="p-6 text-sm text-[var(--color-text-muted)]">
      Optimize{' '}
      {sessionId ? <code className="font-mono">{sessionId}</code> : 'across sessions'} —
      next block.
    </div>
  )
}
