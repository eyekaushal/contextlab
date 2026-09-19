/**
 * The charts: four rings and a timeline.
 *
 * The reference dashboard puts a row of rings under its KPI strip and a
 * stacked timeline under those. Ours answer four "what dominates" questions —
 * which tool, which project, which severity, which category — and one
 * "when": spend by day, stacked by tool.
 *
 * Rules kept from the data-viz method, because they are what separate a chart
 * from a decoration:
 *
 * - colour follows the entity, never its rank — a tool keeps its colour when
 *   a filter drops the tool above it, so slots are assigned by name order
 * - a legend is always present for two or more series, and carries the value,
 *   so identity never depends on telling two colours apart
 * - a 2px gap in the surface colour between touching segments
 * - text wears text tokens, never the series colour
 * - the total sits in the ring's centre, because the ring is about the whole
 *
 * Recharts is in the stack for exactly this and was unused until now.
 *
 * @module
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Tooltip as ChartTip,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { categoryColor, categoryLabel, exact, tokens, usd } from '../lib/format.js'
import { cn } from '../lib/utils.js'

/**
 * The categorical slots, in the fixed order every chart assigns them.
 * These are the eight validated hues from docs/DESIGN.md, in that order.
 */
const SLOTS = [
  'var(--color-cat-system-prompt)',
  'var(--color-cat-tool-definitions)',
  'var(--color-cat-tool-results)',
  'var(--color-cat-tool-calls)',
  'var(--color-cat-user-text)',
  'var(--color-cat-assistant-text)',
  'var(--color-cat-thinking)',
  'var(--color-cat-images)',
]

/** Past this many slices the ring is a rainbow; the rest fold into Other. */
const MAX_SLICES = 6

/** Status is reserved and never used for a category, but severity *is* status. */
const SEVERITY_COLOR = {
  critical: 'var(--color-status-critical)',
  warning: 'var(--color-status-warning)',
  info: 'var(--color-text-muted)',
}

/**
 * The seven supported tools, each with a slot for life.
 *
 * The product knows its tools (CLAUDE.md, non-negotiable 2), so their colours
 * are a table rather than a computation: claude is blue on every screen in
 * every session, whatever else is present.
 *
 * @type {Record<string, number>}
 */
const TOOL_SLOT = {
  claude: 0,
  codex: 1,
  gemini: 2,
  aider: 3,
  cline: 4,
  copilot: 5,
  opencode: 6,
}

/**
 * A colour per entity that does not depend on which other entities are there.
 *
 * The first version assigned slots by position in the sorted set, which meant
 * filtering out the alphabetically-first tool repainted every other one — the
 * exact thing "colour follows the entity, never its rank" forbids, and the
 * test for it caught the mistake.
 *
 * Known tools come from the table. Anything else — a project name — is hashed
 * to a slot, so its colour is a function of its name alone. Two names can hash
 * to one slot; when they are both on screen the later one in name order walks
 * to the next free slot, so a collision moves at most the colliding entity and
 * only while the other is present. The legend always carries the name and the
 * value, so identity never rides on colour in any case.
 *
 * @param {{ key: string }[]} series
 * @returns {Record<string, string>}
 */
export function colourByName(series) {
  const names = [...new Set(series.map((item) => item.key))].sort()
  /** @type {Record<string, string>} */
  const out = {}
  const taken = new Set()

  // Fixed slots first, so a project can never displace a tool.
  for (const name of names) {
    const fixed = TOOL_SLOT[name.toLowerCase()]
    if (fixed !== undefined) {
      out[name] = SLOTS[fixed % SLOTS.length] ?? SLOTS[0]
      taken.add(fixed % SLOTS.length)
    }
  }

  for (const name of names) {
    if (out[name]) continue
    let slot = hashSlot(name)
    for (let step = 0; step < SLOTS.length && taken.has(slot); step += 1) {
      slot = (slot + 1) % SLOTS.length
    }
    taken.add(slot)
    out[name] = SLOTS[slot] ?? SLOTS[0]
  }
  return out
}

/**
 * @param {string} name
 * @returns {number} a slot index derived from the name alone
 */
function hashSlot(name) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % SLOTS.length
}

/**
 * Sort by value, keep the top slices, fold the rest into Other.
 *
 * @param {{ key: string, label: string, value: number }[]} series
 * @param {number} [max]
 * @returns {{ key: string, label: string, value: number }[]}
 */
export function foldSmall(series, max = MAX_SLICES) {
  const sorted = [...series]
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
  if (sorted.length <= max) return sorted
  const kept = sorted.slice(0, max - 1)
  const rest = sorted.slice(max - 1).reduce((sum, item) => sum + item.value, 0)
  return [...kept, { key: 'other', label: 'Other', value: rest }]
}

/**
 * @typedef {Object} DonutProps
 * @property {string} title
 * @property {{ key: string, label: string, value: number }[]} series
 * @property {'usd' | 'count' | 'tokens'} unit
 * @property {'name' | 'category' | 'severity'} colour   how a slice gets its colour
 * @property {string} [empty]  what to say when there is nothing to draw
 */

/**
 * @param {DonutProps} props
 */
