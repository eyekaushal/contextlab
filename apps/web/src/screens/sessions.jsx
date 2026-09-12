/**
 * Screen 1 — Sessions. *Where did my money go?*
 *
 * Every session, with the one thing the prior tool could not do: search across
 * what was actually said, rather than matching a session id nobody remembers.
 *
 * A summary strip states the position before the table lists the rows, and the
 * columns sort — a table you cannot rank is a list, and the question this
 * screen answers is which session deserves attention.
 *
 * @module
 */

import { ArrowDown, GitCompare, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EntityMatches } from '../components/entity-matches.jsx'
import { ExportMenu } from '../components/export-menu.jsx'
import { Severity } from '../components/health.jsx'
import { Sparkline } from '../components/sparkline.jsx'
import { Empty, Failed, Loading } from '../components/states.jsx'
import { SummaryStrip } from '../components/summary-strip.jsx'
import { Button } from '../components/ui/button.jsx'
import { Card } from '../components/ui/card.jsx'
import { Input } from '../components/ui/input.jsx'
import { url, useApi } from '../lib/api.js'
import { percent, tokens, truncate, usd, when } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import { cn } from '../lib/utils.js'
import { compareHref } from './compare.jsx'

/** Long enough that typing does not fire a query per keystroke. */
const DEBOUNCE_MS = 200

/** Matches the server's ceiling. Past six columns a comparison is a spreadsheet. */
const MAX_COMPARE = 6

/**
 * The table, declared once.
 *
 * `sort` is the key the server orders by; a column without one is not sortable,
 * because sorting a page of rows in the browser would quietly reorder a subset
 * and call it a ranking.
 *
 * @type {{ key: string, label: string, sort?: string, align?: string }[]}
 */
export const COLUMNS = [
  { key: 'tool', label: 'Source' },
  { key: 'model', label: 'Model' },
  { key: 'project', label: 'Directory' },
  { key: 'turns', label: 'Turns', sort: 'turns', align: 'right' },
  { key: 'context', label: 'Context', sort: 'context', align: 'right' },
  { key: 'cost', label: 'Cost', sort: 'cost', align: 'right' },
  { key: 'findings', label: 'Findings', sort: 'recoverable' },
  { key: 'trend', label: 'Trend' },
  { key: 'time', label: 'Time', sort: 'recent', align: 'right' },
]

/**
 * @param {{ version?: number }} props
 */
export function Sessions({ version }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filters, setFilters] = useState({ tool: '', model: '', project: '' })
  const [sort, setSort] = useState('recent')
  const [selected, setSelected] = useState(/** @type {string[]} */ ([]))

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const options = useApi('/api/filters', { refreshKey: version })
  const summary = useApi('/api/summary', { refreshKey: version })
  // Only asked for when there is a term. Search covers what a session is made
  // of as well as what was said inside it.
  const matches = useApi(debounced ? url('/api/search', { q: debounced }) : null, {
    refreshKey: version,
  })
  const { data, error, loading } = useApi(
    url('/api/sessions', { limit: 100, q: debounced, sort, ...filters }),
    { refreshKey: version },
  )

  const sessions = data?.sessions ?? []
  const filtered = debounced || filters.tool || filters.model || filters.project

  /** @param {string} id */
  function toggle(id) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((other) => other !== id)
        : current.length >= MAX_COMPARE
          ? current
          : [...current, id],
    )
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Sessions</h1>
          {/* Every screen answers one question, and says which one. */}
          <span className="text-xs text-[var(--color-text-muted)]">
            Where did my money go?
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox value={query} onChange={setQuery} />
          <ExportMenu />
        </div>
      </header>

      <SummaryStrip data={summary.data} onOpenOptimize={() => navigate('/optimize')} />

      <Filters
        options={options.data}
        value={filters}
        onChange={setFilters}
        onClear={() => {
          setFilters({ tool: '', model: '', project: '' })
          setQuery('')
        }}
        active={Boolean(filtered)}
      />

      <EntityMatches entities={matches.data?.entities ?? []} query={debounced} />

      {error ? <Failed message={error} /> : null}
      {loading && !data ? <Loading /> : null}

      {!error && !loading && sessions.length === 0 ? (
        filtered ? (
          <Empty
            title={
              debounced
                ? (matches.data?.entities ?? []).length > 0
                  ? `No session message matches “${debounced}”.`
                  : `Nothing matches “${debounced}”.`
                : 'Nothing matches those filters.'
            }
            hint={
              (matches.data?.entities ?? []).length > 0
                ? 'It does match findings and entities — those are listed above.'
                : 'Search covers every message, tool call and result, plus findings, tools, MCP servers and files.'
            }
          />
        ) : (
          <Empty
            title="No sessions captured yet."
            hint="Run an agent through the proxy and this fills in as it goes."
            command="contextlab claude"
          />
        )
      ) : null}

      {sessions.length > 0 ? (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="w-8 px-3 py-2">
                    <span className="sr-only">Select for comparison</span>
                  </th>
                  {COLUMNS.map((column) => (
                    <Column
                      key={column.key}
                      column={column}
                      sort={sort}
                      onSort={setSort}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((/** @type {any} */ session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    query={debounced}
                    selected={selected.includes(String(session.id))}
                    atLimit={selected.length >= MAX_COMPARE}
                    onToggle={() => toggle(String(session.id))}
                  />
                ))}
              </tbody>
            </table>
          </Card>

          <CompareBar
            selected={selected}
            onClear={() => setSelected([])}
            onCompare={() => navigate(compareHref(selected))}
          />

          <p className="text-xs text-[var(--color-text-muted)]">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
            {debounced ? ` matching “${debounced}”` : ''}
            {sort !== 'recent' ? `, by ${SORT_LABEL[sort] ?? sort}` : ''}
          </p>
        </>
      ) : null}
    </div>
  )
}

