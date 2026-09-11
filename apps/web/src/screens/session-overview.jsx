/**
 * Screen 2 — Session Overview.
 *
 * Placeholder. Built in its own block: stat row, composition, the system
 * prompt panel, findings and the context diff.
 *
 * @module
 */

/** @param {{ sessionId: string, version?: number }} props */
export function SessionOverview({ sessionId }) {
  return (
    <div className="p-6 text-sm text-[var(--color-text-muted)]">
      Session overview for <code className="font-mono">{sessionId}</code> — next block.
    </div>
  )
}
