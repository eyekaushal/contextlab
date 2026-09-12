/**
 * Findings as a ranked table.
 *
 * The previous version of this screen was nine prose cards in a column. Every
 * finding had the same visual weight, nothing could be sorted, nothing could be
 * filtered, and the fix sat in a grey box a scroll away from the number that
 * justified it. It read like a report. This is a console: the most expensive
 * row is at the top, the shape of the problem fits on one screen, and the
 * action belongs to the row it acts on.
 *
 * Collapsed by default. A row opens into its arithmetic, its detail and its
 * fix — progressive disclosure, with the summary stating that detail exists.
 *
 * @module
 */

import { ChevronRight, EyeOff, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { post } from '../lib/api.js'
import { exact, truncate, usd } from '../lib/format.js'
import { cn } from '../lib/utils.js'
import { Arithmetic, Fix } from './finding.jsx'
import { Severity } from './health.jsx'
import { Badge } from './ui/badge.jsx'
import { Button } from './ui/button.jsx'

/** Order for the severity sort. Money still breaks ties inside a level. */
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 }

/** What a claim key is about, in a word a reader recognises. */
const SCOPE_LABEL = {
  mcp: 'MCP server',
  file: 'File',
  segment: 'Prompt segment',
  block: 'Message block',
  call: 'Tool call',
}

/**
 * @typedef {Object} Row
 * @property {any} finding
 * @property {string} sessionId
 * @property {string} [sessionLabel]
 */

/**
 * @param {{ rows: Row[], showSession?: boolean, onChanged?: () => void }} props
 */
