/**
 * The filters, directly above the table they filter.
 *
 * The rail before this took 224px of every screen and changed a table the
 * reader could not see from the top of the page — filter something, watch
 * nothing happen, scroll down, find it had. A control belongs next to the one
 * thing it affects. Three dropdowns, the same row the optimize screen uses,
 * one line above the sessions.
 *
 * What survives from the rail: every option carries its session count and its
 * spend, so the dropdown says something before it is opened.
 *
 * @module
 */

import { Filter, X } from 'lucide-react'
import { usd } from '../lib/format.js'
import { cn } from '../lib/utils.js'

/**
 * @typedef {{ value: string, label: string, count: number, costUsd: number }} Facet
 */

/**
 * @param {{ facets: { tools: Facet[], models: Facet[], projects: Facet[] },
 *           value: { tool: string, model: string, project: string },
 *           onChange: (next: { tool: string, model: string, project: string }) => void,
 *           showing: number, total?: number, className?: string }} props
 */
export function SessionFilters({ facets, value, onChange, showing, total, className }) {
  const active = Boolean(value.tool || value.model || value.project)
  /** @type {{ key: 'tool' | 'model' | 'project', label: string, items: Facet[] }[]} */
  const groups = [
    { key: 'tool', label: 'Source', items: facets.tools },
    { key: 'model', label: 'Model', items: facets.models },
    { key: 'project', label: 'Project', items: facets.projects },
  ]

  // Nothing to choose between until more than one of something exists — a
  // dropdown with one option is a label with extra steps.
  const useful = groups.filter((group) => group.items.length > 1 || value[group.key])
  if (useful.length === 0) return null

  return (
    <div className={cn('flex flex-wrap items-center gap-2 text-sm', className)}>
      <Filter aria-hidden="true" className="size-3.5 text-[var(--color-text-muted)]" />

      {useful.map((group) => (
        <label
          key={group.key}
          className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]"
        >
          {group.label}
          <select
            aria-label={`Filter by ${group.label.toLowerCase()}`}
            value={value[group.key]}
            onChange={(event) => onChange({ ...value, [group.key]: event.target.value })}
            className={cn(
              'h-8 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text-primary)]',
              value[group.key] && 'border-[var(--color-cat-system-prompt)]',
            )}
          >
            <option value="">All</option>
            {group.items.map((item) => (
              <option key={item.value} value={item.value}>
                {optionLabel(item)}
              </option>
            ))}
          </select>
        </label>
      ))}

      {active ? (
        <button
          type="button"
          onClick={() => onChange({ tool: '', model: '', project: '' })}
          className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text-primary)] hover:underline"
        >
          <X className="size-3" />
          Clear
        </button>
      ) : null}

      {/* Never a silent truncation: the row says what the filter is hiding. */}
      <span className="tnum ml-auto text-xs text-[var(--color-text-muted)]">
        {active && total !== undefined
          ? `Showing ${showing} of ${total}`
          : `${showing} session${showing === 1 ? '' : 's'}`}
      </span>
    </div>
  )
}

/**
 * `claude (2 · $6.09)` — the count and the spend, in the option itself.
 *
 * @param {Facet} item
 * @returns {string}
 */
export function optionLabel(item) {
  const label = item.label.length > 34 ? `${item.label.slice(0, 33)}…` : item.label
  return `${label} (${item.count} · ${usd(item.costUsd)})`
}
