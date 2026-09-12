/**
 * Screen 4 — Optimize.
 *
 * The differentiator. Every other screen measures; this one says what to change.
 *
 * Ranked by money, because "what should I fix first" is a question about cost.
 * Every row carries the arithmetic behind its number and the exact config change
 * that removes it — a finding a reader cannot act on is a chart with extra steps.
 *
 * @module
 */

import { ArrowLeft, CircleCheck } from 'lucide-react'
import { Finding } from '../components/finding.jsx'
import { Stat, StatRow } from '../components/stat.jsx'
import { Failed, Loading } from '../components/states.jsx'
import { Button } from '../components/ui/button.jsx'
import { Card } from '../components/ui/card.jsx'
import { useApi } from '../lib/api.js'
import { exact, truncate, usd, when } from '../lib/format.js'
import { navigate } from '../lib/router.js'

/**
 * @param {{ sessionId?: string, version?: number }} props
 */
export function Optimize({ sessionId, version }) {
  return sessionId ? (
    <OneSession sessionId={sessionId} version={version} />
  ) : (
    <EverySession version={version} />
  )
}

/**
 * @param {{ version?: number }} props
 */
function EverySession({ version }) {
  const { data, error } = useApi('/api/optimize?limit=15', {
    refreshKey: version,
  })

  if (error) return <Failed message={error} />
  if (!data)
    return (
      <div className="p-6">
        <Loading />
      </div>
    )

  const reports = data.reports ?? []

  return (
    <div className="space-y-5 p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Optimize</h1>
        <p className="text-xs text-[var(--color-text-muted)]">
          {data.scanned} recent session{data.scanned === 1 ? '' : 's'} checked against ten
          rules. No model was called — every number here is arithmetic.
        </p>
      </header>

      {reports.length === 0 ? (
        <Clean />
      ) : (
        <>
          <Totals total={data.total} />

          {reports.map((/** @type {any} */ report) => (
            <section key={report.session.id} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border-subtle)] pb-1.5">
                <button
                  type="button"
                  onClick={() => navigate(`/s/${encodeURIComponent(report.session.id)}`)}
                  className="text-sm font-medium hover:text-[var(--color-cat-system-prompt)]"
                >
                  {report.session.projectName || report.session.tool || 'Session'}
                  <span className="ml-2 font-normal text-[var(--color-text-muted)]">
                    {truncate(report.session.model ?? '', 28)} ·{' '}
                    {report.session.turnCount} turns · {when(report.session.lastSeenAt)}
                  </span>
                </button>
                <span className="tnum text-sm font-semibold">
                  {usd(report.total.recoverableUsd)}
                </span>
              </div>

              {report.findings.map((/** @type {any} */ finding) => (
                <Finding key={`${finding.rule}:${finding.title}`} finding={finding} />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  )
}

/**
 * @param {{ sessionId: string, version?: number }} props
 */
function OneSession({ sessionId, version }) {
  const encoded = encodeURIComponent(sessionId)
  const { data, error } = useApi(`/api/sessions/${encoded}/optimize`, {
    refreshKey: version,
  })

  if (error) return <Failed message={error} />
  if (!data)
    return (
      <div className="p-6">
        <Loading />
      </div>
    )

  const findings = data.findings ?? []
  const summary = data.summary ?? {}

  return (
    <div className="space-y-5 p-6">
      <header className="space-y-2">
        <button
          type="button"
          onClick={() => navigate(`/s/${encoded}`)}
          className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <ArrowLeft className="size-3" />
          Session overview
        </button>
        <h1 className="text-lg font-semibold tracking-tight">Optimize</h1>
        <p className="text-xs text-[var(--color-text-muted)]">
          {summary.turnCount} turns · {truncate(summary.model ?? '', 30)} ·{' '}
          {usd(summary.totalCostUsd)} spent
        </p>
      </header>

      {findings.length === 0 ? (
        <Clean />
      ) : (
        <>
          <Totals total={data.total} spentUsd={summary.totalCostUsd} />
          {findings.map((/** @type {any} */ finding) => (
            <Finding key={`${finding.rule}:${finding.title}`} finding={finding} />
          ))}
        </>
      )}
    </div>
  )
}

/**
 * @param {{ total: any, spentUsd?: number }} props
 */
function Totals({ total, spentUsd }) {
  return (
    <Card className="p-4">
      {/* Three numbers that do not pretend to add up to one. Recoverable is
          money already spent that a change gives back; potential is a saving
          from a change not yet made. Summing them is what produced "$10.31
          recoverable" on a session that cost $6.08. */}
      <StatRow className="sm:grid-cols-4">
        <Stat label="Spent" value={usd(spentUsd ?? 0)} hint="equivalent API cost" />
        <Stat
          label="Recoverable"
          value={usd(total.recoverableUsd)}
          hint={`${exact(total.recoverableTokens)} tokens`}
          tone={total.recoverableUsd > 0 ? 'var(--color-status-warning)' : undefined}
        />
        <Stat
          label="Potential"
          value={usd(total.potentialUsd)}
          hint="from changes not yet made"
        />
        <Stat
          label="Findings"
          value={total.count}
          hint={`${total.critical} critical`}
          tone={total.critical > 0 ? 'var(--color-status-critical)' : undefined}
        />
      </StatRow>
    </Card>
  )
}

function Clean() {
  return (
    <Card className="flex flex-col items-center gap-2 py-14 text-center">
      <CircleCheck
        aria-hidden="true"
        className="size-5 text-[var(--color-status-good)]"
      />
      <p className="text-sm">Nothing to fix.</p>
      <p className="max-w-sm text-xs text-[var(--color-text-muted)]">
        None of the ten rules matched. That is a real result, not an empty state — run
        more sessions and check back as they grow.
      </p>
      <Button variant="outline" size="sm" onClick={() => navigate('/')}>
        All sessions
      </Button>
    </Card>
  )
}
