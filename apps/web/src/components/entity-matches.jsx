/**
 * What a search term matched, besides the words inside messages.
 *
 * Search was FTS over message content only. A reader who typed `playwright`
 * expected the MCP server finding and got nothing back — an MCP server that is
 * never called appears in no message at all; its cost is in the tool
 * definitions. Same for a rule name, or a file read fifteen times.
 *
 * Grouped by kind and labelled, because a finding and a filename are different
 * kinds of answer and merging them into one ranking buries whichever loses.
 *
 * @module
 */

import { truncate, usd } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import { Severity } from './health.jsx'
import { Card } from './ui/card.jsx'

/**
 * Order matters: a finding is the answer to "what is costing me", and the rest
 * are the raw material it was computed from.
 *
 * @type {{ kind: string, label: string }[]}
 */
const KINDS = [
  { kind: 'finding', label: 'Findings' },
  { kind: 'mcp_server', label: 'MCP servers' },
  { kind: 'file', label: 'Files' },
  { kind: 'tool', label: 'Tools' },
  { kind: 'prompt_segment', label: 'Prompt segments' },
]

/** Enough to show the shape of the answer without becoming a second table. */
const PER_KIND = 4

/**
 * @param {{ entities: any[], query: string }} props
 */
export function EntityMatches({ entities, query }) {
  if (!query || !entities || entities.length === 0) return null

  const groups = KINDS.map((group) => ({
    ...group,
    rows: entities.filter((entity) => entity.kind === group.kind),
  })).filter((group) => group.rows.length > 0)

  if (groups.length === 0) return null

  return (
    <Card className="space-y-2 p-3">
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        “{truncate(query, 40)}” also matches
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <div key={group.kind} className="min-w-0 space-y-1">
            <div className="text-xs text-[var(--color-text-muted)]">
              {group.label}
              {group.rows.length > PER_KIND ? (
                // Never a silent truncation.
                <span>
                  {' '}
                  · showing {PER_KIND} of {group.rows.length}
                </span>
              ) : null}
            </div>

            {group.rows.slice(0, PER_KIND).map((entity) => (
              <button
                key={`${entity.kind}:${entity.name}:${entity.sessionId}`}
                type="button"
                onClick={() =>
                  navigate(
                    entity.kind === 'finding'
                      ? `/s/${encodeURIComponent(entity.sessionId)}/optimize`
                      : `/s/${encodeURIComponent(entity.sessionId)}`,
                  )
                }
                className="flex w-full items-center gap-1.5 text-left text-xs hover:text-[var(--color-cat-system-prompt)]"
              >
                {entity.kind === 'finding' ? (
                  <Severity severity={entity.severity} />
                ) : null}
                <span className="min-w-0 flex-1 truncate" title={String(entity.name)}>
                  {shortName(entity)}
                </span>
                <span className="tnum shrink-0 text-[var(--color-text-muted)]">
                  {usd(entity.costUsd)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Card>
  )
}

/**
 * A path's last segment is what a reader recognises; the whole path is in the
 * tooltip, so nothing is lost.
 *
 * @param {any} entity
 * @returns {string}
 */
function shortName(entity) {
  const name = String(entity.name ?? '')
  return entity.kind === 'file' ? (name.split('/').pop() ?? name) : name
}