export function Donut({ title, series, unit, colour, empty = 'Nothing yet.' }) {
  const slices = foldSmall(series)
  const total = slices.reduce((sum, item) => sum + item.value, 0)
  const byName = colourByName(slices)

  /** @param {{ key: string }} slice */
  const fill = (slice) => {
    if (slice.key === 'other') return 'var(--color-cat-other)'
    if (colour === 'category') return categoryColor(slice.key)
    if (colour === 'severity') {
      return SEVERITY_COLOR[/** @type {keyof SEVERITY_COLOR} */ (slice.key)] ?? SLOTS[0]
    }
    return byName[slice.key] ?? SLOTS[0]
  }
  /** @param {number} value */
  const show = (value) =>
    unit === 'usd' ? usd(value) : unit === 'tokens' ? tokens(value) : exact(value)
  /** @param {{ key: string, label: string }} slice */
  const name = (slice) =>
    colour === 'category' && slice.key !== 'other'
      ? categoryLabel(slice.key)
      : slice.label

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        {title}
      </figcaption>

      {slices.length === 0 ? (
        <p className="py-8 text-center text-xs text-[var(--color-text-muted)]">{empty}</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative size-28 shrink-0" data-chart>
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 112, height: 112 }}
            >
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="68%"
                  outerRadius="100%"
                  // The 2px surface gap between touching segments.
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.key} fill={fill(slice)} />
                  ))}
                </Pie>
                <ChartTip
                  content={({ payload }) => {
                    const item = payload?.[0]?.payload
                    if (!item) return null
                    return (
                      <TipBox>
                        {name(item)} · {show(item.value)} ·{' '}
                        {Math.round((item.value / Math.max(total, 1e-9)) * 100)}%
                      </TipBox>
                    )
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* The whole, in the middle of the ring that divides it. */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="tnum text-sm font-semibold leading-none">
                {show(total)}
              </span>
            </div>
          </div>

          {/* The legend carries the value, so identity never rides on colour. */}
          <ul className="min-w-0 flex-1 space-y-1">
            {slices.map((slice) => (
              <li key={slice.key} className="flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: fill(slice) }}
                />
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">
                  {name(slice)}
                </span>
                <span className="tnum shrink-0 text-[var(--color-text-muted)]">
                  {show(slice.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  )
}

/**
 * Spend by day, stacked by tool.
 *
 * A stacked area is the part-to-whole form over time. Two days is the least it
 * can honestly show; with fewer the chart says so instead of drawing a dot and
 * calling it a trend.
 *
 * @param {{ days: { day: string, total: number, byTool: Record<string, number> }[],
 *           className?: string }} props
 */
export function SpendTimeline({ days, className }) {
  const toolsSet = new Set()
  for (const day of days) for (const tool of Object.keys(day.byTool)) toolsSet.add(tool)
  const toolNames = [...toolsSet].sort()
  const byName = colourByName(toolNames.map((key) => ({ key })))

  const rows = days.map((day) => ({ day: day.day, total: day.total, ...day.byTool }))

  return (
    <figure className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <figcaption className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          Spend over time
        </figcaption>
        {toolNames.length > 0 ? (
          <ul className="flex flex-wrap gap-3">
            {toolNames.map((tool) => (
              <li key={tool} className="flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-[2px]"
                  style={{ backgroundColor: byName[tool] }}
                />
                <span className="text-[var(--color-text-secondary)]">{tool}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {days.length < 2 ? (
        <p className="py-10 text-center text-xs text-[var(--color-text-muted)]">
          {days.length === 0
            ? 'No spend recorded in this period.'
            : `One day so far — ${usd(days[0]?.total ?? 0)} on ${days[0]?.day}. A line needs two.`}
        </p>
      ) : (
        <div className="h-52 w-full" data-chart>
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 800, height: 208 }}
          >
            <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-gridline)" />
              <XAxis
                dataKey="day"
                tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-baseline)' }}
                tickFormatter={(/** @type {string} */ value) => value.slice(5)}
              />
              <YAxis
                width={44}
                tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(/** @type {number} */ value) => usd(value)}
              />
              <ChartTip
                cursor={{ stroke: 'var(--color-baseline)' }}
                content={({ label, payload }) => {
                  if (!payload || payload.length === 0) return null
                  const total = payload.reduce(
                    (sum, p) => sum + (Number(p.value) || 0),
                    0,
                  )
                  return (
                    <TipBox>
                      <div className="mb-1 font-medium">
                        {label} · {usd(total)}
                      </div>
                      {[...payload].reverse().map((p) => (
                        <div
                          key={String(p.dataKey)}
                          className="flex justify-between gap-4"
                        >
                          <span>{String(p.dataKey)}</span>
                          <span className="tnum">{usd(Number(p.value) || 0)}</span>
                        </div>
                      ))}
                    </TipBox>
                  )
                }}
              />
              {toolNames.map((tool) => (
                <Area
                  key={tool}
                  type="monotone"
                  dataKey={tool}
                  stackId="spend"
                  stroke={byName[tool]}
                  strokeWidth={2}
                  fill={byName[tool]}
                  fillOpacity={0.35}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}

/**
 * @param {{ children: any }} props
 */
function TipBox({ children }) {
  return (
    <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-raised)] px-2 py-1 text-xs text-[var(--color-text-primary)] shadow-lg">
      {children}
    </div>
  )
}
