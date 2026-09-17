/**
 * Screen 2 — Session Overview.
 *
 * One turn at a time, because a context window is a per-turn thing: the session
 * total is what you spent, but the window is what you are living inside right
 * now.
 *
 * @module
 */

import {
  AlertTriangle,
  Coins,
  Gauge,
  HeartPulse,
  MessageSquare,
  MessagesSquare,
  PieChart,
  Wrench,
} from 'lucide-react'
import { useState } from 'react'
import { CompositionBar, CompositionLegend } from '../components/composition-bar.jsx'
import { ContextDiff } from '../components/context-diff.jsx'
import { ExportMenu } from '../components/export-menu.jsx'
import { Finding } from '../components/finding.jsx'
import { Health, healthOf } from '../components/health.jsx'
import { PageHeader } from '../components/page-header.jsx'
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
          icon={Gauge}
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
          icon={Coins}
          label="Turn cost"
          value={usd(current.equivalentCostUsd)}
          hint={`${usd(meta.equivalentCostUsd)} this session`}
        />
        <Stat
          icon={MessageSquare}
          label="Output"
          value={tokens(current.outputTokens)}
          hint={`${exact(meta.outputTokens ?? 0)} total`}
        />
        {/* The same card as the other three; the status and its number are
            one object inside it. */}
        <Stat
          icon={HeartPulse}
          label="Health"
          value={
            <Health
              className="text-sm"
              level={healthOf({
                contextShare: share,
                criticalFindings,
                findings: findings.length,
              })}
              note={`${totals.count} finding${totals.count === 1 ? '' : 's'}`}
            />
          }
          hint={
            totals.recoverableUsd > 0
              ? `${usd(totals.recoverableUsd)} recoverable`
              : 'nothing to recover'
          }
        />
      </StatRow>

      <TurnPicker turns={turns} current={turnId} onSelect={setSelected} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle icon={PieChart}>What is in the window</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle icon={AlertTriangle}>
            Findings
            {findings.length > 0 ? (
              <span className="tnum normal-case tracking-normal text-[var(--color-text-muted)]">
                · {totals.count}
              </span>
            ) : null}
          </CardTitle>
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
        </CardHeader>

        <CardContent className="space-y-3">
          {findings.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Nothing flagged for this session. None of the ten rules matched.
            </p>
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
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * @param {{ meta: any, sessionId: string }} props
 */
function Header({ meta, sessionId }) {
  return (
    <PageHeader
      title={meta.projectName || meta.tool || 'Session'}
      question="What is in this window?"
      note={[meta.tool, truncate(meta.model ?? '', 32), when(meta.lastSeenAt)]
        .filter(Boolean)
        .join(' · ')}
      back={{ to: '/', label: 'All sessions' }}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/s/${encodeURIComponent(sessionId)}/messages`)}
          >
            <MessagesSquare className="size-3" />
            Messages
          </Button>
          <ExportMenu sessionId={sessionId} />
        </>
      }
    />
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
