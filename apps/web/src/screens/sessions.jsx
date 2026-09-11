/**
 * Screen 1 — Sessions.
 *
 * Every session, with the one thing the prior tool could not do: search across
 * what was actually said, rather than matching a session id nobody remembers.
 *
 * @module
 */

import { Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ExportMenu } from '../components/export-menu.jsx'
import { Health, healthOf } from '../components/health.jsx'
import { Sparkline } from '../components/sparkline.jsx'
import { Empty, Failed, Loading } from '../components/states.jsx'
import { Card } from '../components/ui/card.jsx'
import { Input } from '../components/ui/input.jsx'
import { url, useApi } from '../lib/api.js'
import { percent, tokens, truncate, usd, when } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import { cn } from '../lib/utils.js'

/** Long enough that typing does not fire a query per keystroke. */
const DEBOUNCE_MS = 200

/**
 * @param {{ version?: number }} props
 */
export function Sessions({ version }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filters, setFilters] = useState({ tool: '', model: '', project: '' })

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const options = useApi('/api/filters', { refreshKey: version })
  const { data, error, loading } = useApi(
    url('/api/sessions', { limit: 100, q: debounced, ...filters }),
    { refreshKey: version },
  )

  const sessions = data?.sessions ?? []
  const filtered = debounced || filters.tool || filters.model || filters.project

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Sessions</h1>
        <div className="flex items-center gap-2">
          <SearchBox value={query} onChange={setQuery} />
          <ExportMenu />
        </div>
      </header>

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

      {error ? <Failed message={error} /> : null}
      {loading && !data ? <Loading /> : null}

      {!error && !loading && sessions.length === 0 ? (
        filtered ? (
          <Empty
            title={
              debounced
                ? `Nothing matches “${debounced}”.`
                : 'Nothing matches those filters.'
            }
            hint="Search covers every message, tool call and result — not just session ids."
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
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Directory</th>
                  <th className="px-3 py-2 text-right font-medium">Turns</th>
                  <th className="px-3 py-2 text-right font-medium">Context</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 font-medium">Health</th>
                  <th className="px-3 py-2 font-medium">Trend</th>
                  <th className="px-3 py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((/** @type {any} */ session) => (
                  <SessionRow key={session.id} session={session} query={debounced} />
                ))}
              </tbody>
            </table>
          </Card>

          <p className="text-xs text-[var(--color-text-muted)]">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
            {debounced ? ` matching “${debounced}”` : ''}
          </p>
        </>
      ) : null}
    </div>
  )
}

/**
 * @param {{ session: any, query: string }} props
 */
function SessionRow({ session, query }) {
  const limit = Number(session.contextLimit) || 0
  const peak = Number(session.peakContextTokens) || 0
  const share = limit > 0 ? peak / limit : 0

  const health = healthOf({
    contextShare: share,
    findings: Number(session.findingCount) || 0,
  })

  return (
    <>
      <tr
        onClick={() => navigate(`/s/${encodeURIComponent(session.id)}`)}
        className="cursor-pointer border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-gridline)]"
      >
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
        <td className="px-3 py-2">
          <Health level={health} />
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
          <td colSpan={9} className="px-3 pb-2 text-xs">
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
