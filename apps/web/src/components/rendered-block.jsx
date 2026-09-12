/**
 * A block as it was actually used, rather than as it was stored.
 *
 * `docs/DESIGN.md`: "Right pane shows the selected message rendered + raw +
 * metadata." We shipped raw only, so a tool call read as `{command:npm install}`
 * — the serialised form we hash and index, not the call anyone made.
 *
 * Four shapes, because there are four:
 *
 * - a **tool call** is a signature and its arguments
 * - a **tool result** is usually long, and what matters is the top and the
 *   bottom — the command that ran and how it ended
 * - **text** is markdown, and reading `## Heading` as three literal characters
 *   is reading it wrong
 * - an **image** is not here at all; the bytes are never stored
 *
 * No HTML is ever injected. Every element below is constructed, so a message
 * containing `<script>` renders as the text it is.
 *
 * @module
 */

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { exact } from '../lib/format.js'
import { cn } from '../lib/utils.js'

/** Lines kept at each end of a long tool result before the middle collapses. */
const HEAD_LINES = 24
const TAIL_LINES = 12

/**
 * @param {{ block: any, text: string }} props
 */
export function Rendered({ block, text }) {
  if (block.isImage) return <ImageBlock block={block} />
  if (block.blockType === 'tool_use') return <ToolCall block={block} text={text} />
  if (block.blockType === 'tool_result') return <Folded text={text} />
  return <Markdown text={text} />
}

/**
 * A call, as a signature and a table of arguments.
 *
 * @param {{ block: any, text: string }} props
 */
