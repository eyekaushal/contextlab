/**
 * Compare — *which session was worse, and where?*
 *
 * Promised by `docs/DESIGN.md` Screen 1 ("Multi-select → Compare") and never
 * built. `notes/BUILD-PLAN.md` deferred it to v2; the two documents
 * contradicted and the convenient reading won. This is that debt paid.
 *
 * One column per session, one row per figure, every number measured against a
 * baseline the reader chooses. Session-level only — turn-level drill-in moves
 * to a later version rather than being dropped.
 *
 * The delta is the point. A column of absolute numbers is five sessions shown
 * near each other; a column of signed differences is a comparison.
 *
 * @module
 */

import { ArrowLeft, Star, X } from 'lucide-react'
import { useState } from 'react'
import { Severity } from '../components/health.jsx'
import { Failed, Loading } from '../components/states.jsx'
import { Button } from '../components/ui/button.jsx'
import { Card } from '../components/ui/card.jsx'
import { useApi } from '../lib/api.js'
import {
  categoryColor,
  categoryLabel,
  exact,
  truncate,
  usd,
  when,
} from '../lib/format.js'
import { navigate } from '../lib/router.js'
import { cn } from '../lib/utils.js'

/**
 * The headline rows, above the category breakdown.
 *
 * `higherIsWorse` is per row rather than global: more turns is not a problem,
 * and colouring it red would say it was.
 *
 * @type {{ key: string, label: string, money?: boolean, higherIsWorse?: boolean,
 *          read: (column: any) => number }[]}
 */
const HEADLINE = [
  {
    key: 'spent',
    label: 'Spent',
    money: true,
    higherIsWorse: true,
    read: (column) => Number(column.session.equivalentCostUsd) || 0,
  },
  {
    key: 'recoverable',
    label: 'Recoverable',
    money: true,
    higherIsWorse: true,
    read: (column) => Number(column.total.recoverableUsd) || 0,
  },
  {
    key: 'potential',
    label: 'Potential',
    money: true,
    read: (column) => Number(column.total.potentialUsd) || 0,
  },
  {
    key: 'peak',
    label: 'Peak context',
    higherIsWorse: true,
    read: (column) => Number(column.session.peakContextTokens) || 0,
  },
  {
    key: 'turns',
    label: 'Turns',
    read: (column) => Number(column.session.turnCount) || 0,
  },
  {
    key: 'findings',
    label: 'Findings',
    higherIsWorse: true,
    read: (column) => Number(column.total.count) || 0,
  },
]

/**
 * @param {{ ids: string[], version?: number }} props
 */
export function Compare({ ids, version }) {
  const [baseline, setBaseline] = useState(0)

  const path =
    ids.length >= 2
      ? `/api/compare?${ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&')}`
      : null
  const { data, error } = useApi(path, { refreshKey: version })

  if (ids.length < 2) return <NotEnough count={ids.length} />
  if (error) return <Failed message={error} />
  if (!data)
    return (
      <div className="p-6">
        <Loading />
      </div>
    )

  const columns = /** @type {any[]} */ (data.columns ?? [])

  return (
    <div className="space-y-4 p-6">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
      >
        <ArrowLeft className="size-3" />
        All sessions
      </button>

      <header className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Compare</h1>
        <span className="text-xs text-[var(--color-text-muted)]">
          Which session was worse, and where?
        </span>
      </header>

      {data.missing ? (
        <p className="text-xs text-[var(--color-status-warning)]">
          {/* Said out loud rather than silently returning fewer columns. */}
          {data.missing.length} of the selected sessions could not be read and are not
          shown.
        </p>
      ) : null}

      <CompareTable
        columns={columns}
        categories={data.categories ?? []}
        baseline={baseline}
        onBaseline={setBaseline}
        onRemove={(/** @type {string} */ id) =>
          navigate(
            compareHref(
              columns
                .map((column) => String(column.session.id))
                .filter((other) => other !== id),
            ),
          )
        }
      />

      <WorstFindings columns={columns} />
    </div>
  )
}

