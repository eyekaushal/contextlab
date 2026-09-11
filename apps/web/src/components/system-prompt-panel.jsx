/**
 * The system prompt panel.
 *
 * docs/DESIGN.md names this as the prior tool's biggest omission: the system
 * prompt is often the largest single block in the window — 47% in one observed
 * session — and it was never rendered anywhere. It is also the part a user can
 * most easily change.
 *
 * So the panel breaks it apart and marks each row as **yours** or **fixed**.
 * "Your preamble is 24,000 tokens" is a fact. "22,500 of it is CLAUDE.md, and
 * that file is yours" is a thing to go and do.
 *
 * Tool definitions are folded in here too. Our model counts them as their own
 * category, but from where the reader sits they are the same thing: a fixed
 * preamble re-sent on every single turn.
 *
 * @module
 */

import { Lock, Pencil } from 'lucide-react'
import { exact, percent, tokens } from '../lib/format.js'
import { cn } from '../lib/utils.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.jsx'

/**
 * Which rows the user can actually do something about.
 *
 * @type {Record<string, { owned: boolean, note: string }>}
 */
const OWNERSHIP = {
  base: { owned: false, note: 'fixed — set by the tool' },
  memory_file: { owned: true, note: 'yours' },
  injected: { owned: true, note: 'partly yours' },
  mcp_server: { owned: true, note: 'yours' },
  tools: { owned: false, note: 'built into the tool' },
}

/**
 * @param {{ segments: any[], mcpServers?: any[], builtInToolTokens?: number,
 *           contextTokens?: number, className?: string }} props
 */
export function SystemPromptPanel({
  segments = [],
  mcpServers = [],
  builtInToolTokens = 0,
  contextTokens = 0,
  className,
}) {
  const rows = buildRows(segments, mcpServers, builtInToolTokens)
  const total = rows.reduce((sum, row) => sum + row.tokens, 0)

  if (rows.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>System prompt</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-[var(--color-text-muted)]">
          Nothing recorded for this turn.
        </CardContent>
      </Card>
    )
  }

  const yours = rows.filter((row) => row.owned).reduce((sum, row) => sum + row.tokens, 0)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>System prompt</CardTitle>
        <span className="tnum text-xs text-[var(--color-text-muted)]">
          {exact(total)} tokens
          {contextTokens > 0 ? ` · ${percent(total / contextTokens)} of context` : ''}
        </span>
      </CardHeader>

      <CardContent className="space-y-1 pt-2">
        {rows.map((row) => (
          <Row key={row.key} row={row} total={total} />
        ))}

        <p className="pt-2 text-xs text-[var(--color-text-muted)]">
          {/* The number that matters: how much of this preamble is in the
              reader's hands, re-sent on every turn. */}
          <span className="text-[var(--color-text-secondary)]">
            {exact(yours)} tokens
          </span>{' '}
          of this is yours to change, on every turn.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * @param {{ row: any, total: number }} props
 */
function Row({ row, total }) {
  const share = total > 0 ? row.tokens / total : 0
  const Icon = row.owned ? Pencil : Lock

  return (
    <div className="group flex items-center gap-2.5 text-sm">
      <Icon
        aria-hidden="true"
        className={cn(
          'size-3 shrink-0',
          row.owned
            ? 'text-[var(--color-cat-system-prompt)]'
            : 'text-[var(--color-text-muted)]',
        )}
      />

      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          // Rows the reader controls carry the primary ink; fixed rows recede.
          row.owned
            ? 'text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-muted)]',
        )}
      >
        {row.label}
        {row.count > 1 ? (
          <span className="ml-1 text-[var(--color-text-muted)]">×{row.count}</span>
        ) : null}
      </span>

      {row.warning ? (
        <span className="shrink-0 text-[11px] text-[var(--color-status-warning)]">
          {row.warning}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100">
          {row.note}
        </span>
      )}

      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--color-gridline)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(2, share * 100)}%`,
            backgroundColor: row.owned
              ? 'var(--color-cat-system-prompt)'
              : 'var(--color-cat-other)',
          }}
        />
      </div>

      <span className="tnum w-16 shrink-0 text-right text-xs text-[var(--color-text-secondary)]">
        {tokens(row.tokens)}
      </span>
    </div>
  )
}

/**
 * Merge the stored prompt segments with the MCP servers, largest first.
 *
 * @param {any[]} segments
 * @param {any[]} mcpServers
 * @param {number} builtInToolTokens
 * @returns {any[]}
 */
function buildRows(segments, mcpServers, builtInToolTokens) {
  /** @type {any[]} */
  const rows = []

  for (const segment of segments) {
    const kind = String(segment.kind ?? 'base')
    const ownership = OWNERSHIP[kind] ?? OWNERSHIP.base
    rows.push({
      key: `segment:${kind}:${segment.label}`,
      label: kind === 'base' ? 'Base tool prompt' : segment.label,
      tokens: Number(segment.tokens) || 0,
      count: 1,
      owned: ownership.owned,
      note: ownership.note,
    })
  }

  for (const server of mcpServers) {
    const calls = Number(server.calls) || 0
    rows.push({
      key: `mcp:${server.entityName}`,
      label: `MCP: ${server.entityName}`,
      tokens: Number(server.definitionTokens) || Number(server.tokens) || 0,
      count: 1,
      owned: true,
      note: OWNERSHIP.mcp_server.note,
      // The single most actionable thing this panel can say.
      warning: calls === 0 ? 'never called this session' : undefined,
    })
  }

  if (builtInToolTokens > 0) {
    rows.push({
      key: 'tools:builtin',
      label: 'Built-in tool definitions',
      tokens: builtInToolTokens,
      count: 1,
      owned: false,
      note: OWNERSHIP.tools.note,
    })
  }

  return rows.filter((row) => row.tokens > 0).sort((a, b) => b.tokens - a.tokens)
}