/**
 * @param {{ session: any, query: string, selected: boolean, atLimit: boolean,
 *           onToggle: () => void }} props
 */
function SessionRow({ session, query, selected, atLimit, onToggle }) {
  const limit = Number(session.contextLimit) || 0
  const peak = Number(session.peakContextTokens) || 0
  const share = limit > 0 ? peak / limit : 0

  const findings = Number(session.findingCount) || 0
  const recoverable = Number(session.recoverableCostUsd) || 0

  return (
    <>
      <tr
        onClick={() => navigate(`/s/${encodeURIComponent(session.id)}`)}
        className={cn(
          'cursor-pointer border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-gridline)]',
          selected && 'bg-[var(--color-gridline)]',
        )}
      >
        <td className="px-3 py-2">
          {/* The click stops here: ticking a box and being navigated away from
              the list you are ticking is the worst answer to either gesture. */}
          <input
            type="checkbox"
            checked={selected}
            disabled={!selected && atLimit}
            onClick={(/** @type {any} */ event) => event.stopPropagation()}
            onChange={onToggle}
            aria-label={`Select ${session.projectName || session.tool || session.id} for comparison`}
          />
        </td>
        <td className="px-3 py-2">{session.tool || '—'}</td>
        <td className="px-3 py-2 text-[var(--color-text-secondary)]">
          {truncate(session.model || '—', 26)}
        </td>
        <td className="px-3 py-2 text-[var(--color-text-secondary)]">
          {session.projectName || (
            <span className="text-[var(--color-text-muted)]">unknown</span>
          )}
        </td>
        <td className="tnum px-3 py-2 text-right">{session.turnCount}</td>
        <td className="tnum px-3 py-2 text-right">
          {tokens(peak)}
          {limit > 0 ? (
            <span
              className={cn(
                'ml-1.5',
                share >= 0.9
                  ? 'text-[var(--color-status-critical)]'
                  : share >= 0.8
                    ? 'text-[var(--color-status-warning)]'
                    : 'text-[var(--color-text-muted)]',
              )}
            >
              {percent(share)}
            </span>
          ) : null}
        </td>
        <td className="tnum px-3 py-2 text-right">{usd(session.equivalentCostUsd)}</td>
        {/* The worst finding still standing, not a score derived from a count.
            A score hid which of two "warning" sessions had a critical in it. */}
        <td className="px-3 py-2">
          {findings === 0 ? (
            <span className="text-xs text-[var(--color-text-muted)]">clean</span>
          ) : (
            <div className="flex items-center gap-1.5">
              <Severity severity={session.worstSeverity ?? 'info'} />
              <span className="tnum text-xs text-[var(--color-text-secondary)]">
                {findings}
                {recoverable > 0 ? ` · ${usd(recoverable)}` : ''}
              </span>
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          <Sparkline values={session.trend} limit={limit} />
        </td>
        <td className="px-3 py-2 text-right text-[var(--color-text-muted)]">
          {when(session.lastSeenAt)}
        </td>
      </tr>

      {query && session.snippet ? (
        <tr className="border-b border-[var(--color-border-subtle)] last:border-0">
          <td colSpan={10} className="px-3 pb-2 text-xs">
            {/* What matched, and how often — otherwise a filtered list is a
                claim the reader has to take on trust. */}
            <span className="text-[var(--color-text-muted)]">
              {session.matches} match{session.matches === 1 ? '' : 'es'} ·{' '}
            </span>
            <Snippet text={session.snippet} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

/**
 * The selection, and the one thing you can do with it.
 *
 * Sticky rather than at the top of the page, because a selection made at row
 * forty needs its action within reach of row forty.
 *
 * @param {{ selected: string[], onClear: () => void, onCompare: () => void }} props
 */
function CompareBar({ selected, onClear, onCompare }) {
  if (selected.length === 0) return null

  const ready = selected.length >= 2

  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 shadow-lg">
      <span className="text-xs text-[var(--color-text-secondary)]">
        {selected.length} selected
        {ready ? '' : ' · pick one more to compare'}
        {selected.length >= MAX_COMPARE ? ` · ${MAX_COMPARE} is the most` : ''}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text-primary)] hover:underline"
        >
          Clear
        </button>
        <Button size="sm" variant="outline" disabled={!ready} onClick={onCompare}>
          <GitCompare className="size-3" />
          Compare {selected.length}
        </Button>
      </div>
    </div>
  )
}

/** How a sort reads in the count line under the table. */
/** @type {Record<string, string>} */
const SORT_LABEL = {
  cost: 'cost',
  recoverable: 'recoverable',
  turns: 'turns',
  context: 'peak context',
  oldest: 'oldest first',
}

/**
 * A column heading, which sorts if the server can order by it.
 *
 * One arrow, always descending: every sort here answers "which is the most",
 * and an ascending toggle on "cost" is a question nobody asks. Clicking the
 * active column returns to most recent.
 *
 * @param {{ column: any, sort: string, onSort: (key: string) => void }} props
 */
export function Column({ column, sort, onSort }) {
  const align = column.align === 'right' ? 'text-right' : 'text-left'
  if (!column.sort) {
    return <th className={cn('px-3 py-2 font-medium', align)}>{column.label}</th>
  }

  const active = sort === column.sort
  return (
    <th className={cn('px-3 py-2 font-medium', align)}>
      <button
        type="button"
        aria-label={`Sort by ${column.label}`}
        aria-pressed={active}
        onClick={() => onSort(active ? 'recent' : column.sort)}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide',
          column.align === 'right' ? 'flex-row-reverse' : '',
          active
            ? 'text-[var(--color-text-primary)]'
            : 'hover:text-[var(--color-text-secondary)]',
        )}
      >
        {column.label}
        <ArrowDown
          aria-hidden="true"
          className={cn('size-3', active ? 'opacity-100' : 'opacity-0')}
        />
      </button>
    </th>
  )
}

/**
 * FTS5 wraps matches in square brackets. Rendering them as marks rather than
 * literal brackets is the difference between a result and a readable one.
 *
 * @param {{ text: string }} props
 */
function Snippet({ text }) {
  // Keyed by character offset rather than loop position: the offset is a real
  // identity for a piece of text, and a loop index is not.
  /** @type {{ key: string, part: string, hit: boolean }[]} */
  const parts = []
  let offset = 0
  for (const part of String(text).split(/(\[[^\]]*\])/g)) {
    if (part) {
      parts.push({
        key: `${offset}`,
        part,
        hit: part.startsWith('[') && part.endsWith(']'),
      })
    }
    offset += part.length
  }

  return (
    <span className="font-mono text-[var(--color-text-secondary)]">
      {parts.map(({ key, part, hit }) =>
        hit ? (
          <mark
            key={key}
            className="rounded bg-[color-mix(in_oklab,var(--color-cat-system-prompt)_35%,transparent)] px-0.5 text-[var(--color-text-primary)]"
          >
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={key}>{part}</span>
        ),
      )}
    </span>
  )
}

