/**
 * The charts: four rings and a timeline, on nivo.
 *
 * The reference dashboard puts a row of rings under its KPI strip and a
 * stacked timeline under those. Ours answer four "what dominates" questions —
 * which tool, which project, which severity, which category — and one
 * "when": spend by day, stacked by tool.
 *
 * nivo replaced Recharts for both, on request, and because two chart
 * libraries in one bundle was a megabyte. The ring is the nivo look the user
 * pointed at: the hovered arc growing, a chip tooltip — with the total in the
 * centre and a legend that carries the value, because a legend that only
 * carries colour asks the reader to match hues.
 *
 * Rules kept from the data-viz method:
 *
 * - colour follows the entity, never its rank — the supported tools hold
 *   fixed slots and a project is coloured by its name alone
 * - a legend is always present for two or more series, and carries the value
 * - a gap in the surface colour between touching segments
 * - text wears text tokens, never the series colour
 *
 * @module
 */

import { Line, ResponsiveLine } from '@nivo/line'
import { Pie, ResponsivePie } from '@nivo/pie'
import { categoryColor, categoryLabel, exact, tokens, usd } from '../lib/format.js'
import { cn } from '../lib/utils.js'

/**
 * Warm sand — the palette chosen for the tool and project rings, as given.
 *
 * Recorded honestly: run through the validator against the card surface it
 * fails the chroma floor (all five read as brown-grey to the check), the
 * normal-vision floor between the two darkest (ΔE 11, floor 15), and two sit
 * under 3:1 contrast. It was chosen for its look and kept for that reason;
 * the legend beside every ring carries the name and the value, so identity
 * never rides on colour, and the arcs are separated by a surface gap.
 */
export const SAND = [
  'hsl(27, 42%, 55%)',
  'hsl(14, 38%, 47%)',
  'hsl(35, 55%, 63%)',
  'hsl(16, 35%, 57%)',
  'hsl(13, 34%, 39%)',
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
 * are a table rather than a computation: claude is the first sand on every
 * screen in every session, whatever else is present. Five sands for seven
 * tools, so the last two share with the first two; they are rarely on one
 * screen together, and the legend names every slice regardless.
 *
 * @type {Record<string, number>}
 */
const TOOL_SLOT = {
  claude: 0,
  codex: 1,
  gemini: 2,
  aider: 3,
  cline: 4,
  copilot: 0,
  opencode: 1,
}

/**
 * A colour per entity that does not depend on which other entities are there.
 *
 * Known tools come from the table. Anything else — a project name — is hashed
 * to a slot, so its colour is a function of its name alone. Two names can hash
 * to one slot; when both are on screen the later one in name order walks to
 * the next free slot. The legend always carries the name and the value, so
 * identity never rides on colour in any case.
 *
 * @param {{ key: string }[]} series
 * @param {string[]} [palette]
 * @returns {Record<string, string>}
 */
export function colourByName(series, palette = SAND) {
  const names = [...new Set(series.map((item) => item.key))].sort()
  /** @type {Record<string, string>} */
  const out = {}
  const taken = new Set()

  for (const name of names) {
    const fixed = TOOL_SLOT[name.toLowerCase()]
    if (fixed !== undefined) {
      out[name] = palette[fixed % palette.length] ?? palette[0] ?? ''
      taken.add(fixed % palette.length)
    }
  }

  for (const name of names) {
    if (out[name]) continue
    let slot = hashSlot(name, palette.length)
    for (let step = 0; step < palette.length && taken.has(slot); step += 1) {
      slot = (slot + 1) % palette.length
    }
    taken.add(slot)
    out[name] = palette[slot] ?? palette[0] ?? ''
  }
  return out
}

/**
 * @param {string} name
 * @param {number} slots
 * @returns {number}
 */
function hashSlot(name, slots) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % slots
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

/** nivo's theme, in the product's tokens. */
const THEME = {
  text: { fill: 'var(--color-text-secondary)', fontSize: 11 },
  grid: { line: { stroke: 'var(--color-gridline)', strokeWidth: 1 } },
  axis: {
    ticks: {
      text: { fill: 'var(--color-text-muted)', fontSize: 11 },
      line: { stroke: 'none' },
    },
    domain: { line: { stroke: 'var(--color-baseline)' } },
  },
  crosshair: { line: { stroke: 'var(--color-baseline)', strokeWidth: 1 } },
}

/**
 * The chip that follows the pointer.
 *
 * @param {{ colour: string, children: any }} props
 */
function Chip({ colour, children }) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-raised)] px-2 py-1 text-xs text-[var(--color-text-primary)] shadow-lg">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: colour }}
      />
      {children}
    </div>
  )
}

/**
 * @typedef {Object} DonutProps
 * @property {string} title
 * @property {{ key: string, label: string, value: number }[]} series
 * @property {'usd' | 'count' | 'tokens'} unit
 * @property {'name' | 'category' | 'severity'} colour   how a slice gets its colour
 * @property {string} [empty]   what to say when there is nothing to draw
 * @property {number} [size]    a fixed size renders without measuring — for tests
 */

/**
 * @param {DonutProps} props
 */