/**
 * The comparison itself, with no knowledge of where the data came from.
 *
 * Separated from the fetch so the deltas can be tested — the thing this screen
 * exists for is the arithmetic between columns, and a component that can only
 * be exercised through a network round trip is a component nobody checks.
 *
 * @param {{ columns: any[], categories: string[], baseline: number,
 *           onBaseline: (index: number) => void,
 *           onRemove?: (id: string) => void }} props
 */
export function CompareTable({ columns, categories, baseline, onBaseline, onRemove }) {
  const base = columns[Math.min(Math.max(baseline, 0), columns.length - 1)]

  /**
   * @param {(column: any) => number} read
   * @param {boolean} [higherIsWorse]
   * @param {boolean} [money]
   */
  const row = (read, higherIsWorse, money) =>
    columns.map((column) => ({
      id: String(column.session.id),
      value: read(column),
      delta: column === base ? null : read(column) - read(base),
      higherIsWorse,
      money,
    }))

  return (
    <Card className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border-subtle)]">
            <th className="w-40 px-3 py-2 text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Measure
            </th>
            {columns.map((column, index) => (
              <ColumnHead
                key={column.session.id}
                column={column}
                isBaseline={column === base}
                onBaseline={() => onBaseline(index)}
                onRemove={
                  columns.length > 2 && onRemove
                    ? () => onRemove(String(column.session.id))
                    : undefined
                }
              />
            ))}
          </tr>
        </thead>

        <tbody>
          <SectionRow label="Totals" span={columns.length + 1} />
          {HEADLINE.map((measure) => (
            <Row
              key={measure.key}
              label={measure.label}
              cells={row(measure.read, measure.higherIsWorse, measure.money)}
            />
          ))}

          <SectionRow label="What filled the window" span={columns.length + 1} />
          {categories.map((category) => (
            <Row
              key={category}
              label={categoryLabel(category)}
              swatch={categoryColor(category)}
              cells={row((column) => Number(column.categories[category]) || 0, true)}
            />
          ))}
        </tbody>
      </table>
    </Card>
  )
}

/**
 * @param {{ column: any, isBaseline: boolean, onBaseline: () => void,
 *           onRemove?: () => void }} props
 */
