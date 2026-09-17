/**
 * The facet rail.
 *
 * Three dropdowns said "you may filter by source, model and project" and told
 * you nothing until you opened them. A rail with every value listed, a count
 * beside it and a bar in proportion to its spend is a filter and a summary at
 * once — the reader sees where the money went before clicking anything. It is
 * the left panel of the reference dashboard, and it is where a session list
 * stops being a list.
 *
 * Click a value to filter, click it again to clear. Collapses to a strip so a
 * narrow screen keeps its table width.
 *
 * @module
 */

import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { usd } from '../lib/format.js'
import { cn } from '../lib/utils.js'
import { Tooltip } from './ui/tooltip.jsx'

/**
 * @typedef {Object} FacetGroup
 * @property {string} key
 * @property {string} label
 * @property {any} icon
 * @property {{ value: string, label: string, count: number, costUsd: number }[]} items
 * @property {string} selected   '' when nothing is
 */

/**
 * @param {{ groups: FacetGroup[], onSelect: (key: string, value: string) => void,
 *           collapsed: boolean, onToggle: () => void, className?: string }} props
 */
export function FacetRail({ groups, onSelect, collapsed, onToggle, className }) {
  const shown = groups.filter((group) => group.items.length > 0)

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)] transition-[width]',
        collapsed ? 'w-9' : 'w-56',
        className,
      )}
      aria-label="Filters"
    >
      <div
        className={cn(
          'flex h-9 items-center border-b border-[var(--color-border-subtle)] px-2',
          collapsed ? 'justify-center' : 'justify-between',
        )}
      >
        {collapsed ? null : (
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Filters
          </span>
        )}
        <Tooltip text={collapsed ? 'Show filters' : 'Hide filters'} side="bottom">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            className="rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-gridline)] hover:text-[var(--color-text-primary)]"
          >
            {collapsed ? (
              <ChevronsRight className="size-3.5" />
            ) : (
              <ChevronsLeft className="size-3.5" />
            )}
          </button>
        </Tooltip>
      </div>

      {collapsed ? null : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((group) => (
            <Group key={group.key} group={group} onSelect={onSelect} />
          ))}
        </div>
      )}
    </aside>
  )
}

/**
 * @param {{ group: FacetGroup, onSelect: (key: string, value: string) => void }} props
 */
function Group({ group, onSelect }) {
  const Icon = group.icon
  const most = Math.max(...group.items.map((item) => item.costUsd), 0.000001)

  return (
    <section className="border-b border-[var(--color-border-subtle)] px-2 py-2">
      <h3 className="mb-1 flex items-center gap-1.5 px-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {Icon ? <Icon aria-hidden="true" className="size-3" /> : null}
        {group.label}
      </h3>

      <ul className="space-y-px">
        {group.items.map((item) => {
          const active = group.selected === item.value
          return (
            <li key={item.value}>
              <button
                type="button"
                onClick={() => onSelect(group.key, active ? '' : item.value)}
                aria-pressed={active}
                title={`${item.label} · ${item.count} session${item.count === 1 ? '' : 's'} · ${usd(item.costUsd)}`}
                className={cn(
                  'group/f flex w-full flex-col gap-0.5 rounded px-1.5 py-1 text-left text-sm transition-colors',
                  active
                    ? 'bg-[color-mix(in_oklab,var(--color-cat-system-prompt)_22%,transparent)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-gridline)]',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{item.label}</span>
                  <span className="tnum shrink-0 text-xs text-[var(--color-text-muted)]">
                    {item.count}
                  </span>
                </span>
                {/* Spend, not count: the bar answers "where did the money go",
                    which is the question this screen is for. */}
                <span className="block h-1 w-full overflow-hidden rounded-full bg-[var(--color-gridline)]">
                  <span
                    className="block h-full rounded-full bg-[var(--color-cat-system-prompt)] opacity-80"
                    style={{ width: `${Math.max(2, (item.costUsd / most) * 100)}%` }}
                  />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
