/**
 * A figure, as a card.
 *
 * Before this a stat was a label and a number floating in a row, and five of
 * them spread across a wide screen with nothing holding them read as
 * scattered rather than aligned. The reference dashboard puts each figure in
 * its own tile with a mark, the number large, and an arrow saying which way it
 * moved. So: icon, label, number, delta, hint — one card, every time.
 *
 * `delta` is optional and honest. A figure with no prior period shows no
 * arrow rather than an invented one; a prior period of zero shows "new"
 * rather than an infinite percentage.
 *
 * @module
 */

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { Card } from './ui/card.jsx'

/**
 * @typedef {Object} Delta
 * @property {number} current
 * @property {number} previous
 * @property {string} label            "vs yesterday"
 * @property {boolean} [higherIsWorse] spend up is bad; findings down is good
 */

/**
 * @param {{ label: string, value: any, hint?: any, tone?: string, icon?: any,
 *           delta?: Delta, className?: string }} props
 */
export function Stat({ label, value, hint, tone, icon: Icon, delta, className }) {
  return (
    <Card className={cn('flex min-w-0 flex-col gap-1.5 px-4 py-3', className)}>
      <div className="flex items-center gap-1.5 text-sm uppercase tracking-wide text-[var(--color-text-muted)]">
        {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
        <span className="truncate">{label}</span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <div
          className="tnum truncate text-2xl font-semibold leading-none tracking-tight"
          style={tone ? { color: tone } : undefined}
        >
          {value}
        </div>
        {delta ? <DeltaChip delta={delta} /> : null}
      </div>

      {hint ? (
        <div className="truncate text-sm text-[var(--color-text-secondary)]">{hint}</div>
      ) : null}
    </Card>
  )
}

/**
 * The arrow and the percentage.
 *
 * Colour follows meaning, not direction: spend going up is red, findings going
 * down is green, and a measure with no better or worse stays grey.
 *
 * @param {{ delta: Delta }} props
 */
export function DeltaChip({ delta }) {
  const { current, previous, label, higherIsWorse } = delta
  const shape = describeDelta(current, previous)

  const worse =
    higherIsWorse === undefined || shape.direction === 'flat'
      ? null
      : (shape.direction === 'up') === higherIsWorse

  const Icon =
    shape.direction === 'up'
      ? ArrowUpRight
      : shape.direction === 'down'
        ? ArrowDownRight
        : Minus

  return (
    <span
      className={cn(
        'tnum inline-flex items-center gap-0.5 text-sm',
        worse === null
          ? 'text-[var(--color-text-muted)]'
          : worse
            ? 'text-[var(--color-status-critical)]'
            : 'text-[var(--color-status-good)]',
      )}
      title={`${shape.text} ${label}`}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {shape.text}
      <span className="sr-only"> {label}</span>
    </span>
  )
}

/**
 * @param {number} current
 * @param {number} previous
 * @returns {{ direction: 'up' | 'down' | 'flat', text: string }}
 */
export function describeDelta(current, previous) {
  if (previous <= 0) {
    return current > 0
      ? { direction: 'up', text: 'new' }
      : { direction: 'flat', text: 'same' }
  }
  const ratio = (current - previous) / previous
  if (Math.abs(ratio) < 0.005) return { direction: 'flat', text: 'same' }
  const percent = `${Math.round(Math.abs(ratio) * 100)}%`
  return ratio > 0
    ? { direction: 'up', text: percent }
    : { direction: 'down', text: percent }
}

/**
 * A row of stat cards, equal width, one gutter.
 *
 * @param {any} props
 */
export function StatRow({ className, ...props }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4', className)} {...props} />
  )
}