export function FindingsTable({ rows, showSession = false, onChanged }) {
  const [severity, setSeverity] = useState('all')
  const [rule, setRule] = useState('all')
  const [sort, setSort] = useState('money')
  const [withDismissed, setWithDismissed] = useState(false)
  const [open, setOpen] = useState(/** @type {Record<string, boolean>} */ ({}))
  const [busy, setBusy] = useState(/** @type {string | null} */ (null))

  // Built from everything, not from the filtered set, so choosing one rule does
  // not make the other rules disappear from the control that chooses them.
  const rules = useMemo(
    () => [...new Set(rows.map((row) => String(row.finding.rule)))].sort(),
    [rows],
  )

  const dismissedCount = rows.filter((row) => row.finding.dismissedAt).length

  const visible = useMemo(() => {
    const filtered = rows.filter((row) => {
      const finding = row.finding
      if (finding.dismissedAt && !withDismissed) return false
      if (severity !== 'all' && finding.severity !== severity) return false
      if (rule !== 'all' && finding.rule !== rule) return false
      return true
    })

    return [...filtered].sort((a, b) => {
      if (sort === 'tokens') {
        return b.finding.wastedTokens - a.finding.wastedTokens
      }
      if (sort === 'severity') {
        const delta =
          (SEVERITY_RANK[/** @type {keyof SEVERITY_RANK} */ (a.finding.severity)] ?? 3) -
          (SEVERITY_RANK[/** @type {keyof SEVERITY_RANK} */ (b.finding.severity)] ?? 3)
        if (delta !== 0) return delta
      }
      // Money already lost outranks money that a change you have not made
      // might have saved, however much larger the second figure is. Sorting
      // them together would put "$4.87 from caching" above every real loss.
      const kind = rank(a.finding) - rank(b.finding)
      if (kind !== 0) return kind
      return b.finding.wastedCostUsd - a.finding.wastedCostUsd
    })
  }, [rows, severity, rule, sort, withDismissed])

  /**
   * @param {Row} row
   * @param {'dismiss' | 'restore'} action
   */
  async function act(row, action) {
    const id = keyOf(row)
    setBusy(id)
    try {
      await post(`/api/findings/${action}`, {
        sessionId: row.sessionId,
        rule: row.finding.rule,
        title: row.finding.title,
      })
      onChanged?.()
    } catch {
      // The server refused or is gone. The row is unchanged and still on
      // screen, which is the honest outcome — nothing was set aside.
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <Controls
        severity={severity}
        setSeverity={setSeverity}
        rule={rule}
        setRule={setRule}
        rules={rules}
        sort={sort}
        setSort={setSort}
        withDismissed={withDismissed}
        setWithDismissed={setWithDismissed}
        dismissedCount={dismissedCount}
        showing={visible.length}
        total={rows.length}
      />

      <div className="overflow-x-auto rounded border border-[var(--color-border-subtle)]">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-page)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="w-6" />
              <th className="px-2 py-1.5 font-medium">Severity</th>
              <th className="px-2 py-1.5 font-medium">Finding</th>
              <th className="px-2 py-1.5 font-medium">Scope</th>
              <th className="px-2 py-1.5 text-right font-medium">Recoverable</th>
              <th className="px-2 py-1.5 text-right font-medium">Potential</th>
              <th className="px-2 py-1.5 text-right font-medium">Tokens</th>
              <th className="w-px px-2 py-1.5" />
            </tr>
          </thead>

          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-2 py-6 text-center text-[var(--color-text-muted)]"
                >
                  No finding matches this filter.
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const id = keyOf(row)
                return (
                  <FindingRow
                    key={id}
                    row={row}
                    open={Boolean(open[id])}
                    onToggle={() => setOpen((state) => ({ ...state, [id]: !state[id] }))}
                    showSession={showSession}
                    busy={busy === id}
                    onAct={act}
                  />
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * @param {{ row: Row, open: boolean, onToggle: () => void, showSession: boolean,
 *           busy: boolean, onAct: (row: Row, action: 'dismiss' | 'restore') => void }} props
 */
function FindingRow({ row, open, onToggle, showSession, busy, onAct }) {
  const finding = row.finding
  const dismissed = Boolean(finding.dismissedAt)
  const potential = finding.claim === 'potential'
  const superseded = finding.countsTowardTotal === false && !potential
  const scope = scopeOf(finding)

  return (
    <>
      <tr
        className={cn(
          'cursor-pointer border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-page)]',
          open && 'bg-[var(--color-page)]',
          dismissed && 'opacity-50',
        )}
        onClick={onToggle}
      >
        <td className="pl-2">
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-3 text-[var(--color-text-muted)] transition-transform',
              open && 'rotate-90',
            )}
          />
        </td>

        <td className="px-2 py-1.5">
          <Severity severity={finding.severity} />
        </td>

        <td className="px-2 py-1.5">
          <button
            type="button"
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
            className="text-left font-medium"
          >
            {finding.title}
          </button>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="font-mono">{finding.rule}</span>
            {showSession && row.sessionLabel ? (
              <span>· {truncate(row.sessionLabel, 28)}</span>
            ) : null}
            {/* Two figures that must never be added. Saying which is which on
                the row is cheaper than explaining the total afterwards. */}
            {potential ? <Badge>potential saving</Badge> : null}
            {superseded ? <Badge>counted under {finding.supersededBy}</Badge> : null}
            {dismissed ? <Badge>dismissed</Badge> : null}
          </div>
        </td>

        <td className="px-2 py-1.5 text-[var(--color-text-secondary)]">
          {scope.label ? (
            <>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {scope.label}
              </span>
              <div className="font-mono">{truncate(scope.name, 30)}</div>
            </>
          ) : (
            <span className="text-[11px] text-[var(--color-text-muted)]">
              whole session
            </span>
          )}
        </td>

        {/* One figure, one column. A hypothetical saving never appears under
            the heading for money that was actually spent. */}
        <td
          className={cn(
            'tnum px-2 py-1.5 text-right font-semibold',
            superseded || dismissed
              ? 'text-[var(--color-text-muted)]'
              : 'text-[var(--color-text-primary)]',
          )}
        >
          {potential ? '—' : usd(finding.wastedCostUsd)}
        </td>

        <td className="tnum px-2 py-1.5 text-right text-[var(--color-text-secondary)]">
          {potential ? usd(finding.wastedCostUsd) : '—'}
        </td>

        <td className="tnum px-2 py-1.5 text-right text-[var(--color-text-secondary)]">
          {finding.wastedTokens > 0 ? exact(finding.wastedTokens) : '—'}
        </td>

        <td className="px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={dismissed ? 'Restore this finding' : 'Dismiss this finding'}
            onClick={(/** @type {any} */ event) => {
              event.stopPropagation()
              onAct(row, dismissed ? 'restore' : 'dismiss')
            }}
          >
            {dismissed ? <RotateCcw className="size-3" /> : <EyeOff className="size-3" />}
          </Button>
        </td>
      </tr>

      {open ? (
        <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-page)]">
          <td />
          <td colSpan={7} className="px-2 pb-3 pr-3">
            <Arithmetic finding={finding} />

            {finding.detail ? (
              <p className="mt-2 whitespace-pre-wrap leading-relaxed text-[var(--color-text-secondary)]">
                {finding.detail}
              </p>
            ) : null}

            {finding.fix ? <Fix text={finding.fix} /> : null}

            {dismissed ? (
              <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                Set aside {new Date(finding.dismissedAt).toLocaleString()}. It stays out
                of the totals until you restore it.
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}

/** @param {any} props */
function Controls({
  severity,
  setSeverity,
  rule,
  setRule,
  rules,
  sort,
  setSort,
  withDismissed,
  setWithDismissed,
  dismissedCount,
  showing,
  total,
}) {
  const select =
    'rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-1.5 py-1 text-xs'

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <select
        aria-label="Filter by severity"
        className={select}
        value={severity}
        onChange={(event) => setSeverity(event.target.value)}
      >
        <option value="all">All severities</option>
        <option value="critical">Critical</option>
        <option value="warning">Warning</option>
        <option value="info">Info</option>
      </select>

      <select
        aria-label="Filter by rule"
        className={select}
        value={rule}
        onChange={(event) => setRule(event.target.value)}
      >
        <option value="all">All rules</option>
        {rules.map((/** @type {string} */ name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      <select
        aria-label="Sort by"
        className={select}
        value={sort}
        onChange={(event) => setSort(event.target.value)}
      >
        <option value="money">Sort: money</option>
        <option value="tokens">Sort: tokens</option>
        <option value="severity">Sort: severity</option>
      </select>

      {dismissedCount > 0 ? (
        <label className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={withDismissed}
            onChange={(event) => setWithDismissed(event.target.checked)}
          />
          Show {dismissedCount} dismissed
        </label>
      ) : null}

      {/* Never a silent truncation: the count says what the filter is hiding. */}
      <span className="tnum ml-auto text-[var(--color-text-muted)]">
        Showing {showing} of {total}
      </span>
    </div>
  )
}

/**
 * What a finding is about, read off its claim key.
 *
 * The key already names the thing being claimed — that is what stops two rules
 * counting the same tokens — so the column costs nothing to produce.
 *
 * @param {any} finding
 * @returns {{ label: string, name: string }}
 */
export function scopeOf(finding) {
  const key = String(finding.claimKey ?? '')
  const cut = key.indexOf(':')
  if (cut < 0) return { label: '', name: '' }

  const kind = key.slice(0, cut)
  const rest = key.slice(cut + 1)
  const label = SCOPE_LABEL[/** @type {keyof SCOPE_LABEL} */ (kind)]
  if (!label) return { label: '', name: '' }

  return { label, name: kind === 'file' ? (rest.split('/').pop() ?? rest) : rest }
}

/**
 * Which half of the reconciliation a finding belongs to.
 *
 * @param {any} finding
 * @returns {number}
 */
function rank(finding) {
  return finding.claim === 'potential' ? 1 : 0
}

/**
 * @param {Row} row
 * @returns {string}
 */
function keyOf(row) {
  return `${row.sessionId}::${row.finding.rule}::${row.finding.title}`
}
