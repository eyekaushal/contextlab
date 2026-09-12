/**
 * The Cost screen: spend over time, by project, against a budget.
 *
 * Not one of the four screens in docs/DESIGN.md — it exists because budgets
 * need somewhere to live, and because the sidebar had a dead entry pointing at
 * a stub, which is worse than having no entry at all.
 *
 * @module
 */

import { useState } from 'react'
import { Stat, StatRow } from '../components/stat.jsx'
import { Failed, Loading } from '../components/states.jsx'
import { Badge } from '../components/ui/badge.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx'
import { url, useApi } from '../lib/api.js'
import { exact, percent, tokens, truncate, usd } from '../lib/format.js'
import { cn } from '../lib/utils.js'

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

/**
 * @param {{ version?: number }} props
 */
export function Cost({ version }) {
  const [days, setDays] = useState(30)

  const daily = useApi(url('/api/cost', { by: 'day', days }), { refreshKey: version })
  const projects = useApi('/api/cost?by=project', { refreshKey: version })
  const budget = useApi('/api/budget', { refreshKey: version })
  const pricing = useApi('/api/pricing', { refreshKey: version })

  if (daily.error) return <Failed message={daily.error} />
  if (!daily.data)
    return (
      <div className="px-5 py-4">
        <Loading />
      </div>
    )

  const rows = daily.data.rows ?? []
  const total = rows.reduce(
    (/** @type {number} */ sum, /** @type {any} */ row) =>
      sum + (Number(row.equivalentCostUsd) || 0),
    0,
  )
  const inputTokens = rows.reduce(
    (/** @type {number} */ sum, /** @type {any} */ row) =>
      sum + (Number(row.inputTokens) || 0),
    0,
  )
  const cached = rows.reduce(
    (/** @type {number} */ sum, /** @type {any} */ row) =>
      sum + (Number(row.cacheReadTokens) || 0),
    0,
  )
  const turns = rows.reduce(
    (/** @type {number} */ sum, /** @type {any} */ row) => sum + (Number(row.turns) || 0),
    0,
  )

  return (
    <div className="space-y-3 px-5 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Cost</h1>
          {pricing.data ? (
            // Prices move. A cost figure with no date on it implies a currency
            // it does not have.
            <p className="text-xs text-[var(--color-text-muted)]">
              Equivalent API cost · pricing as of {pricing.data.updatedAt}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => setDays(range.days)}
              className={cn(
                'h-7 rounded px-2 text-xs',
                days === range.days
                  ? 'bg-[var(--color-cat-system-prompt)] text-white'
                  : 'bg-[var(--color-gridline)] text-[var(--color-text-secondary)]',
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </header>

      <StatRow>
        <Stat label={`Last ${days} days`} value={usd(total)} hint={`${turns} turns`} />
        <Stat label="Input tokens" value={tokens(inputTokens)} />
        <Stat
          label="Served from cache"
          value={tokens(cached)}
          hint={
            inputTokens + cached > 0
              ? `${percent(cached / (inputTokens + cached))} of input`
              : undefined
          }
        />
        <Stat
          label="Per turn"
          value={turns > 0 ? usd(total / turns) : usd(0)}
          hint="average"
        />
      </StatRow>

      {budget.data ? <BudgetPanel data={budget.data} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>By day</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {rows.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              Nothing recorded in this range.
            </p>
          ) : (
            <DayChart rows={rows} />
          )}
        </CardContent>
      </Card>

      {projects.data?.rows?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>By project</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <ul className="space-y-1.5">
              {projects.data.rows.map((/** @type {any} */ row) => {
                const share = total > 0 ? (Number(row.equivalentCostUsd) || 0) / total : 0
                return (
                  <li key={row.project} className="flex items-center gap-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">
                      {truncate(row.project, 40)}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {row.sessions} session{row.sessions === 1 ? '' : 's'}
                    </span>
                    <div className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-[var(--color-gridline)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-cat-system-prompt)]"
                        style={{ width: `${Math.min(100, share * 100)}%` }}
                      />
                    </div>
                    <span className="tnum w-16 shrink-0 text-right">
                      {usd(row.equivalentCostUsd)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

/**
 * @param {{ data: any }} props
 */
function BudgetPanel({ data }) {
  if (!data.configured) {
    return (
      <Card className="p-4 text-xs text-[var(--color-text-muted)]">
        No budget set. Add one to{' '}
        <code className="font-mono">~/.contextlab/config.toml</code> and this panel tracks
        it:
        <pre className="mt-2 font-mono text-xs text-[var(--color-text-secondary)]">
          {'[budget]\ndaily = 5.00\nmonthly = 100.00'}
        </pre>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget</CardTitle>
        {data.alerts.length > 0 ? (
          <Badge tone={data.alerts[0].level === 'exceeded' ? 'critical' : 'warning'}>
            {data.alerts[0].title}
          </Badge>
        ) : (
          <Badge tone="good">Within budget</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-2 pt-2">
        {data.progress.map((/** @type {any} */ row) => (
          <div key={row.scope} className="flex items-center gap-2.5 text-sm">
            <span className="w-16 shrink-0 capitalize text-[var(--color-text-secondary)]">
              {row.scope}
            </span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-gridline)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, row.share * 100)}%`,
                  backgroundColor:
                    row.level === 'exceeded'
                      ? 'var(--color-status-critical)'
                      : row.level === 'warning'
                        ? 'var(--color-status-warning)'
                        : 'var(--color-status-good)',
                }}
              />
            </div>
            <span className="tnum w-28 shrink-0 text-right text-xs text-[var(--color-text-secondary)]">
              {usd(row.spent)} / {usd(row.limit)}
            </span>
          </div>
        ))}

        {data.billing?.mode === 'subscription' ? (
          <p className="pt-1 text-xs text-[var(--color-text-muted)]">
            {/* Budgets are stated in equivalent cost so they still mean
                something on a plan that bills nothing per turn. */}
            You are on a subscription, so nothing here is billed to you. These are
            equivalent API figures, useful for comparing sessions.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * @param {{ rows: any[] }} props
 */
function DayChart({ rows }) {
  const ordered = [...rows].reverse()
  const peak = Math.max(
    ...ordered.map((row) => Number(row.equivalentCostUsd) || 0),
    0.0001,
  )

  return (
    <div className="space-y-1">
      {ordered.map((row) => {
        const cost = Number(row.equivalentCostUsd) || 0
        return (
          <div key={row.day} className="flex items-center gap-2.5 text-xs">
            <span className="tnum w-20 shrink-0 text-[var(--color-text-muted)]">
              {row.day}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-[var(--color-gridline)]">
              <div
                className="h-full rounded bg-[var(--color-cat-tool-results)]"
                style={{ width: `${Math.max(1, (cost / peak) * 100)}%` }}
                title={`${exact(row.inputTokens)} input tokens`}
              />
            </div>
            <span className="tnum w-14 shrink-0 text-right text-[var(--color-text-secondary)]">
              {usd(cost)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