export function Donut({ title, series, unit, colour, empty = 'Nothing yet.', size }) {
  const slices = foldSmall(series)
  const total = slices.reduce((sum, item) => sum + item.value, 0)
  const byName = colourByName(slices)

  /** @param {{ key: string }} slice */
  const fill = (slice) => {
    if (slice.key === 'other') return 'var(--color-cat-other)'
    if (colour === 'category') return categoryColor(slice.key)
    if (colour === 'severity') {
      return (
        SEVERITY_COLOR[/** @type {keyof SEVERITY_COLOR} */ (slice.key)] ?? SAND[0] ?? ''
      )
    }
    return byName[slice.key] ?? SAND[0] ?? ''
  }
  /** @param {number} value */
  const show = (value) =>
    unit === 'usd' ? usd(value) : unit === 'tokens' ? tokens(value) : exact(value)
  /** @param {{ key: string, label: string }} slice */
  const name = (slice) =>
    colour === 'category' && slice.key !== 'other'
      ? categoryLabel(slice.key)
      : slice.label

  const data = slices.map((slice) => ({
    id: slice.key,
    label: name(slice),
    value: slice.value,
    color: fill(slice),
  }))

  /** @type {any} */
  const pieProps = {
    data,
    // The snippet, sized to a shared card: the ring, the pad between arcs,
    // the rounded ends, the hovered arc growing.
    margin: { top: 8, right: 8, bottom: 8, left: 8 },
    innerRadius: 0.58,
    padAngle: 1.5,
    cornerRadius: 2,
    activeOuterRadiusOffset: 6,
    colors: { datum: 'data.color' },
    borderWidth: 2,
    borderColor: 'var(--color-surface)',
    enableArcLabels: false,
    enableArcLinkLabels: false,
    animate: true,
    motionConfig: 'gentle',
    theme: THEME,
    tooltip: (/** @type {any} */ { datum }) => (
      <Chip colour={String(datum.color)}>
        {datum.label}: <span className="tnum">{show(Number(datum.value))}</span>
        <span className="text-[var(--color-text-muted)]">
          · {Math.round((Number(datum.value) / Math.max(total, 1e-9)) * 100)}%
        </span>
      </Chip>
    ),
    layers: [
      'arcs',
      // The whole, in the middle of the ring that divides it.
      (/** @type {any} */ { centerX, centerY }) => (
        <text
          x={centerX}
          y={centerY}
          textAnchor="middle"
          dominantBaseline="central"
          className="tnum"
          style={{ fill: 'var(--color-text-primary)', fontSize: 13, fontWeight: 600 }}
        >
          {show(total)}
        </text>
      ),
    ],
  }

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        {title}
      </figcaption>

      {slices.length === 0 ? (
        <p className="py-8 text-center text-xs text-[var(--color-text-muted)]">{empty}</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative size-32 shrink-0" data-chart>
            {size ? (
              <Pie {...pieProps} width={size} height={size} />
            ) : (
              <ResponsivePie {...pieProps} />
            )}
          </div>

          {/* The legend carries the value, so identity never rides on colour. */}
          <ul className="min-w-0 flex-1 space-y-1">
            {data.map((slice) => (
              <li key={slice.id} className="flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">
                  {slice.label}
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
 *           className?: string, width?: number, height?: number }} props
 */
export function SpendTimeline({ days, className, width, height }) {
  const toolsSet = new Set()
  for (const day of days) for (const tool of Object.keys(day.byTool)) toolsSet.add(tool)
  const toolNames = [...toolsSet].sort()
  const byName = colourByName(toolNames.map((key) => ({ key })))

  const series = toolNames.map((tool) => ({
    id: tool,
    color: byName[tool],
    data: days.map((day) => ({ x: day.day, y: day.byTool[tool] ?? 0 })),
  }))

  /** @type {any} */
  const lineProps = {
    data: series,
    margin: { top: 10, right: 12, bottom: 28, left: 52 },
    xScale: { type: 'point' },
    yScale: { type: 'linear', min: 0, max: 'auto', stacked: true },
    curve: 'monotoneX',
    colors: { datum: 'color' },
    lineWidth: 2,
    enablePoints: false,
    enableArea: true,
    areaOpacity: 0.35,
    enableGridX: false,
    enableGridY: true,
    axisBottom: { format: (/** @type {string} */ value) => String(value).slice(5) },
    axisLeft: { format: (/** @type {number} */ value) => usd(value), tickValues: 4 },
    enableSlices: 'x',
    theme: THEME,
    animate: true,
    motionConfig: 'gentle',
    sliceTooltip: (/** @type {any} */ { slice }) => {
      const total = slice.points.reduce(
        (/** @type {number} */ sum, /** @type {any} */ point) =>
          sum + Number(point.data.y),
        0,
      )
      return (
        <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-raised)] px-2 py-1 text-xs text-[var(--color-text-primary)] shadow-lg">
          <div className="mb-1 font-medium">
            {String(slice.points[0]?.data.x)} · <span className="tnum">{usd(total)}</span>
          </div>
          {[...slice.points].reverse().map((/** @type {any} */ point) => (
            <div key={point.id} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-[2px]"
                  style={{ backgroundColor: String(point.seriesColor ?? point.color) }}
                />
                {String(point.seriesId ?? point.serieId)}
              </span>
              <span className="tnum">{usd(Number(point.data.y))}</span>
            </div>
          ))}
        </div>
      )
    },
  }

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
          {width && height ? (
            <Line {...lineProps} width={width} height={height} />
          ) : (
            <ResponsiveLine {...lineProps} />
          )}
        </div>
      )}
    </figure>
  )
}
