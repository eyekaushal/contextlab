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

import {
  ArrowDown,
  Bot,
  Gem,
  GitCompare,
  Sparkles,
  TerminalSquare,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { ChartsRow } from '../components/charts-row.jsx'
import { EntityMatches } from '../components/entity-matches.jsx'
import { Severity } from '../components/health.jsx'
import { PageHeader } from '../components/page-header.jsx'
import { SessionFilters } from '../components/session-filters.jsx'
import { Sparkline } from '../components/sparkline.jsx'
import { Empty, Failed, Loading } from '../components/states.jsx'
import { SummaryStrip } from '../components/summary-strip.jsx'
import { Button } from '../components/ui/button.jsx'
import { Card } from '../components/ui/card.jsx'
import { url, useApi } from '../lib/api.js'
import { percent, tokens, usd, when } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import { cn } from '../lib/utils.js'
import { compareHref } from './compare.jsx'

/** Long enough that typing does not fire a query per keystroke. */
const DEBOUNCE_MS = 200

/** Matches the server's ceiling. Past six columns a comparison is a spreadsheet. */
const MAX_COMPARE = 6

/**
 * A mark per source, so a row is recognisable before its first word is read.
 *
 * @type {Record<string, any>}
 */
const SOURCE_ICON = {
  claude: Sparkles,
  codex: TerminalSquare,
  gemini: Gem,
}

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
 * @param {{ version?: number, initialQuery?: string, selecting?: boolean }} props
 */
export function Sessions({ version, initialQuery = '', selecting = false }) {
  const [query, setQuery] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const [filters, setFilters] = useState({ tool: '', model: '', project: '' })
  const [sort, setSort] = useState('recent')
  const [selected, setSelected] = useState(/** @type {string[]} */ ([]))

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  // Arriving from the top bar's search box, or from it again with a new term.
  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  const options = useApi('/api/filters', { refreshKey: version })
  const summary = useApi('/api/summary', { refreshKey: version })
  const charts = useApi('/api/summary/charts?days=30', { refreshKey: version })
  const [chartsOpen, setChartsOpen] = useState(true)
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

  const facets = options.data ?? { tools: [], models: [], projects: [] }

  return (
    <div className="space-y-3 px-4 py-4">
      <PageHeader
        title="Sessions"
        question="Where did my money go?"
        note={
          selecting
            ? 'Tick two or more sessions, then press Compare.'
            : query
              ? `Showing sessions matching “${query}”`
              : undefined
        }
        actions={
          query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                navigate('/')
              }}
              className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              <X className="size-3" />
              Clear search
            </button>
          ) : null
        }
      />

      <SummaryStrip data={summary.data} onOpenOptimize={() => navigate('/optimize')} />

      {/* Summary, then shape, then detail — the reference dashboard's order.
          The charts can be folded away by someone who came for the table. */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setChartsOpen((value) => !value)}
          aria-expanded={chartsOpen}
          className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text-primary)] hover:underline"
        >
          {chartsOpen ? 'Hide charts' : 'Show charts'}
        </button>
      </div>
      {chartsOpen ? <ChartsRow data={charts.data} /> : null}

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

      {sessions.length > 0 || filtered ? (
        <SessionFilters
          facets={facets}
          value={filters}
          onChange={setFilters}
          showing={sessions.length}
          total={summary.data?.sessions}
        />
      ) : null}

      {sessions.length > 0 ? (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[960px] table-fixed text-base">
              {/* Widths in proportion, not auto: auto let the model column eat
                  the middle of the screen and squeezed the numbers to the edge. */}
              <colgroup>
                <col className="w-[3%]" />
                <col className="w-[11%]" />
                <col className="w-[20%]" />
                <col className="w-[13%]" />
                <col className="w-[6%]" />
                <col className="w-[12%]" />
                <col className="w-[8%]" />
                <col className="w-[15%]" />
                <col className="w-[6%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-raised)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th
                    className={cn(
                      'px-3 py-2',
                      selecting &&
                        'bg-[color-mix(in_oklab,var(--color-cat-system-prompt)_18%,transparent)]',
                    )}
                  >
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
                    selecting={selecting}
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

          {debounced || sort !== 'recent' ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              {debounced ? `Matching “${debounced}”` : ''}
              {debounced && sort !== 'recent' ? ' · ' : ''}
              {sort !== 'recent' ? `sorted by ${SORT_LABEL[sort] ?? sort}` : ''}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/**
 * @param {{ session: any, query: string, selected: boolean, selecting: boolean,
 *           atLimit: boolean, onToggle: () => void }} props
 */
function SessionRow({ session, query, selected, selecting, atLimit, onToggle }) {
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
          'h-10 cursor-pointer border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-raised)]',
          selected && 'bg-[var(--color-raised)]',
        )}
      >
        <td
          className={cn(
            'px-3 py-1.5',
            selecting &&
              'bg-[color-mix(in_oklab,var(--color-cat-system-prompt)_18%,transparent)]',
          )}
        >
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
        <td className="px-3 py-1.5">
          <span className="flex items-center gap-2">
            <SourceMark tool={session.tool} />
            <span className="truncate font-medium">{session.tool || '—'}</span>
          </span>
        </td>
        <td
          className="truncate px-3 py-1.5 text-[var(--color-text-secondary)]"
          title={session.model}
        >
          {session.model || '—'}
        </td>
        <td className="px-3 py-1.5 text-[var(--color-text-secondary)]">
          {session.projectName || (
            <span className="text-[var(--color-text-muted)]">unknown</span>
          )}
        </td>
        <td className="tnum px-3 py-1.5 text-right">{session.turnCount}</td>
        <td className="tnum px-3 py-1.5 text-right">
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
        <td className="tnum px-3 py-1.5 text-right">{usd(session.equivalentCostUsd)}</td>
        {/* The worst finding still standing, not a score derived from a count.
            A score hid which of two "warning" sessions had a critical in it. */}
        <td className="px-3 py-1.5">
          {findings === 0 ? (
            <span className="text-xs text-[var(--color-text-muted)]">clean</span>
          ) : (
            // One chip, not a chip and a stray number beside it.
            <Severity
              severity={session.worstSeverity ?? 'info'}
              note={recoverable > 0 ? `${findings} · ${usd(recoverable)}` : findings}
            />
          )}
        </td>
        <td className="px-3 py-1.5">
          <Sparkline values={session.trend} limit={limit} />
        </td>
        <td className="px-3 py-1.5 text-right text-[var(--color-text-muted)]">
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
 * @param {{ tool?: string }} props
 */
function SourceMark({ tool }) {
  const Icon = SOURCE_ICON[String(tool ?? '').toLowerCase()] ?? Bot
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded bg-[var(--color-raised)] text-[var(--color-text-secondary)]">
      <Icon aria-hidden="true" className="size-3.5" />
    </span>
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
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 shadow-lg">
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
    return <th className={cn('px-3 py-1.5 font-medium', align)}>{column.label}</th>
  }

  const active = sort === column.sort
  return (
    <th className={cn('px-3 py-1.5 font-medium', align)}>
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
