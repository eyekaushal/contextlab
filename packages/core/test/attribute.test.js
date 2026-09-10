import { describe, expect, it } from 'vitest'
import {
  attributeComposition,
  entriesOfType,
  filePathFrom,
  mergeAttribution,
  mergeSegments,
  segmentSystemPrompt,
  shortenPath,
} from '../src/attribute/index.js'
import { composeRequest } from '../src/compose/index.js'
import { parseRequest } from '../src/parse/index.js'

/**
 * @param {unknown} body
 * @returns {any}
 */
function compose(body) {
  const parsed = parseRequest(body, { apiFormat: 'anthropic-messages' })
  return composeRequest(/** @type {any} */ (parsed))
}

describe('filePathFrom', () => {
  it('finds the path whatever the tool calls it', () => {
    expect(filePathFrom({ file_path: '/repo/a.js' })).toBe('/repo/a.js')
    expect(filePathFrom({ filePath: '/repo/b.js' })).toBe('/repo/b.js')
    expect(filePathFrom({ absolute_path: '/repo/c.js' })).toBe('/repo/c.js')
    expect(filePathFrom({ notebook_path: '/repo/d.ipynb' })).toBe('/repo/d.ipynb')
    expect(filePathFrom({ path: '~/notes.md' })).toBe('~/notes.md')
    expect(filePathFrom({ file_path: 'C:\\repo\\e.js' })).toBe('C:\\repo\\e.js')
  })

  it('prefers the specific key when a tool sends both', () => {
    // Grep sends `path` as the directory it searched and file_path as the hit.
    expect(filePathFrom({ path: '/repo', file_path: '/repo/src/app.js' })).toBe(
      '/repo/src/app.js',
    )
  })

  it('ignores arguments that are not paths', () => {
    expect(filePathFrom({ pattern: 'TODO', command: 'npm install' })).toBeNull()
    expect(filePathFrom({ file_path: 'not-a-path' })).toBeNull()
    expect(filePathFrom(undefined)).toBeNull()
    expect(filePathFrom({})).toBeNull()
  })

  it('shortens a path against the project root', () => {
    expect(shortenPath('/repo/src/app.js', '/repo')).toBe('src/app.js')
    expect(shortenPath('/elsewhere/x.js', '/repo')).toBe('/elsewhere/x.js')
  })
})

describe('segmenting the system prompt', () => {
  it('splits a claude code prompt at its memory-file marker', () => {
    const prompt = [
      'You are Claude Code, an interactive CLI tool.',
      'Contents of /repo/CLAUDE.md (project instructions, checked into the codebase):',
      '# contextlab',
      'Some project rules that go on for a while.',
    ].join('\n')

    const segments = segmentSystemPrompt(prompt)
    expect(segments.map((s) => s.kind)).toEqual(['base', 'memory_file'])
    expect(segments[1]?.label).toBe('CLAUDE.md')
    expect(segments[1]?.text).toContain('# contextlab')
  })

  it('recognises the other agents memory files too', () => {
    const segments = segmentSystemPrompt('Base prompt here.\n\n## AGENTS.md\nrules')
    expect(segments.map((s) => s.label)).toEqual(['base prompt', 'AGENTS.md'])
  })

  it('separates injected reminders from the prompt proper', () => {
    const segments = segmentSystemPrompt(
      'Base.\n<system-reminder>do a thing</system-reminder>',
    )
    expect(segments.map((s) => s.kind)).toEqual(['base', 'injected'])
  })

  it('partitions the prompt exactly, losing nothing', () => {
    const prompt =
      'Base text.\nContents of /repo/CLAUDE.md (project instructions):\nrules\n<system-reminder>note</system-reminder>'
    const segments = segmentSystemPrompt(prompt)
    expect(segments.reduce((sum, s) => sum + s.chars, 0)).toBe(prompt.length)
  })

  it('says the whole thing is base rather than inventing a breakdown', () => {
    const segments = segmentSystemPrompt('An ordinary prompt with no markers at all.')
    expect(segments).toHaveLength(1)
    expect(segments[0]?.kind).toBe('base')
  })

  it('merges a memory file injected more than once', () => {
    const prompt = [
      'Base.',
      'Contents of /repo/CLAUDE.md (project instructions):',
      'first copy',
      'Contents of /repo/CLAUDE.md (project instructions):',
      'second copy',
    ].join('\n')
    const merged = mergeSegments(segmentSystemPrompt(prompt))
    const claudeMd = merged.find((piece) => piece.label === 'CLAUDE.md')
    expect(claudeMd?.count).toBe(2)
  })

  it('handles an empty prompt', () => {
    expect(segmentSystemPrompt('')).toEqual([])
  })
})

