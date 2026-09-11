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

import { ChevronDown, Download } from 'lucide-react'
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

  const scope = sessionId ? { session: sessionId } : {}
  const label = sessionId ? 'This session' : 'All sessions'

  const items = [
    {
      key: 'preview',
      label: `${label} (.ctxlab.json)`,
      hint: 'previews only',
      href: url('/api/export', { ...scope, content: 'preview' }),
    },
    {
      key: 'full',
      label: `${label}, full text`,
      hint: 'includes your prompts and code',
      href: url('/api/export', { ...scope, content: 'full' }),
    },
    {
      key: 'none',
      label: `${label}, numbers only`,
      hint: 'no message content at all',
      href: url('/api/export', { ...scope, content: 'none' }),
    },
    {
      key: 'otlp',
      label: 'OpenTelemetry traces (.otlp.json)',
      hint: 'for an existing pipeline',
      href: url('/api/export', { ...scope, format: 'otlp', content: 'none' }),
    },
  ]

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
              className="block px-3 py-2 hover:bg-[var(--color-gridline)]"
            >
              <div className="text-sm text-[var(--color-text-primary)]">{item.label}</div>
              <div className="text-[11px] text-[var(--color-text-muted)]">
                {item.hint}
              </div>
            </a>
          ))}

          <p className="border-t border-[var(--color-border-subtle)] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
            {/* Nothing is uploaded anywhere. Saying so where someone is about to
                share a file is worth three lines. */}
            Saved to your machine. contextlab has no server to send it to.
          </p>
        </div>
      ) : null}
    </div>
  )
}