function ColumnHead({ column, isBaseline, onBaseline, onRemove }) {
  const session = column.session
  const label = session.projectName || session.tool || session.id

  return (
    <th className="min-w-[10rem] px-3 py-2 text-left align-top font-normal">
      <div className="flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={() => navigate(`/s/${encodeURIComponent(session.id)}`)}
          className="text-left text-sm font-medium hover:text-[var(--color-cat-system-prompt)]"
        >
          {truncate(String(label), 22)}
        </button>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label} from the comparison`}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>

      <div className="text-[11px] text-[var(--color-text-muted)]">
        {session.tool} · {truncate(String(session.model ?? ''), 20)}
        <br />
        {when(session.lastSeenAt)}
      </div>

      {/* Which column everything is measured against is the reader's choice,
          so it is a control here rather than a rule on the server. */}
      <button
        type="button"
        onClick={onBaseline}
        aria-pressed={isBaseline}
        className={cn(
          'mt-1 inline-flex items-center gap-1 text-[11px]',
          isBaseline
            ? 'text-[var(--color-cat-system-prompt)]'
            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
        )}
      >
        <Star className={cn('size-3', isBaseline && 'fill-current')} />
        {isBaseline ? 'baseline' : 'set as baseline'}
      </button>
    </th>
  )
}

/**
 * @param {{ label: string, span: number }} props
 */
function SectionRow({ label, span }) {
  return (
    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-page)]">
      <td
        colSpan={span}
        className="px-3 py-1 text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]"
      >
        {label}
      </td>
    </tr>
  )
}

/**
 * @param {{ label: string, swatch?: string, cells: any[] }} props
 */
function Row({ label, swatch, cells }) {
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-0">
      <td className="px-3 py-1.5 text-[var(--color-text-secondary)]">
        <span className="flex items-center gap-1.5">
          {swatch ? (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-sm"
              style={{ backgroundColor: swatch }}
            />
          ) : null}
          {label}
        </span>
      </td>
      {cells.map((cell) => (
        <Cell key={cell.id} cell={cell} />
      ))}
    </tr>
  )
}

/**
 * @param {{ cell: any }} props
 */
function Cell({ cell }) {
  const shown = cell.money ? usd(cell.value) : exact(cell.value)

  return (
    <td className="px-3 py-1.5">
      <span className="tnum">{shown}</span>
      {cell.delta === null ? null : <Delta cell={cell} />}
    </td>
  )
}

/**
 * The signed difference from the baseline.
 *
 * Colour only where a direction actually means better or worse. More turns is
 * not a fault, so that row stays grey — painting it red would state something
 * untrue in the fastest-read channel on the page.
 *
 * @param {{ cell: any }} props
 */
function Delta({ cell }) {
  if (cell.delta === 0) {
    return <span className="ml-1.5 text-[11px] text-[var(--color-text-muted)]">same</span>
  }

  const worse = cell.higherIsWorse ? cell.delta > 0 : null
  const sign = cell.delta > 0 ? '+' : '−'
  const size = Math.abs(cell.delta)

  return (
    <span
      className={cn(
        'tnum ml-1.5 text-[11px]',
        worse === null
          ? 'text-[var(--color-text-muted)]'
          : worse
            ? 'text-[var(--color-status-critical)]'
            : 'text-[var(--color-status-good)]',
      )}
    >
      {sign}
      {cell.money ? usd(size) : exact(size)}
    </span>
  )
}

/**
 * @param {{ columns: any[] }} props
 */
function WorstFindings({ columns }) {
  if (columns.every((column) => column.topFindings.length === 0)) return null

  return (
    <Card className="overflow-x-auto p-3">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
        Worst findings
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map((column) => (
          <div key={column.session.id} className="min-w-0 space-y-1.5">
            <div className="text-xs font-medium">
              {truncate(
                String(column.session.projectName || column.session.tool || ''),
                24,
              )}
            </div>
            {column.topFindings.length === 0 ? (
              <p className="text-[11px] text-[var(--color-text-muted)]">
                Nothing to fix.
              </p>
            ) : (
              column.topFindings.map((/** @type {any} */ finding) => (
                <button
                  key={`${finding.rule}:${finding.title}`}
                  type="button"
                  onClick={() =>
                    navigate(`/s/${encodeURIComponent(column.session.id)}/optimize`)
                  }
                  className="flex w-full items-start gap-1.5 text-left text-[11px] hover:text-[var(--color-cat-system-prompt)]"
                >
                  <Severity severity={finding.severity} />
                  <span className="min-w-0 flex-1">{finding.title}</span>
                  <span className="tnum shrink-0">{usd(finding.wastedCostUsd)}</span>
                </button>
              ))
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

/**
 * @param {{ count: number }} props
 */
function NotEnough({ count }) {
  return (
    <div className="p-6">
      <Card className="flex flex-col items-center gap-2 py-14 text-center">
        <p className="text-sm">
          {count === 1 ? 'One session is not a comparison.' : 'Nothing selected.'}
        </p>
        <p className="max-w-sm text-xs text-[var(--color-text-muted)]">
          Tick two or more sessions on the sessions list and press Compare.
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate('/')}>
          All sessions
        </Button>
      </Card>
    </div>
  )
}

/**
 * The route for a comparison of these sessions.
 *
 * A query rather than a path segment: the list varies in length, and the ids
 * inside it contain a colon.
 *
 * @param {string[]} ids
 * @returns {string}
 */
export function compareHref(ids) {
  return `/compare?${ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&')}`
}
