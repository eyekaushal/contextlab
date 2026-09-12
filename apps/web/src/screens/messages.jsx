/**
 * Screen 3 — Messages.
 *
 * Every message in a turn, in order, with its token cost and category colour.
 * Selecting one opens it on the right: rendered, raw, and what we know about it.
 * Rendered is the default — a tool call read as `{command:npm install}` is the
 * form we hash and index, not the call anyone made.
 *
 * **The system prompt is Turn 0.** docs/DESIGN.md is emphatic about this — it is
 * routinely the largest single thing in the window and the prior tool never
 * showed it anywhere. So it is pinned above the conversation, expandable, with
 * its segments broken out.
 *
 * @module
 */

import { ArrowLeft, ChevronDown, ChevronRight, Repeat2 } from 'lucide-react'
import { useState } from 'react'
import { Rendered } from '../components/rendered-block.jsx'
import { Failed, Loading } from '../components/states.jsx'
import { Badge } from '../components/ui/badge.jsx'
import { Card } from '../components/ui/card.jsx'
import { useApi } from '../lib/api.js'
import { categoryColor, categoryLabel, exact, tokens } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import { cn } from '../lib/utils.js'

/**
 * @param {{ sessionId: string, version?: number }} props
 */
export function Messages({ sessionId, version }) {
  const encoded = encodeURIComponent(sessionId)
  const [turnId, setTurnId] = useState(/** @type {string | null} */ (null))
  const [selected, setSelected] = useState(/** @type {any} */ (null))
  const [promptOpen, setPromptOpen] = useState(false)

  const path = turnId
    ? `/api/sessions/${encoded}/messages?turn=${encodeURIComponent(turnId)}`
    : `/api/sessions/${encoded}/messages`
  const { data, error, loading } = useApi(path, { refreshKey: version })

  if (error) return <Failed message={error} />
  if (!data)
    return (
      <div className="px-5 py-4">
        <Loading />
      </div>
    )

  const messages = data.messages ?? []
  const turns = data.turns ?? []
  const systemPrompt = data.systemPrompt ?? { tokens: 0, segments: [] }
  const current = turnId ?? String(data.turn?.id ?? '')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-2 border-b border-[var(--color-border-subtle)] px-6 py-4">
        <button
          type="button"
          onClick={() => navigate(`/s/${encoded}`)}
          className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <ArrowLeft className="size-3" />
          Session overview
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Messages</h1>
          {turns.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1">
              {turns.map((/** @type {any} */ turn) => (
                <button
                  key={turn.id}
                  type="button"
                  onClick={() => {
                    setTurnId(String(turn.id))
                    setSelected(null)
                  }}
                  className={cn(
                    'tnum h-6 min-w-6 rounded px-1.5 text-xs',
                    String(turn.id) === current
                      ? 'bg-[var(--color-cat-system-prompt)] text-white'
                      : 'bg-[var(--color-gridline)] text-[var(--color-text-secondary)]',
                  )}
                >
                  {Number(turn.seq) + 1}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-h-0 space-y-2 overflow-y-auto border-r border-[var(--color-border-subtle)] p-4">
          <SystemPromptTurn
            systemPrompt={systemPrompt}
            open={promptOpen}
            onToggle={() => setPromptOpen((value) => !value)}
          />

          {loading && messages.length === 0 ? <Loading rows={4} /> : null}

          {messages.map((/** @type {any} */ message) => (
            <MessageCard
              key={message.index}
              message={message}
              selected={selected}
              onSelect={setSelected}
            />
          ))}
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          <Detail block={selected} />
        </div>
      </div>
    </div>
  )
}

/**
 * The system prompt, pinned above the conversation as Turn 0.
 *
 * @param {{ systemPrompt: any, open: boolean, onToggle: () => void }} props
 */
function SystemPromptTurn({ systemPrompt, open, onToggle }) {
  const segments = systemPrompt.segments ?? []
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <Card className="border-[var(--color-cat-system-prompt)]/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Chevron className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-[2px]"
          style={{ backgroundColor: categoryColor('system_prompt') }}
        />
        <span className="text-sm font-medium">Turn 0 · System prompt</span>
        <span className="tnum ml-auto text-xs text-[var(--color-text-secondary)]">
          {tokens(systemPrompt.tokens)}
        </span>
      </button>

      {open ? (
        <div className="space-y-1 border-t border-[var(--color-border-subtle)] px-3 py-2">
          {segments.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              No segments recorded for this turn.
            </p>
          ) : (
            segments.map((/** @type {any} */ segment) => (
              <div
                key={`${segment.kind}:${segment.label}`}
                className="flex items-center gap-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">
                  {segment.kind === 'base' ? 'Base tool prompt' : segment.label}
                </span>
                <span className="tnum text-[var(--color-text-muted)]">
                  {tokens(segment.tokens)}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </Card>
  )
}

/**
 * @param {{ message: any, selected: any, onSelect: (block: any) => void }} props
 */
function MessageCard({ message, selected, onSelect }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          {message.index + 1} · {message.role}
        </span>
        <span className="tnum ml-auto text-xs text-[var(--color-text-muted)]">
          {tokens(
            message.blocks.reduce(
              (/** @type {number} */ sum, /** @type {any} */ block) =>
                sum + measured(block),
              0,
            ),
          )}
        </span>
      </div>

      <div>
        {message.blocks.map((/** @type {any} */ block) => (
          <BlockRow
            key={block.id}
            block={block}
            active={selected?.id === block.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </Card>
  )
}

/**
 * @param {{ block: any, active: boolean, onSelect: (block: any) => void }} props
 */
function BlockRow({ block, active, onSelect }) {
  const label = block.toolName || categoryLabel(block.category)

  return (
    <button
      type="button"
      onClick={() => onSelect(block)}
      className={cn(
        'flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors',
        active ? 'bg-[var(--color-gridline)]' : 'hover:bg-[var(--color-gridline)]/60',
      )}
    >
      <span
        aria-hidden="true"
        className="mt-1 size-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: categoryColor(block.category) }}
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">
            {label}
          </span>
          {block.turnsPresent > 1 ? (
            // The point of the whole product, said quietly in a list: this
            // content has been paid for more than once.
            <Badge tone="warning" className="gap-0.5">
              <Repeat2 className="size-2.5" />
              {block.turnsPresent}×
            </Badge>
          ) : null}
        </span>
        <span className="mt-0.5 line-clamp-2 block font-mono text-xs leading-snug text-[var(--color-text-muted)]">
          {block.isImage ? '[image]' : block.preview || '—'}
        </span>
      </span>

      <span className="tnum shrink-0 text-xs text-[var(--color-text-muted)]">
        {tokens(measured(block))}
      </span>
    </button>
  )
}

/**
 * What this block's own text counts as.
 *
 * `tokens` is the block's share of what the provider billed for the entire
 * turn — the right basis for a chart about the bill, and the wrong number to
 * print beside nineteen characters of text.
 *
 * @param {any} block
 * @returns {number}
 */
function measured(block) {
  const estimated = Number(block.tokensEstimated)
  return Number.isFinite(estimated) && estimated > 0
    ? estimated
    : Number(block.tokens) || 0
}

/**
 * The right-hand pane: the selected block, in full.
 *
 * @param {{ block: any }} props
 */
function Detail({ block }) {
  const { data, loading } = useApi(block ? `/api/blocks/${block.id}` : null)
  const [raw, setRaw] = useState(false)

  if (!block) {
    return (
      <p className="py-16 text-center text-xs text-[var(--color-text-muted)]">
        Select a message to see it in full.
      </p>
    )
  }

  const full = data?.block
  const text = full?.text ?? ''

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-[2px]"
          style={{ backgroundColor: categoryColor(block.category) }}
        />
        <h2 className="text-sm font-medium">
          {block.toolName || categoryLabel(block.category)}
        </h2>
        <Badge>{block.blockType}</Badge>
        {block.turnsPresent > 1 ? (
          <Badge tone="warning">re-sent {block.turnsPresent}×</Badge>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <Meta label="Tokens" value={exact(measured(block))} />
        <Meta label="Characters" value={exact(block.chars)} />
        <Meta label="Role" value={block.role || '—'} />
        <Meta label="Category" value={categoryLabel(block.category)} />
        {block.filePath ? <Meta label="File" value={block.filePath} /> : null}
        {block.mcpServer ? <Meta label="MCP server" value={block.mcpServer} /> : null}
        {block.toolUseId ? <Meta label="Answers call" value={block.toolUseId} /> : null}
      </dl>

      <BilledShare block={block} />

      {block.turnsPresent > 1 ? (
        <p className="rounded border border-[var(--color-status-warning)]/40 bg-[color-mix(in_oklab,var(--color-status-warning)_8%,transparent)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)]">
          This was sent in {block.turnsPresent} turns —{' '}
          {exact(measured(block) * block.turnsPresent)} tokens in total, for{' '}
          {exact(measured(block))} tokens of content.
        </p>
      ) : null}

      <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-page)]">
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-2.5 py-1">
          <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            {loading ? 'Loading…' : 'Content'}
          </span>
          {/* Raw is never taken away — it is the thing that can be checked
              against the wire, and a rendered view that cannot be verified is
              a second thing to distrust. */}
          <div className="ml-auto flex items-center gap-0.5 text-xs">
            <Toggle active={!raw} onClick={() => setRaw(false)}>
              Rendered
            </Toggle>
            <Toggle active={raw} onClick={() => setRaw(true)}>
              Raw
            </Toggle>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-auto px-2.5 py-2">
          {raw ? (
            <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-[var(--color-text-secondary)]">
              {block.isImage ? '[image data is never stored]' : text || block.preview}
            </pre>
          ) : (
            <Rendered block={block} text={text || block.preview || ''} />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * @param {{ active: boolean, onClick: () => void, children: any }} props
 */
function Toggle({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded px-1.5 py-0.5',
        active
          ? 'bg-[var(--color-gridline)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
      )}
    >
      {children}
    </button>
  )
}

/**
 * @param {{ label: string, value: any }} props
 */
function Meta({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="truncate text-[var(--color-text-secondary)]" title={String(value)}>
        {value}
      </dd>
    </div>
  )
}

/**
 * The two numbers, and why they differ.
 *
 * A provider bills one figure for a whole turn. We divide it across the turn's
 * blocks in proportion to their size so the composition adds up. That share is
 * not a measurement of this block, and saying so is cheaper than letting
 * someone discover it and stop trusting the rest.
 *
 * @param {{ block: any }} props
 */
function BilledShare({ block }) {
  const counted = measured(block)
  const billed = Number(block.tokens) || 0
  // Only worth explaining when the two actually disagree.
  if (billed <= 0 || Math.abs(billed - counted) / Math.max(counted, 1) < 0.1) return null

  return (
    <p className="rounded border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)]">
      {exact(block.chars)} characters counts as{' '}
      <span className="text-[var(--color-text-secondary)]">{exact(counted)} tokens</span>.
      Your provider billed for the whole turn at once; this block's share of that bill is{' '}
      <span className="text-[var(--color-text-secondary)]">{exact(billed)}</span>, which
      is what the composition chart uses.
    </p>
  )
}