/**
 * @param {{ value: string, onChange: (value: string) => void }} props
 */
function SearchBox({ value, onChange }) {
  return (
    <div className="relative w-full max-w-sm">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-text-muted)]"
      />
      <Input
        value={value}
        onChange={(/** @type {any} */ event) => onChange(event.target.value)}
        placeholder="Search every message, call and result"
        aria-label="Search session content"
        className="pl-7 pr-7"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

/**
 * @param {{ options: any, value: any, onChange: (value: any) => void,
 *           onClear: () => void, active: boolean }} props
 */
function Filters({ options, value, onChange, onClear, active }) {
  const tools = options?.tools ?? []
  const models = options?.models ?? []
  const projects = options?.projects ?? []

  // Nothing to filter by until more than one of something exists.
  if (tools.length < 2 && models.length < 2 && projects.length < 2 && !active) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        label="Source"
        value={value.tool}
        options={tools.map((/** @type {string} */ tool) => ({
          value: tool,
          label: tool,
        }))}
        onChange={(/** @type {string} */ tool) => onChange({ ...value, tool })}
      />
      <Select
        label="Model"
        value={value.model}
        options={models.map((/** @type {string} */ model) => ({
          value: model,
          label: truncate(model, 28),
        }))}
        onChange={(/** @type {string} */ model) => onChange({ ...value, model })}
      />
      <Select
        label="Project"
        value={value.project}
        options={projects.map((/** @type {any} */ project) => ({
          value: project.path,
          label: project.name,
        }))}
        onChange={(/** @type {string} */ project) => onChange({ ...value, project })}
      />

      {active ? (
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text-primary)] hover:underline"
        >
          Clear
        </button>
      ) : null}
    </div>
  )
}

/**
 * @param {{ label: string, value: string, options: any[],
 *           onChange: (value: string) => void }} props
 */
function Select({ label, value, options, onChange }) {
  if (options.length === 0) return null
  return (
    <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-7 rounded border border-[var(--color-border-subtle)] bg-[var(--color-page)]',
          'px-1.5 text-xs text-[var(--color-text-primary)]',
          value ? 'border-[var(--color-cat-system-prompt)]' : '',
        )}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
