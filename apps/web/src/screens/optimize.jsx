/**
 * Screen 4 — Optimize. *What do I change first?*
 *
 * The differentiator. Every other screen measures; this one says what to change.
 *
 * A ranked table rather than a stack of cards: the rows are sortable and
 * filterable, the whole set fits on one screen collapsed, and every row carries
 * its own arithmetic, its own fix and its own dismiss control. The header
 * states the reconciliation plainly — spent, recoverable, potential — three
 * numbers that do not pretend to add up to one.
 *
 * @module
 */

import { ArrowLeft, CircleCheck } from 'lucide-react'
import { FindingsTable } from '../components/findings-table.jsx'
import { Stat, StatRow } from '../components/stat.jsx'
import { Failed, Loading } from '../components/states.jsx'
import { Button } from '../components/ui/button.jsx'
import { Card } from '../components/ui/card.jsx'
import { useApi } from '../lib/api.js'
import { exact, truncate, usd } from '../lib/format.js'
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
  const { data, error, reload } = useApi('/api/optimize?limit=15', {
    refreshKey: version,
  })

  if (error) return <Failed message={error} />
  if (!data)
    return (
      <div className="px-5 py-4">
        <Loading />
      </div>
    )

  const reports = /** @type {any[]} */ (data.reports ?? [])

  // Flattened into one ranked list. Grouping by session buried the single most
  // expensive finding under whichever session happened to sort first.
  const rows = reports.flatMap((report) =>
    report.findings.map((/** @type {any} */ finding) => ({
      finding,
      sessionId: String(report.session.id),
      sessionLabel:
        report.session.projectName || report.session.tool || report.session.id,
    })),
  )

  return (
    <div className="space-y-3 px-5 py-4">
      <Header
        title="Optimize"
        question="What do I change first?"
        note={`${data.scanned} recent session${data.scanned === 1 ? '' : 's'} checked against ten rules. No model was called — every number here is arithmetic.`}
      />

      {rows.length === 0 ? (
        <Clean />
      ) : (
        <>
          <Totals total={data.total} spentUsd={data.total.spentUsd} />
          <FindingsTable rows={rows} showSession onChanged={reload} />
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
  const { data, error, reload } = useApi(`/api/sessions/${encoded}/optimize`, {
    refreshKey: version,
  })

  if (error) return <Failed message={error} />
  if (!data)
    return (
      <div className="px-5 py-4">
        <Loading />
      </div>
    )

  const findings = /** @type {any[]} */ (data.findings ?? [])
  const summary = data.summary ?? {}
  const rows = findings.map((finding) => ({ finding, sessionId }))

  return (
    <div className="space-y-3 px-5 py-4">
      <button
        type="button"
        onClick={() => navigate(`/s/${encoded}`)}
        className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
      >
        <ArrowLeft className="size-3" />
        Session overview
      </button>

      <Header
        title="Optimize"
        question="What do I change first?"
        note={`${summary.turnCount} turns · ${truncate(summary.model ?? '', 30)}`}
      />

      {findings.length === 0 ? (
        <Clean />
      ) : (
        <>
          <Totals total={data.total} spentUsd={summary.totalCostUsd} />
          <FindingsTable rows={rows} onChanged={reload} />
        </>
      )}
    </div>
  )
}

/**
 * @param {{ title: string, question: string, note: string }} props
 */
function Header({ title, question, note }) {
  return (
    <header>
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {/* Every screen answers one question, and says which one. */}
        <span className="text-xs text-[var(--color-text-muted)]">{question}</span>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">{note}</p>
    </header>
  )
}

/**
 * @param {{ total: any, spentUsd?: number }} props
 */
function Totals({ total, spentUsd }) {
  return (
    <Card className="p-3">
      {/* Three numbers that do not pretend to add up to one. Recoverable is
          money already spent that a change gives back; potential is a saving
          from a change not yet made. Summing them is what produced "$10.31
          recoverable" on a session that cost $6.08. */}
      <StatRow className="sm:grid-cols-4">
        <Stat label="Spent" value={usd(spentUsd ?? 0)} hint="equivalent API cost" />
        <Stat
          label="Recoverable"
          value={usd(total.recoverableUsd)}
          hint={`${exact(total.recoverableTokens)} tokens already paid for`}
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
          hint={
            total.dismissed > 0
              ? `${total.critical} critical · ${total.dismissed} dismissed`
              : `${total.critical} critical`
          }
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
