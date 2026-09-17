/**
 * The budget, set from here.
 *
 * "No budget set. Add one to ~/.contextlab/config.toml" was a dead end with a
 * homework assignment attached. The card now takes the figure and writes it to
 * that same file — the file stays the source of truth, so editing it by hand
 * still works and the dashboard shows what the file says.
 *
 * A numeric field with presets, not a slider. Money has no natural range: a
 * $5-a-day hobbyist and a $500-a-day team are both real, and any slider ends
 * up telling one of them the product was not built for them. The suggestion
 * comes from the reader's own last thirty days, which is the only range that
 * means anything.
 *
 * @module
 */

import { PiggyBank, Save, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { put } from '../lib/api.js'
import { usd } from '../lib/format.js'
import { cn } from '../lib/utils.js'
import { Badge } from './ui/badge.jsx'
import { Button } from './ui/button.jsx'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.jsx'
import { Tooltip } from './ui/tooltip.jsx'

const DAILY_PRESETS = [5, 20, 50, 100]
const MONTHLY_PRESETS = [50, 200, 500, 1000]

/**
 * @param {{ data: any, onSaved?: () => void }} props
 */
export function BudgetCard({ data, onSaved }) {
  const [daily, setDaily] = useState(figureOf(data?.budget?.daily))
  const [monthly, setMonthly] = useState(figureOf(data?.budget?.monthly))
  const [state, setState] = useState(
    /** @type {{ kind: 'idle' | 'saving' | 'saved' | 'failed', message?: string }} */ ({
      kind: 'idle',
    }),
  )

  // A fresh read from the server wins over what is in the boxes: it is what the
  // file says, and the file is the truth.
  useEffect(() => {
    setDaily(figureOf(data?.budget?.daily))
    setMonthly(figureOf(data?.budget?.monthly))
  }, [data?.budget?.daily, data?.budget?.monthly])

  if (!data) return null

  const dirty =
    daily !== figureOf(data.budget?.daily) || monthly !== figureOf(data.budget?.monthly)
  const suggestion = data.suggestion ?? {}

  async function save() {
    setState({ kind: 'saving' })
    try {
      await put('/api/budget', {
        daily: daily === '' ? null : Number(daily),
        monthly: monthly === '' ? null : Number(monthly),
      })
      setState({ kind: 'saved' })
      onSaved?.()
      setTimeout(() => setState({ kind: 'idle' }), 2000)
    } catch (error) {
      setState({
        kind: 'failed',
        message: String(error instanceof Error ? error.message : error),
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={PiggyBank}>Budget</CardTitle>
        {data.configured ? (
          data.alerts?.length > 0 ? (
            <Badge tone={data.alerts[0].level === 'exceeded' ? 'critical' : 'warning'}>
              {data.alerts[0].title}
            </Badge>
          ) : (
            <Badge tone="good">Within budget</Badge>
          )
        ) : (
          <Badge>Not set</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {data.configured ? <Progress rows={data.progress ?? []} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Daily"
            value={daily}
            onChange={setDaily}
            presets={DAILY_PRESETS}
            suggested={suggestion.daily}
            basis={
              suggestion.daily
                ? `Your busiest day in the last 30 was ${usd(suggestion.busiestDay)}.`
                : 'Nothing recorded yet to suggest from.'
            }
          />
          <Field
            label="Monthly"
            value={monthly}
            onChange={setMonthly}
            presets={MONTHLY_PRESETS}
            suggested={suggestion.monthly}
            basis={
              suggestion.monthly
                ? `The last 30 days cost ${usd(suggestion.last30Total)} across ${suggestion.days} day${suggestion.days === 1 ? '' : 's'}.`
                : 'Nothing recorded yet to suggest from.'
            }
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--color-text-muted)]">
            {data.writable ? (
              <>
                Written to <code className="font-mono">{shortPath(data.path)}</code>.
                Editing the file by hand still works.
              </>
            ) : (
              'This server has no config file to write to.'
            )}
            {data.billing?.mode === 'subscription' ? (
              <>
                {' '}
                {/* Budgets are stated in equivalent cost so they still mean
                    something on a plan that bills nothing per turn. */}
                You are on a subscription: these are equivalent API figures.
              </>
            ) : null}
          </p>

          <div className="flex items-center gap-2">
            {state.kind === 'failed' ? (
              <span className="text-xs text-[var(--color-status-critical)]">
                {state.message}
              </span>
            ) : state.kind === 'saved' ? (
              <span className="text-xs text-[var(--color-status-good)]">Saved</span>
            ) : null}
            <Button
              variant="solid"
              size="sm"
              disabled={!dirty || !data.writable || state.kind === 'saving'}
              onClick={save}
            >
              <Save className="size-3" />
              {state.kind === 'saving' ? 'Saving…' : 'Save budget'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * @param {{ label: string, value: string, onChange: (value: string) => void,
 *           presets: number[], suggested?: number | null, basis: string }} props
 */
function Field({ label, value, onChange, presets, suggested, basis }) {
  const id = `budget-${label.toLowerCase()}`
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        <label htmlFor={id}>{label}</label>
        {suggested ? (
          <Tooltip text={basis} side="left">
            <button
              type="button"
              onClick={() => onChange(String(suggested))}
              className="flex items-center gap-1 normal-case tracking-normal text-[var(--color-cat-system-prompt)] hover:underline"
            >
              <Wand2 className="size-3" />
              suggest {usd(suggested)}
            </button>
          </Tooltip>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-sm text-[var(--color-text-muted)]">$</span>
        <input
          id={id}
          type="number"
          min="0"
          step="1"
          inputMode="decimal"
          value={value}
          placeholder="none"
          aria-label={`${label} budget in dollars`}
          onChange={(event) => onChange(event.target.value)}
          className="tnum h-8 w-28 rounded border border-[var(--color-border-subtle)] bg-[var(--color-page)] px-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-cat-system-prompt)] focus:outline-none"
        />
        {/* Round figures a person would type, one click each. */}
        <div className="flex flex-wrap gap-1">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(String(preset))}
              aria-pressed={Number(value) === preset}
              className={cn(
                'tnum rounded px-1.5 py-0.5 text-xs',
                Number(value) === preset
                  ? 'bg-[var(--color-cat-system-prompt)] text-white'
                  : 'bg-[var(--color-gridline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              {usd(preset).replace(/\.00$/, '')}
            </button>
          ))}
          {value !== '' ? (
            <button
              type="button"
              onClick={() => onChange('')}
              className="rounded px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              none
            </button>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">{basis}</p>
    </div>
  )
}

/**
 * @param {{ rows: any[] }} props
 */
function Progress({ rows }) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-2">
      {rows.map((row) => (
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
    </div>
  )
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function figureOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

/**
 * @param {string | null} path
 * @returns {string}
 */
function shortPath(path) {
  return String(path ?? '').replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~')
}