function ToolCall({ block, text }) {
  const args = parseArguments(text)
  const name = block.toolName || 'tool'

  return (
    <div className="space-y-2">
      <div className="font-mono text-xs">
        <span className="text-[var(--color-cat-tool_calls)]">{name}</span>
        <span className="text-[var(--color-text-muted)]">
          ({args ? args.map((argument) => argument.name).join(', ') : '…'})
        </span>
      </div>

      {args === null ? (
        // The serialisation did not have the shape we write, so no table is
        // invented for it. A wrong table is worse than none.
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--color-text-secondary)]">
          {text}
        </pre>
      ) : args.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          Called with no arguments.
        </p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <tbody>
            {args.map((argument) => (
              <tr
                key={argument.name}
                className="border-b border-[var(--color-border-subtle)] last:border-0 align-top"
              >
                <td className="w-32 py-1 pr-3 font-mono text-[var(--color-text-muted)]">
                  {argument.name}
                </td>
                <td className="py-1 font-mono text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                  <span className="whitespace-pre-wrap break-words">
                    {argument.value || <em className="not-italic opacity-60">empty</em>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * A long result, with its middle folded away.
 *
 * The top says what ran and the bottom says how it ended. The twelve hundred
 * identical deprecation warnings in between are the reason the block is on this
 * screen at all — they are worth counting, not reading.
 *
 * @param {{ text: string }} props
 */
function Folded({ text }) {
  const [open, setOpen] = useState(false)
  const lines = String(text).split('\n')

  if (lines.length <= HEAD_LINES + TAIL_LINES + 1 || open) {
    return (
      <>
        <Lines lines={lines} />
        {open ? (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Collapse the middle again
          </button>
        ) : null}
      </>
    )
  }

  const hidden = lines.length - HEAD_LINES - TAIL_LINES

  return (
    <div>
      <Lines lines={lines.slice(0, HEAD_LINES)} />

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="my-1 flex w-full items-center gap-1.5 rounded border border-dashed border-[var(--color-border-subtle)] px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
      >
        <ChevronDown className="size-3" />
        {exact(hidden)} lines hidden — show all {exact(lines.length)}
      </button>

      <Lines lines={lines.slice(-TAIL_LINES)} />
    </div>
  )
}

/**
 * @param {{ lines: string[] }} props
 */
function Lines({ lines }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
      {lines.join('\n')}
    </pre>
  )
}

/**
 * @param {{ block: any }} props
 */
function ImageBlock({ block }) {
  return (
    <div className="space-y-1.5 rounded border border-dashed border-[var(--color-border-subtle)] px-3 py-6 text-center">
      <p className="text-xs text-[var(--color-text-secondary)]">Image</p>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        {/* The honest statement: we never kept the bytes, and we never counted
            them either — an encoder over base64 is the trap WIRE-FORMATS §3
            warns about. */}
        The image data is never stored. Counted at a flat{' '}
        {exact(block.tokensEstimated || 1600)}-token estimate, not measured.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/**
 * Markdown, as elements rather than as HTML.
 *
 * Enough of it to read a message: fenced code, headings, lists, quotes, and
 * inline code and bold. Not a spec implementation — a message that uses
 * something this does not know renders as its own text, which is exactly what
 * the raw view would have shown anyway.
 *
 * @param {{ text: string }} props
 */
export function Markdown({ text }) {
  const blocks = parseMarkdown(String(text ?? ''))

  return (
    <div className="space-y-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
      {blocks.map((node) => {
        if (node.kind === 'code') {
          return (
            <pre
              key={node.key}
              className="overflow-x-auto rounded border border-[var(--color-border-subtle)] bg-[var(--color-page)] px-2.5 py-2 font-mono text-[11px] leading-relaxed"
            >
              {node.lines.join('\n')}
            </pre>
          )
        }

        if (node.kind === 'heading') {
          return (
            <p
              key={node.key}
              className={cn(
                'font-semibold text-[var(--color-text-primary)]',
                node.level <= 2 ? 'text-sm' : 'text-xs',
              )}
            >
              <Inline text={node.text} />
            </p>
          )
        }

        if (node.kind === 'quote') {
          return (
            <blockquote
              key={node.key}
              className="border-l-2 border-[var(--color-border-subtle)] pl-2.5 text-[var(--color-text-muted)]"
            >
              <Inline text={node.text} />
            </blockquote>
          )
        }

        if (node.kind === 'list') {
          // The list-style belongs on the list, not on each item, and each
          // item is keyed by the source line it came from rather than by where
          // it sits in the array.
          const List = node.ordered ? 'ol' : 'ul'
          return (
            <List
              key={node.key}
              className={cn(
                'space-y-0.5 pl-5',
                node.ordered ? 'list-decimal' : 'list-disc',
              )}
            >
              {node.items.map((item) => (
                <li key={item.key}>
                  <Inline text={item.text} />
                </li>
              ))}
            </List>
          )
        }

        return (
          <p key={node.key} className="whitespace-pre-wrap break-words">
            <Inline text={node.text} />
          </p>
        )
      })}
    </div>
  )
}

/**
 * Inline `code` and **bold**, as spans.
 *
 * @param {{ text: string }} props
 */
function Inline({ text }) {
  const parts = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0

  for (const found of String(text).matchAll(pattern)) {
    const at = found.index ?? 0
    if (at > last)
      parts.push({ key: `t${last}`, text: text.slice(last, at), kind: 'text' })
    const piece = found[0]
    parts.push({
      key: `m${at}`,
      text: piece.slice(piece.startsWith('`') ? 1 : 2, piece.startsWith('`') ? -1 : -2),
      kind: piece.startsWith('`') ? 'code' : 'bold',
    })
    last = at + piece.length
  }
  if (last < text.length)
    parts.push({ key: `t${last}`, text: text.slice(last), kind: 'text' })

  return (
    <>
      {parts.map((part) =>
        part.kind === 'code' ? (
          <code
            key={part.key}
            className="rounded bg-[var(--color-gridline)] px-1 font-mono text-[11px]"
          >
            {part.text}
          </code>
        ) : part.kind === 'bold' ? (
          <strong
            key={part.key}
            className="font-semibold text-[var(--color-text-primary)]"
          >
            {part.text}
          </strong>
        ) : (
          <span key={part.key}>{part.text}</span>
        ),
      )}
    </>
  )
}

/**
 * @typedef {{ kind: 'code', key: string, lines: string[] }
 *         | { kind: 'heading', key: string, level: number, text: string }
 *         | { kind: 'quote', key: string, text: string }
 *         | { kind: 'list', key: string, ordered: boolean,
 *             items: { key: string, text: string }[] }
 *         | { kind: 'para', key: string, text: string }} Node
 */

/**
 * @param {string} text
 * @returns {Node[]}
 */
export function parseMarkdown(text) {
  const lines = text.split('\n')
  /** @type {Node[]} */
  const nodes = []
  /** @type {string[]} */
  let paragraph = []

  const flush = (/** @type {number} */ at) => {
    if (paragraph.length === 0) return
    nodes.push({ kind: 'para', key: `p${at}`, text: paragraph.join('\n') })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''

    if (line.trimStart().startsWith('```')) {
      flush(i)
      /** @type {string[]} */
      const body = []
      i += 1
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith('```')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      nodes.push({ kind: 'code', key: `c${i}`, lines: body })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush(i)
      nodes.push({
        kind: 'heading',
        key: `h${i}`,
        level: heading[1]?.length ?? 1,
        text: heading[2] ?? '',
      })
      continue
    }

    if (/^>\s?/.test(line)) {
      flush(i)
      nodes.push({ kind: 'quote', key: `q${i}`, text: line.replace(/^>\s?/, '') })
      continue
    }

    const bullet = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet) {
      flush(i)
      const ordered = /\d/.test(bullet[1] ?? '')
      const first = i
      /** @type {{ key: string, text: string }[]} */
      const items = [{ key: `i${i}`, text: bullet[2] ?? '' }]
      while (i + 1 < lines.length) {
        const next = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i + 1] ?? '')
        if (!next || /\d/.test(next[1] ?? '') !== ordered) break
        i += 1
        items.push({ key: `i${i}`, text: next[2] ?? '' })
      }
      nodes.push({ kind: 'list', key: `l${first}`, ordered, items })
      continue
    }

    if (line.trim() === '') {
      flush(i)
      continue
    }

    paragraph.push(line)
  }

  flush(lines.length)
  return nodes
}

// ---------------------------------------------------------------------------
// Tool arguments
// ---------------------------------------------------------------------------

/**
 * Read back the arguments of a tool call.
 *
 * The stored form is `stableStringify`'s — `{command:npm install,timeout:30}`.
 * It is our own writer, so reading it is not a guess; but it is lossy for a
 * value containing an unbalanced brace, so anything that does not parse cleanly
 * returns null and the caller shows the raw string instead.
 *
 * @param {string} text
 * @returns {{ name: string, value: string }[] | null}
 */
export function parseArguments(text) {
  const source = String(text ?? '').trim()
  if (!source.startsWith('{') || !source.endsWith('}')) return null

  const body = source.slice(1, -1)
  if (body.trim() === '') return []

  /** @type {string[]} */
  const pieces = []
  let depth = 0
  let start = 0

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]
    if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth -= 1
    else if (char === ',' && depth === 0) {
      pieces.push(body.slice(start, i))
      start = i + 1
    }
    if (depth < 0) return null
  }
  if (depth !== 0) return null
  pieces.push(body.slice(start))

  /** @type {{ name: string, value: string }[]} */
  const args = []
  for (const piece of pieces) {
    const cut = piece.indexOf(':')
    if (cut < 0) return null
    const name = piece.slice(0, cut).trim()
    if (!name) return null
    args.push({ name, value: piece.slice(cut + 1) })
  }
  return args
}
