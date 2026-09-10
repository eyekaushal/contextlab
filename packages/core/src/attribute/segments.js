/**
 * Splitting the system prompt into pieces a user can act on.
 *
 * "Your system prompt is 14,000 tokens" is not actionable. "9,200 of it is
 * CLAUDE.md" is — that file is yours and you can trim it. That is the whole
 * reason to segment.
 *
 * Markers are a table so supporting another agent is one entry. When nothing
 * matches, the prompt stays a single `base` segment, which is the honest
 * answer rather than an invented breakdown.
 *
 * Pure.
 *
 * @module
 */

/**
 * @typedef {Object} SystemPromptSegment
 * @property {string} kind   base | memory_file | injected
 * @property {string} label
 * @property {string} text
 * @property {number} chars
 * @property {number} start  offset into the original prompt
 */

/**
 * @param {string} path
 * @returns {string}
 */
function basename(path) {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * Recognisable injections, in the form the agents actually write them.
 *
 * @type {{ kind: string, pattern: RegExp, label: (match: RegExpExecArray) => string }[]}
 */
const MARKERS = [
  {
    // Claude Code: "Contents of /repo/CLAUDE.md (project instructions, ...):"
    kind: 'memory_file',
    pattern: /Contents of ([^\s(]+)\s*\(([^)]*)\)\s*:/g,
    label: (match) => basename(match[1] ?? 'memory file'),
  },
  {
    // Codex and Gemini inject their memory files under a plain heading.
    kind: 'memory_file',
    pattern: /^#{1,3}\s+(AGENTS\.md|GEMINI\.md|CLAUDE\.md|CONVENTIONS\.md)\s*$/gm,
    label: (match) => match[1] ?? 'memory file',
  },
  {
    kind: 'injected',
    pattern: /<system-reminder>/g,
    label: () => 'system reminder',
  },
]

/**
 * Split a system prompt at every marker we recognise.
 *
 * A segment runs from its marker to the start of the next one, so the pieces
 * partition the prompt exactly — segment sizes always add back up to the whole,
 * and no part of the prompt goes unaccounted for.
 *
 * @param {string} text
 * @returns {SystemPromptSegment[]}
 */
export function segmentSystemPrompt(text) {
  if (typeof text !== 'string' || text === '') return []

  /** @type {{ index: number, kind: string, label: string }[]} */
  const found = []

  for (const marker of MARKERS) {
    // Fresh regex each time: /g patterns carry lastIndex between calls.
    const pattern = new RegExp(marker.pattern.source, marker.pattern.flags)
    let match = pattern.exec(text)
    while (match !== null) {
      found.push({ index: match.index, kind: marker.kind, label: marker.label(match) })
      match = pattern.exec(text)
    }
  }

  if (found.length === 0) {
    return [{ kind: 'base', label: 'base prompt', text, chars: text.length, start: 0 }]
  }

  found.sort((a, b) => a.index - b.index)

  /** @type {SystemPromptSegment[]} */
  const segments = []

  const firstIndex = found[0]?.index ?? 0
  if (firstIndex > 0) {
    const head = text.slice(0, firstIndex)
    segments.push({
      kind: 'base',
      label: 'base prompt',
      text: head,
      chars: head.length,
      start: 0,
    })
  }

  found.forEach((marker, i) => {
    const end = found[i + 1]?.index ?? text.length
    const body = text.slice(marker.index, end)
    segments.push({
      kind: marker.kind,
      label: marker.label,
      text: body,
      chars: body.length,
      start: marker.index,
    })
  })

  return segments
}

/**
 * Merge segments naming the same thing — a memory file injected twice is one
 * file the user can trim, not two.
 *
 * @param {SystemPromptSegment[]} segments
 * @returns {{ kind: string, label: string, chars: number, count: number }[]}
 */
export function mergeSegments(segments) {
  /** @type {Map<string, { kind: string, label: string, chars: number, count: number }>} */
  const merged = new Map()

  for (const segment of segments) {
    const key = `${segment.kind} ${segment.label}`
    const existing = merged.get(key)
    if (existing) {
      existing.chars += segment.chars
      existing.count += 1
      continue
    }
    merged.set(key, {
      kind: segment.kind,
      label: segment.label,
      chars: segment.chars,
      count: 1,
    })
  }

  return [...merged.values()].sort((a, b) => b.chars - a.chars)
}
