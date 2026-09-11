/**
 * Screen 3 — Messages.
 *
 * Placeholder. Built in its own block, with the system prompt pinned as Turn 0.
 *
 * @module
 */

/** @param {{ sessionId: string, version?: number }} props */
export function Messages({ sessionId }) {
  return (
    <div className="p-6 text-sm text-[var(--color-text-muted)]">
      Messages for <code className="font-mono">{sessionId}</code> — next block.
    </div>
  )
}
