/**
 * Screen 2 — Session Overview.
 *
 * One turn at a time, because a context window is a per-turn thing: the session
 * total is what you spent, but the window is what you are living inside right
 * now.
 *
 * @module
 */

import { ArrowLeft, MessagesSquare, Wrench } from 'lucide-react'
import { useState } from 'react'
import { CompositionBar, CompositionLegend } from '../components/composition-bar.jsx'
import { ContextDiff } from '../components/context-diff.jsx'
import { ExportMenu } from '../components/export-menu.jsx'
import { Finding } from '../components/finding.jsx'
import { Health, healthOf } from '../components/health.jsx'
import { Stat, StatRow } from '../components/stat.jsx'
import { Failed, Loading } from '../components/states.jsx'
import { SystemPromptPanel } from '../components/system-prompt-panel.jsx'
import { Button } from '../components/ui/button.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx'
import { useApi } from '../lib/api.js'
import { exact, percent, tokens, truncate, usd, when } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import { cn } from '../lib/utils.js'

/**
 * @param {{ sessionId: string, version?: number }} props
 */
export function SessionOverview({ sessionId, version }) {
  const [selected, setSelected] = useState(/** @type {string | null} */ (null))
  const encoded = encodeURIComponent(sessionId)

  const session = useApi(`/api/sessions/${encoded}`, { refreshKey: version })
  const turns = session.data?.turns ?? []
  // Default to the latest turn: it is the window you are in right now.
  const turnId =
    selected ?? (turns.length > 0 ? String(turns[turns.length - 1].id) : null)

  const turn = useApi(turnId ? `/api/sessions/${encoded}/turns/${turnId}` : null, {
    refreshKey: version,
  })

  if (session.error) return <Failed message={session.error} />
  if (!session.data)
    return (
      <div className="px-5 py-4">
        <Loading />
      </div>
    )

  const meta = session.data.session ?? {}
  // A finding set aside on Optimize must not occupy one of the three slots
  // here, or the "Showing 3 of 9" line disagrees with the count beside it.
  const findings = /** @type {any[]} */ (session.data.findings ?? []).filter(
    (/** @type {any} */ finding) => !finding.dismissedAt,
  )
  const current = turn.data?.turn ?? turns[turns.length - 1] ?? {}

  const contextTokens = Number(current.contextTokens) || 0
  const limit = Number(meta.contextLimit) || 0
  const share = limit > 0 ? contextTokens / limit : 0

  const composition = turn.data?.composition ?? session.data.composition ?? []
  const segments = turn.data?.systemSegments ?? session.data.systemSegments ?? []
  const attribution = turn.data?.attribution ?? session.data.attribution ?? []

  const mcpServers = attribution.filter(
    (/** @type {any} */ row) => row.entityType === 'mcp_server',
  )
  const builtInTools = attribution
    .filter(
      (/** @type {any} */ row) =>
        row.entityType === 'tool' && !row.entityName.startsWith('mcp__'),
    )
    .reduce(
      (/** @type {number} */ sum, /** @type {any} */ row) =>
        sum + (Number(row.definitionTokens) || 0),
      0,
    )

  // Counts come from the API's reconciled totals, not from this screen's own
  // arithmetic over a list it is about to truncate.
  const totals = session.data.total ?? {
    count: findings.length,
    critical: 0,
    recoverableUsd: 0,
  }
  const criticalFindings = Number(totals.critical) || 0
  const SHOWN = 3

  return (
    <div className="space-y-3 px-5 py-4">
      <Header meta={meta} sessionId={sessionId} />

      <StatRow>
        <Stat
          label="Context"
          value={
            <>
              {tokens(contextTokens)}
              {limit > 0 ? (
                <span className="ml-1.5 text-sm font-normal text-[var(--color-text-muted)]">
                  {percent(share)}
                </span>
              ) : null}
            </>
          }
          hint={limit > 0 ? `of ${tokens(limit)}` : 'limit unknown'}
          tone={
            share >= 0.9
              ? 'var(--color-status-critical)'
              : share >= 0.8
                ? 'var(--color-status-warning)'
                : undefined
          }
        />
        <Stat
          label="Turn cost"
          value={usd(current.equivalentCostUsd)}
          hint={`${usd(meta.equivalentCostUsd)} this session`}
        />
        <Stat
          label="Output"
          value={tokens(current.outputTokens)}
          hint={`${exact(meta.outputTokens ?? 0)} total`}
        />
        <div>
          <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            Health
          </div>
          <div className="mt-1.5">
            {/* The status and its number are one object. A chip with the count
                floating underneath made the reader do the joining. */}
            <Health
              level={healthOf({
                contextShare: share,
                criticalFindings,
                findings: findings.length,
              })}
              note={`${totals.count} finding${totals.count === 1 ? '' : 's'}`}
            />
          </div>
          {totals.recoverableUsd > 0 ? (
            <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {usd(totals.recoverableUsd)} recoverable
            </div>
          ) : null}
        </div>
      </StatRow>

      <TurnPicker turns={turns} current={turnId} onSelect={setSelected} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What is in the window</CardTitle>
            <span className="tnum text-xs text-[var(--color-text-muted)]">
              {exact(contextTokens)} tokens
            </span>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <CompositionBar rows={composition} total={contextTokens} />
            <CompositionLegend rows={composition} total={contextTokens} />
          </CardContent>
        </Card>

        <SystemPromptPanel
          segments={segments}
          mcpServers={mcpServers}
          builtInToolTokens={builtInTools}
          contextTokens={contextTokens}
        />
      </div>

      <ContextDiff rows={turn.data?.delta ?? []} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-[var(--color-text-secondary)]">
            Findings
          </h2>
          {findings.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/s/${encoded}/optimize`)}
            >
              <Wrench className="size-3" />
              Optimize
            </Button>
          ) : null}
        </div>

        {findings.length === 0 ? (
          <Card className="p-4 text-xs text-[var(--color-text-muted)]">
            Nothing flagged for this session. None of the ten rules matched.
          </Card>
        ) : (
          <>
            {findings.slice(0, SHOWN).map((/** @type {any} */ finding) => (
              <Finding key={`${finding.rule}:${finding.title}`} finding={finding} />
            ))}

            {/* Never truncate silently. The header says nine; this says which
                nine you are looking at. */}
            {findings.length > SHOWN ? (
              <button
                type="button"
                onClick={() => navigate(`/s/${encoded}/optimize`)}
                className="w-full rounded border border-dashed border-[var(--color-border-subtle)] py-2 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-baseline)] hover:text-[var(--color-text-primary)]"
              >
                Showing {SHOWN} of {findings.length} · view all
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}

/**
 * @param {{ meta: any, sessionId: string }} props
 */
function Header({ meta, sessionId }) {
  return (
    <header className="space-y-2">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
      >
        <ArrowLeft className="size-3" />
        All sessions
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {meta.projectName || meta.tool || 'Session'}
          </h1>
          <p className="truncate text-xs text-[var(--color-text-muted)]">
            {[meta.tool, truncate(meta.model ?? '', 32), when(meta.lastSeenAt)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/s/${encodeURIComponent(sessionId)}/messages`)}
          >
            <MessagesSquare className="size-3" />
            Messages
          </Button>
          <ExportMenu sessionId={sessionId} />
        </div>
      </div>
    </header>
  )
}

/**
 * @param {{ turns: any[], current: string | null,
 *           onSelect: (id: string) => void }} props
 */
function TurnPicker({ turns, current, onSelect }) {
  if (turns.length < 2) return null

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        Turn
      </span>
      {turns.map((/** @type {any} */ turn) => {
        const active = String(turn.id) === current
        return (
          <button
            key={turn.id}
            type="button"
            onClick={() => onSelect(String(turn.id))}
            title={`${exact(turn.contextTokens)} tokens`}
            className={cn(
              'tnum h-6 min-w-6 rounded px-1.5 text-xs transition-colors',
              active
                ? 'bg-[var(--color-cat-system-prompt)] text-white'
                : 'bg-[var(--color-gridline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            )}
          >
            {Number(turn.seq) + 1}
          </button>
        )
      })}
    </div>
  )
}