describe('attributing a turn', () => {
  const composition = compose({
    model: 'claude-opus-5',
    system:
      'You are Claude Code.\nContents of /repo/CLAUDE.md (project instructions):\nrules here',
    tools: [
      { name: 'Read', description: 'Read a file', input_schema: { type: 'object' } },
      {
        name: 'mcp__playwright__browser_click',
        description: 'Click an element in the browser',
        input_schema: { type: 'object', properties: { selector: { type: 'string' } } },
      },
      {
        name: 'mcp__playwright__browser_snapshot',
        description: 'Take an accessibility snapshot of the page',
        input_schema: { type: 'object' },
      },
    ],
    messages: [
      { role: 'user', content: 'read the auth module' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Read',
            input: { file_path: '/repo/auth.js' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: 'export function login() {}\n'.repeat(200),
          },
        ],
      },
    ],
  })

  const result = attributeComposition(composition, { inputPricePerMillion: 3 })

  it('joins a tool result back to the call that produced it', () => {
    // The result block names no tool; without the join it lands nowhere.
    const read = result.entries.find(
      (entry) => entry.entityType === 'tool' && entry.entityName === 'Read',
    )
    expect(read?.resultTokens).toBeGreaterThan(100)
    expect(read?.calls).toBe(1)
  })

  it('attributes the result to the file that was read', () => {
    const files = entriesOfType(result, 'file')
    expect(files).toHaveLength(1)
    expect(files[0]?.entityName).toBe('/repo/auth.js')
    expect(files[0]?.resultTokens).toBeGreaterThan(100)
  })

  it('groups mcp tools under their server', () => {
    const servers = entriesOfType(result, 'mcp_server')
    expect(servers.map((entry) => entry.entityName)).toEqual(['playwright'])
    // Two tool schemas, both re-sent every turn, neither ever called.
    expect(servers[0]?.definitionTokens).toBeGreaterThan(0)
    expect(servers[0]?.calls).toBe(0)
  })

  it('separates what a server costs to define from what it did', () => {
    const server = entriesOfType(result, 'mcp_server')[0]
    // This is the distinction the optimize screen ranks on: all definition,
    // no calls, means every token of it is waste.
    expect(server?.tokens).toBe(server?.definitionTokens)
    expect(server?.resultTokens).toBe(0)
  })

  it('splits the system prompt into pieces the user owns', () => {
    const segments = entriesOfType(result, 'prompt_segment')
    expect(segments.map((entry) => entry.entityName).sort()).toEqual([
      'CLAUDE.md',
      'base prompt',
    ])
    expect(segments.every((entry) => entry.tokens > 0)).toBe(true)
  })

  it('costs every entity at the input rate', () => {
    for (const entry of result.entries) {
      expect(entry.costUsd).toBeCloseTo((entry.tokens / 1_000_000) * 3)
    }
  })

  it('ranks the most expensive thing first', () => {
    const tokens = result.entries.map((entry) => entry.tokens)
    expect([...tokens].sort((a, b) => b - a)).toEqual(tokens)
  })

  it('handles a result whose call it never saw', () => {
    const orphan = compose({
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'output' }],
        },
      ],
    })
    const entries = attributeComposition(orphan).entries
    expect(entries[0]?.entityName).toBe('unknown tool')
  })

  it('attributes nothing when there is nothing to attribute', () => {
    const empty = attributeComposition(compose({ messages: [] }))
    expect(empty.entries).toEqual([])
    expect(empty.attributedTokens).toBe(0)
  })
})

describe('rolling turns up to a session', () => {
  it('multiplies a re-sent definition by the turns that carried it', () => {
    const body = {
      tools: [
        {
          name: 'mcp__playwright__browser_click',
          description: 'Click an element in the page by selector',
          input_schema: { type: 'object', properties: { selector: { type: 'string' } } },
        },
      ],
      messages: [{ role: 'user', content: 'hello' }],
    }

    const turn = attributeComposition(compose(body), { inputPricePerMillion: 3 })
    const session = mergeAttribution([turn, turn, turn], { inputPricePerMillion: 3 })

    const server = entriesOfType(session, 'mcp_server')[0]
    const perTurn = entriesOfType(turn, 'mcp_server')[0]
    // A server defined once and never used still costs its schema on every
    // turn. That product is what makes it worth removing.
    expect(server?.definitionTokens).toBe((perTurn?.definitionTokens ?? 0) * 3)
    expect(server?.calls).toBe(0)
    expect(server?.costUsd).toBeCloseTo((((perTurn?.tokens ?? 0) * 3) / 1_000_000) * 3)
  })

  it('sums the context across turns', () => {
    const turn = attributeComposition(
      compose({ messages: [{ role: 'user', content: 'hi' }] }),
    )
    const session = mergeAttribution([turn, turn])
    expect(session.totalTokens).toBe(turn.totalTokens * 2)
  })

  it('handles an empty session', () => {
    expect(mergeAttribution([]).entries).toEqual([])
  })
})
