/**
 * The header every screen starts with.
 *
 * Title on one line, the question it answers beneath it, and a note under
 * that. Before this the title and the question shared a line at 16 and 11px —
 * cluttered, and small enough that the question read as decoration. It is not
 * decoration: "Where did my money go?" is the reason the screen exists, so it
 * gets its own line at a size that can be read.
 *
 * Actions sit on the right and never wrap into the text. A back link, when
 * there is one, sits above the whole thing, out of the way of the title.
 *
 * @module
 */

import { ArrowLeft } from 'lucide-react'
import { navigate } from '../lib/router.js'
import { cn } from '../lib/utils.js'

/**
 * @param {{ title: any, question?: string, note?: any, back?: { to: string, label: string },
 *           actions?: any, className?: string }} props
 */
export function PageHeader({ title, question, note, back, actions, className }) {
  return (
    <header className={cn('space-y-1.5', className)}>
      {back ? (
        <button
          type="button"
          onClick={() => navigate(back.to)}
          className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <ArrowLeft className="size-3" />
          {back.label}
        </button>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {question ? (
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
              {question}
            </p>
          ) : null}
          {note ? (
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{note}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  )
}
