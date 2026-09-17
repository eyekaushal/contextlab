/**
 * The export menu.
 *
 * Downloads go straight through the browser to `/api/export`, so a large
 * session never passes through JavaScript memory on its way to disk.
 *
 * The content choice is the part worth pausing over: a shared session is
 * somebody's source code and prompts, so previews are the default and the full
 * text is something you opt into.
 *
 * @module
 */

import { ChevronDown, Download, FileJson, FileText, Hash, Waypoints } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { url } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.jsx'

/**
 * @param {{ sessionId?: string, className?: string }} props
 */
export function ExportMenu({ sessionId, className }) {
  const [open, setOpen] = useState(false)
  const container = useRef(/** @type {any} */ (null))

  useEffect(() => {
    if (!open) return
    /** @param {any} event */
    const onClick = (event) => {
      if (!container.current?.contains(event.target)) setOpen(false)
    }
    /** @param {any} event */
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items = exportItems(sessionId)

  return (
    <div ref={container} className={cn('relative', className)}>
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Download className="size-3" />
        Export
        <ChevronDown className="size-3" />
      </Button>

      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded border',
            'border-[var(--color-border-subtle)] bg-[var(--color-page)] shadow-lg',
          )}
        >
          {items.map((item) => (
            <a
              key={item.key}
              role="menuitem"
              href={item.href}
              download
              onClick={() => setOpen(false)}
              className="flex items-start gap-2.5 px-3 py-2 hover:bg-[var(--color-gridline)]"
            >
              {/* An icon per option: the shape is what a reader remembers the
                  next time, before they have read the words again. */}
              <item.Icon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-[var(--color-text-secondary)]"
              />
              <span className="min-w-0">
                <span className="block text-sm text-[var(--color-text-primary)]">
                  {item.label}
                </span>
                <span className="block text-xs text-[var(--color-text-muted)]">
                  {item.hint}
                </span>
              </span>
            </a>
          ))}

          <p className="border-t border-[var(--color-border-subtle)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            {/* Nothing is uploaded anywhere. Saying so where someone is about to
                share a file is worth three lines. */}
            Saved to your machine. contextlab has no server to send it to.
          </p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The four ways out, each with the mark a reader remembers it by.
 *
 * @param {string} [sessionId]
 * @returns {{ key: string, Icon: any, label: string, hint: string, href: string }[]}
 */
export function exportItems(sessionId) {
  const scope = sessionId ? { session: sessionId } : {}
  const label = sessionId ? 'This session' : 'All sessions'

  return [
    {
      key: 'preview',
      Icon: FileJson,
      label: `${label} (.ctxlab.json)`,
      hint: 'previews only',
      href: url('/api/export', { ...scope, content: 'preview' }),
    },
    {
      key: 'full',
      Icon: FileText,
      label: `${label}, full text`,
      hint: 'includes your prompts and code',
      href: url('/api/export', { ...scope, content: 'full' }),
    },
    {
      key: 'none',
      Icon: Hash,
      label: `${label}, numbers only`,
      hint: 'no message content at all',
      href: url('/api/export', { ...scope, content: 'none' }),
    },
    {
      key: 'otlp',
      Icon: Waypoints,
      label: 'OpenTelemetry traces (.otlp.json)',
      hint: 'for an existing pipeline',
      href: url('/api/export', { ...scope, format: 'otlp', content: 'none' }),
    },
  ]
}
