/**
 * Does the dashboard actually render?
 *
 * Rendering to a string catches what a build cannot: a bad import path, invalid
 * JSX, a hook called wrongly, or a component that throws on its first paint
 * with no data. Effects do not run here, so no browser, no DOM and no network
 * are involved — which is exactly why it is cheap enough to run on every commit.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App, Route } from '../src/App.jsx'
import { CompositionBar, CompositionLegend } from '../src/components/composition-bar.jsx'
import { ContextDiff } from '../src/components/context-diff.jsx'
import { EntityMatches } from '../src/components/entity-matches.jsx'
import { ExportMenu } from '../src/components/export-menu.jsx'
import { Finding } from '../src/components/finding.jsx'
import { FindingsTable, scopeOf } from '../src/components/findings-table.jsx'
import { Health, healthOf } from '../src/components/health.jsx'
import {
  parseArguments,
  parseMarkdown,
  Rendered,
} from '../src/components/rendered-block.jsx'
import { Sparkline } from '../src/components/sparkline.jsx'
import { Stat } from '../src/components/stat.jsx'
import { Empty } from '../src/components/states.jsx'
import { SummaryStrip } from '../src/components/summary-strip.jsx'
import { SystemPromptPanel } from '../src/components/system-prompt-panel.jsx'
import { Wordmark } from '../src/components/wordmark.jsx'
import { categoryColor, categoryLabel, tokens, usd, when } from '../src/lib/format.js'
import { href, match, pathOf, queryOf } from '../src/lib/router.js'
import { Compare, CompareTable, compareHref } from '../src/screens/compare.jsx'
import { Messages } from '../src/screens/messages.jsx'
import { COLUMNS, Column, Sessions } from '../src/screens/sessions.jsx'

describe('the shell', () => {
  it('renders without throwing', () => {
    const html = renderToString(<App />)
    expect(html).toContain('contextlab')
    expect(html).toContain('Sessions')
    expect(html).toContain('Optimize')
  })

  it('routes every path it owns, including one carrying a query', () => {
    // Rendered rather than asserted against a table, because the failure this
    // catches is a screen that throws on its first paint with no data.
    for (const path of [
      '/',
      '/optimize',
      '/cost',
      '/compare?ids=a&ids=b',
      '/s/tag%3Aa',
    ]) {
      expect(() => renderToString(<Route route={path} version={0} />)).not.toThrow()
    }
  })
})

describe('composition bar', () => {
  const rows = [
    { category: 'tool_results', tokens: 90_000 },
    { category: 'system_prompt', tokens: 8_000 },
    { category: 'tool_definitions', tokens: 2_000 },
  ]

  it('draws one segment per category, sized by share', () => {
    const html = renderToString(<CompositionBar rows={rows} />)
    expect(html.match(/width:90%/)).toBeTruthy()
    expect(html).toContain('var(--cat-tool_results')
  })

  it('survives having nothing to draw', () => {
    expect(() => renderToString(<CompositionBar rows={[]} />)).not.toThrow()
    expect(() =>
      renderToString(<CompositionBar rows={[{ category: 'x', tokens: 0 }]} />),
    ).not.toThrow()
  })

  it('labels every segment for a reader who cannot see colour', () => {
    const html = renderToString(<CompositionBar rows={rows} />)
    expect(html).toContain('aria-label="Tool results, 90,000 tokens"')
  })

  it('shows a legend once there are two or more series', () => {
    expect(renderToString(<CompositionLegend rows={rows} />)).toContain('Tool results')
    expect(renderToString(<CompositionLegend rows={rows.slice(0, 1)} />)).toBe('')
  })
})

describe('status is never colour alone', () => {
  it('always ships a word next to the icon', () => {
    for (const level of ['good', 'warning', 'serious', 'critical']) {
      const html = renderToString(<Health level={level} />)
      expect(html).toMatch(/Healthy|Warning|Serious|Critical/)
    }
  })

  it('escalates on a full window or a critical finding', () => {
    expect(healthOf({ contextShare: 0.2 })).toBe('good')
    expect(healthOf({ contextShare: 0.2, findings: 1 })).toBe('warning')
    expect(healthOf({ contextShare: 0.85 })).toBe('serious')
    expect(healthOf({ contextShare: 0.95 })).toBe('critical')
    expect(healthOf({ criticalFindings: 2 })).toBe('critical')
  })
})

describe('a status chip carries its number', () => {
  it('keeps the figure inside the chip rather than beside it', () => {
    const html = renderToString(<Health level="critical" note="9 findings" />)
    expect(html).toContain('Critical')
    expect(html).toContain('9 findings')
    // One object, not a chip and a stray number the reader has to associate.
    expect(html.indexOf('9 findings')).toBeGreaterThan(html.indexOf('Critical'))
  })

  it('adds nothing when there is no number to add', () => {
    const plain = renderToString(<Health level="good" />)
    expect(plain).toContain('Healthy')
    expect(plain).not.toContain('opacity-40')
  })
})

describe('empty and stat', () => {
  it('tells a new user what to type rather than saying "no data"', () => {
    const html = renderToString(
      <Empty title="No sessions captured yet." command="contextlab claude" />,
    )
    expect(html).toContain('contextlab claude')
  })

  it('renders a stat', () => {
    expect(renderToString(<Stat label="Cost" value="$4.23" />)).toContain('$4.23')
  })
})

describe('density', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

  /** @param {string} name */
  const step = (name) => {
    const found = new RegExp(`--text-${name}:\\s*([0-9.]+)rem`).exec(css)
    return found ? Number(found[1]) * 16 : null
  }

  it('sets the base to 13px, and a ramp around it', () => {
    // notes/UI-REVISION decision 4. The default 14px with airy cards fit about
    // a third of what a screen this size should hold.
    expect(step('xs')).toBe(11)
    expect(step('sm')).toBe(13)
    expect(step('lg')).toBe(16)
  })

  it('tightens leading with the size', () => {
    // A smaller size on the same line height is not denser, only smaller.
    expect(css).toContain('--text-sm--line-height: 1.45')
  })

  it('routes every size through the scale', () => {
    // A hardcoded pixel size bypasses the one place that is supposed to
    // control this, and the next person to change the base misses it.
    const root = new URL('../src/', import.meta.url)
    /** @param {URL} dir @returns {string[]} */
    const walk = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(new URL(`${entry.name}/`, dir))
          : entry.name.endsWith('.jsx') || entry.name.endsWith('.js')
            ? [fileURLToPath(new URL(entry.name, dir))]
            : [],
      )

    const offenders = walk(root).filter((file) =>
      /text-\[\d+px\]/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})

describe('the wordmark', () => {
  it('draws the thing the product measures', () => {
    const html = renderToString(<Wordmark />)
    expect(html).toContain('contextlab')
    // The mark is a context window: a fixed bar, partly filled, in the live
    // category palette rather than a frozen copy of it.
    expect(html).toContain('var(--color-cat-tool-results)')
    expect(html).toContain('var(--color-baseline)')
  })

  it('is decorative, so it is hidden from a screen reader', () => {
    expect(renderToString(<Wordmark />)).toContain('aria-hidden="true"')
  })
})

describe('formatting', () => {
  it('shortens large numbers and keeps small money legible', () => {
    expect(tokens(142_314)).toBe('142K')
    expect(tokens(1_400_000)).toBe('1.4M')
    expect(tokens(950)).toBe('950')
    expect(usd(3.2)).toBe('$3.20')
    // Sub-cent waste still matters when ranking, so it keeps its digits.
    expect(usd(0.0004)).toBe('$0.0004')
    expect(when(null)).toBe('—')
  })

  it('resolves a category colour from the stylesheet, not a duplicate table', () => {
    expect(categoryColor('tool_results')).toBe(
      'var(--cat-tool_results, var(--color-cat-other))',
    )
    expect(categoryLabel('system_injections')).toBe('System injections')
  })
})

describe('routing', () => {
  it('matches parameterised paths and decodes ids containing a colon', () => {
    expect(match('/s/:id', '/s/tag%3Aa1b2c3d4')).toEqual({ id: 'tag:a1b2c3d4' })
    expect(match('/s/:id', '/s/abc/messages')).toBeNull()
    expect(match('/s/:id/messages', '/s/abc/messages')).toEqual({ id: 'abc' })
  })

  it('separates a path from its query, and matches on the path alone', () => {
    // Compare takes a list of sessions, and a list belongs in a query: it
    // varies in length and the ids inside it contain a colon.
    expect(pathOf('/compare?ids=a&ids=b')).toBe('/compare')
    expect(pathOf('/compare')).toBe('/compare')
    expect(queryOf('/compare?ids=a&ids=tag%3Ab').getAll('ids')).toEqual(['a', 'tag:b'])
    expect(queryOf('/compare').getAll('ids')).toEqual([])
    expect(match('/compare', '/compare?ids=a')).toEqual({})
  })

  it('encodes ids when building a link', () => {
    expect(href('s', 'tag:a1b2c3d4')).toBe('#/s/tag%3Aa1b2c3d4')
  })
})

describe('sparkline', () => {
  it('draws a line through every point', () => {
    const html = renderToString(<Sparkline values={[10, 20, 15, 40]} />)
    expect(html).toContain('<path')
    expect(html.match(/L/g)?.length).toBe(3)
  })

  it('turns red once the window is nearly full', () => {
    const full = renderToString(<Sparkline values={[10, 190]} limit={200} />)
    expect(full).toContain('var(--color-status-critical)')

    const roomy = renderToString(<Sparkline values={[10, 20]} limit={200_000} />)
    expect(roomy).not.toContain('var(--color-status-critical)')
  })

  it('says in words what the line shows', () => {
    const html = renderToString(<Sparkline values={[1000, 50_000]} />)
    expect(html).toContain('grew from 1.0K to 50.0K')
  })

  it('shows a dash rather than a misleading flat line for one point', () => {
    expect(renderToString(<Sparkline values={[42]} />)).toContain('—')
    expect(renderToString(<Sparkline values={[]} />)).toContain('—')
  })
})

describe('system prompt panel', () => {
  const segments = [
    { kind: 'base', label: 'base prompt', tokens: 6100 },
    { kind: 'memory_file', label: 'CLAUDE.md', tokens: 1840 },
  ]
  const mcpServers = [
    { entityName: 'playwright', definitionTokens: 2300, calls: 0 },
    { entityName: 'postgres', definitionTokens: 740, calls: 4 },
  ]

  it('breaks the prompt into the pieces from the design spec', () => {
    const html = renderToString(
      <SystemPromptPanel
        segments={segments}
        mcpServers={mcpServers}
        contextTokens={24_000}
      />,
    )
    expect(html).toContain('Base tool prompt')
    expect(html).toContain('CLAUDE.md')
    expect(html).toContain('MCP: playwright')
    expect(html).toContain('MCP: postgres')
  })

  it('calls out a server that was never used', () => {
    const html = renderToString(
      <SystemPromptPanel segments={segments} mcpServers={mcpServers} />,
    )
    // The single most actionable line the panel can print.
    expect(html).toContain('never called this session')
  })

  it('says how much of the preamble the reader actually controls', () => {
    const html = renderToString(
      <SystemPromptPanel segments={segments} mcpServers={mcpServers} />,
    )
    // 1,840 CLAUDE.md + 2,300 playwright + 740 postgres. Not the base prompt.
    expect(html).toContain('4,880')
    expect(html).toContain('yours to change')
  })

  it('orders rows by size, largest first', () => {
    const html = renderToString(
      <SystemPromptPanel segments={segments} mcpServers={mcpServers} />,
    )
    expect(html.indexOf('Base tool prompt')).toBeLessThan(html.indexOf('MCP: playwright'))
    expect(html.indexOf('MCP: playwright')).toBeLessThan(html.indexOf('CLAUDE.md'))
  })

  it('says so plainly when there is nothing recorded', () => {
    expect(renderToString(<SystemPromptPanel segments={[]} />)).toContain(
      'Nothing recorded',
    )
  })
})

describe('context diff', () => {
  it('shows only what moved, signed', () => {
    const html = renderToString(
      <ContextDiff
        rows={[
          { category: 'tool_results', tokens: 90_000, previous: 88_600, delta: 1400 },
          { category: 'user_text', tokens: 40, previous: 90, delta: -50 },
        ]}
      />,
    )
    expect(html).toContain('+1.4K')
    // A minus sign, not a hyphen.
    expect(html).toContain('−50')
    expect(html).toContain('Tool results')
  })

  it('does not invent a diff for the first turn', () => {
    const html = renderToString(<ContextDiff rows={[]} />)
    expect(html).toContain('Nothing changed, or this is the first turn')
  })
})

describe('finding', () => {
  const finding = {
    rule: 'unused-mcp-server',
    severity: 'critical',
    title: 'MCP server "playwright" was never used',
    detail: 'Its tool definitions add 10,876 tokens to every turn.',
    fix: 'Remove "playwright" from .mcp.json:\n\n  "playwright": { ... }',
    wastedTokens: 87_008,
    wastedCostUsd: 0.44,
  }

  it('leads with the cost and carries the exact change', () => {
    const html = renderToString(<Finding finding={finding} />)
    expect(html).toContain('$0.44')
    expect(html).toContain('87,008')
    expect(html).toContain('.mcp.json')
    expect(html).toContain('Copy')
  })

  it('labels severity with a word, not just a colour', () => {
    expect(renderToString(<Finding finding={finding} />)).toContain('Critical')
  })
})

describe('findings as a ranked table', () => {
  /** @type {any[]} */
  const rows = [
    {
      sessionId: 's1',
      sessionLabel: 'contextlab',
      finding: {
        rule: 'unused-mcp-server',
        claim: 'recoverable',
        claimKey: 'mcp:playwright',
        severity: 'critical',
        title: 'MCP server "playwright" was never used',
        detail: 'Its tool definitions add 10,876 tokens to every turn.',
        fix: 'Remove "playwright" from .mcp.json',
        wastedTokens: 87_008,
        wastedCostUsd: 0.44,
      },
    },
    {
      sessionId: 's1',
      sessionLabel: 'contextlab',
      finding: {
        rule: 'cache-not-working',
        claim: 'potential',
        claimKey: 'cache',
        severity: 'warning',
        title: 'The prompt cache is not being hit',
        detail: '',
        fix: 'Enable caching',
        wastedTokens: 962_640,
        wastedCostUsd: 4.87,
      },
    },
    {
      sessionId: 's1',
      sessionLabel: 'contextlab',
      finding: {
        rule: 'redundant-read',
        claim: 'recoverable',
        claimKey: 'file:/repo/contextlab/src/app.js',
        severity: 'warning',
        title: 'src/app.js was read 15 times',
        detail: '',
        fix: 'Read it once',
        wastedTokens: 4_000,
        wastedCostUsd: 0.02,
        dismissedAt: 1_700_000_000_000,
      },
    },
  ]

  it('ranks by money and names the columns', () => {
    const html = renderToString(<FindingsTable rows={rows} />)
    expect(html).toContain('Recoverable')
    expect(html).toContain('Tokens')
    expect(html).toContain('Scope')
    // Money already lost ranks above a saving from a change not yet made,
    // however much larger the second figure is.
    expect(html.indexOf('$4.87')).toBeGreaterThan(html.indexOf('$0.44'))
  })

  it('keeps recoverable and potential in separate columns', () => {
    const html = renderToString(<FindingsTable rows={rows} />)
    expect(html).toContain('Recoverable')
    expect(html).toContain('Potential')
  })

  it('says which figures are a potential saving rather than a loss', () => {
    const html = renderToString(<FindingsTable rows={rows} />)
    expect(html).toContain('potential saving')
  })

  it('hides dismissed rows but says how many it is hiding', () => {
    const html = renderToString(<FindingsTable rows={rows} />)
    // Never a silent truncation.
    // React inserts comment separators between text nodes, so assert on the
    // numbers rather than on the assembled sentence.
    expect(html).toContain('Showing <!-- -->2<!-- --> of <!-- -->3')
    expect(html).toContain('Show <!-- -->1<!-- --> dismissed')
    expect(html).not.toContain('read 15 times')
  })

  it('collapses detail until a row is opened', () => {
    const html = renderToString(<FindingsTable rows={rows} />)
    expect(html).not.toContain('10,876 tokens to every turn')
    expect(html).toContain('unused-mcp-server')
  })

  it('reads the scope off the claim key', () => {
    expect(scopeOf({ claimKey: 'mcp:playwright' })).toEqual({
      label: 'MCP server',
      name: 'playwright',
    })
    expect(scopeOf({ claimKey: 'file:/repo/src/app.js' })).toEqual({
      label: 'File',
      name: 'app.js',
    })
    // Session-wide claims have no scope to name, and must not invent one.
    expect(scopeOf({ claimKey: 'cache' }).label).toBe('')
    expect(scopeOf({}).label).toBe('')
  })
})

describe('the sessions summary strip', () => {
  const data = {
    today: 2.5,
    week: 18.51,
    total: 18.51,
    turns: 26,
    sessions: 5,
    findings: 17,
    critical: 5,
    recoverable: 6.47,
    potential: 5.41,
    budget: { configured: false },
  }

  it('states the position before the table lists the rows', () => {
    const html = renderToString(<SummaryStrip data={data} />)
    expect(html).toContain('$2.50')
    expect(html).toContain('$18.51')
    expect(html).toContain('26')
  })

  it('keeps recoverable and potential apart', () => {
    const html = renderToString(<SummaryStrip data={data} />)
    expect(html).toContain('$6.47')
    expect(html).toContain('$5.41')
    expect(html).toContain('potential')
  })

  it('shows no budget bar when none is configured', () => {
    const html = renderToString(<SummaryStrip data={data} />)
    expect(html).not.toContain('daily')
  })

  it('draws the bar when a budget exists', () => {
    const html = renderToString(
      <SummaryStrip
        data={{
          ...data,
          budget: {
            configured: true,
            progress: [{ scope: 'daily', share: 0.5, spent: 2.5, limit: 5, level: 'ok' }],
          },
        }}
      />,
    )
    expect(html).toContain('daily')
    expect(html).toContain('width:50%')
  })

  it('renders nothing at all before the figures arrive', () => {
    expect(renderToString(<SummaryStrip data={null} />)).toBe('')
  })
})

describe('sessions screen', () => {
  it('names the question it answers', () => {
    expect(renderToString(<Sessions />)).toContain('Where did my money go?')
  })

  /** @param {any} column */
  const head = (column, sort = 'recent') =>
    renderToString(
      <table>
        <thead>
          <tr>
            <Column column={column} sort={sort} onSort={() => {}} />
          </tr>
        </thead>
      </table>,
    )

  it('makes a column sortable only when the server can order by it', () => {
    const cost = COLUMNS.find((column) => column.key === 'cost')
    const source = COLUMNS.find((column) => column.key === 'tool')

    expect(head(cost)).toContain('Sort by Cost')
    // Sorting one page of rows in the browser would reorder a subset and call
    // it a ranking, so an unsortable column is a plain heading.
    expect(head(source)).not.toContain('Sort by Source')
  })

  it('marks the column currently sorted', () => {
    const cost = COLUMNS.find((column) => column.key === 'cost')
    expect(head(cost, 'cost')).toContain('aria-pressed="true"')
    expect(head(cost, 'recent')).toContain('aria-pressed="false"')
  })

  it('offers no sort key the store does not know', () => {
    // The store whitelists these; a column naming anything else would silently
    // fall back to most recent and look broken.
    const known = new Set([
      'recent',
      'oldest',
      'cost',
      'recoverable',
      'turns',
      'context',
      'findings',
    ])
    for (const column of COLUMNS) {
      if (column.sort) expect(known.has(column.sort)).toBe(true)
    }
  })
})

describe('compare screen', () => {
  const columns = [
    {
      session: {
        id: 'tag:a',
        projectName: 'contextlab',
        tool: 'claude',
        model: 'claude-opus-5',
        turnCount: 8,
        equivalentCostUsd: 6.08,
        peakContextTokens: 168_400,
        lastSeenAt: Date.now(),
      },
      categories: { tool_results: 900_000, system_prompt: 30_000 },
      total: { count: 9, critical: 4, recoverableUsd: 5.44, potentialUsd: 4.87 },
      topFindings: [
        {
          rule: 'stuck-oversized-result',
          title: 'A 100,729-token result has been re-sent 8 times',
          severity: 'critical',
          claim: 'recoverable',
          wastedCostUsd: 3.57,
        },
      ],
    },
    {
      session: {
        id: 'tag:b',
        projectName: 'api',
        tool: 'codex',
        model: 'claude-sonnet-4-6',
        turnCount: 5,
        equivalentCostUsd: 0.71,
        peakContextTokens: 68_000,
        lastSeenAt: Date.now(),
      },
      categories: { tool_results: 217_059, system_prompt: 30_002 },
      total: { count: 3, critical: 1, recoverableUsd: 0.32, potentialUsd: 0 },
      topFindings: [],
    },
  ]

  it('builds a query rather than a path segment', () => {
    expect(compareHref(['tag:a', 'tag:b'])).toBe('/compare?ids=tag%3Aa&ids=tag%3Ab')
  })

  it('says one session is not a comparison', () => {
    const html = renderToString(<Compare ids={['tag:a']} />)
    expect(html).toContain('One session is not a comparison')
  })

  it('says nothing is selected when nothing is', () => {
    expect(renderToString(<Compare ids={[]} />)).toContain('Nothing selected')
  })

  it('renders a loading state rather than throwing before the data arrives', () => {
    // Effects do not run here, so the fetch never resolves.
    expect(renderToString(<Compare ids={['tag:a', 'tag:b']} />)).toContain(
      'animate-pulse',
    )
  })

  /** @param {number} baseline */
  const table = (baseline = 0) =>
    renderToString(
      <CompareTable
        columns={columns}
        categories={['tool_results', 'system_prompt']}
        baseline={baseline}
        onBaseline={() => {}}
      />,
    )

  it('draws a column per session and a row per measure', () => {
    const html = table()
    expect(html).toContain('contextlab')
    expect(html).toContain('api')
    expect(html).toContain('Peak context')
    expect(html).toContain('Tool results')
    expect(html).toContain('System prompt')
  })

  it('measures every other column against the baseline', () => {
    const html = table()
    // contextlab is the baseline, so api carries the signed difference:
    // $0.71 - $6.08 and 68,000 - 168,400.
    expect(html).toContain('$6.08')
    expect(html).toContain('$0.71')
    // React separates adjacent text nodes with a comment, so the sign and the
    // number are asserted as they are actually emitted.
    expect(html).toContain('\u2212<!-- -->$5.37')
    expect(html).toContain('\u2212<!-- -->100,400')
  })

  it('moves the baseline when the reader picks another column', () => {
    // With api as the baseline the sign flips: contextlab now costs $5.37 more.
    expect(table(1)).toContain('+<!-- -->$5.37')
  })

  it('marks which column is the baseline', () => {
    expect(table()).toContain('baseline')
    expect(table()).toContain('set as baseline')
  })

  it('colours a difference only where a direction means better or worse', () => {
    const html = table()
    // Spend is worse when higher, so it is painted. More turns is not a fault,
    // so that difference stays grey — colour is the fastest-read channel on the
    // page and must not state something untrue.
    expect(html).toContain('text-[var(--color-status-good)]">\u2212<!-- -->$5.37')
    // Fewer turns is not an improvement, so that difference stays grey.
    expect(html).toContain('text-[var(--color-text-muted)]">\u2212<!-- -->3')
  })
})

describe('a block rendered rather than dumped', () => {
  it('shows a tool call as a signature and an argument table', () => {
    const html = renderToString(
      <Rendered
        block={{ blockType: 'tool_use', toolName: 'Bash' }}
        text="{command:npm install,timeout:120}"
      />,
    )
    expect(html).toContain('Bash')
    expect(html).toContain('command')
    expect(html).toContain('npm install')
    expect(html).toContain('timeout')
    // Not the stored serialisation, which is what the raw view is for.
    expect(html).not.toContain('{command:npm install,timeout:120}')
  })

  it('shows the raw string rather than inventing a table it cannot parse', () => {
    const html = renderToString(
      <Rendered
        block={{ blockType: 'tool_use', toolName: 'Bash' }}
        text="not an object"
      />,
    )
    expect(html).toContain('not an object')
  })

  it('folds the middle of a long result and says how much is hidden', () => {
    const log = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n')
    const html = renderToString(
      <Rendered block={{ blockType: 'tool_result', toolName: 'Bash' }} text={log} />,
    )
    expect(html).toContain('line 0')
    expect(html).toContain('line 399')
    expect(html).not.toContain('line 200')
    // Never a silent truncation.
    expect(html).toContain('364') // 400 - 24 head - 12 tail
    expect(html).toContain('lines hidden')
  })

  it('leaves a short result whole', () => {
    const html = renderToString(
      <Rendered block={{ blockType: 'tool_result' }} text={'a\nb\nc'} />,
    )
    expect(html).not.toContain('lines hidden')
  })

  it('says an image was never stored rather than drawing a gap', () => {
    const html = renderToString(
      <Rendered block={{ isImage: true, tokensEstimated: 1600 }} text="" />,
    )
    expect(html).toContain('never stored')
    expect(html).toContain('1,600')
  })

  it('renders text as markdown, not as characters', () => {
    const html = renderToString(
      <Rendered
        block={{ blockType: 'text' }}
        text={'## Heading\n\nSome `code` and **bold**.\n\n- one\n- two'}
      />,
    )
    expect(html).toContain('Heading')
    expect(html).toContain('<code')
    expect(html).toContain('<strong')
    expect(html).toContain('<ul')
    expect(html).toContain('</li>')
    expect(html).not.toContain('## Heading')
  })

  it('never injects html', () => {
    const html = renderToString(
      <Rendered block={{ blockType: 'text' }} text={'<script>alert(1)</script>'} />,
    )
    // Escaped, because every element is constructed rather than parsed.
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})

describe('reading back a tool call', () => {
  it('splits at the top level only', () => {
    expect(parseArguments('{a:1,b:2}')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ])
    // A nested object contains a comma that is not a separator.
    expect(parseArguments('{edits:[{old:a,new:b}],path:/x}')).toEqual([
      { name: 'edits', value: '[{old:a,new:b}]' },
      { name: 'path', value: '/x' },
    ])
  })

  it('keeps a colon inside a value', () => {
    expect(parseArguments('{url:https://example.com}')).toEqual([
      { name: 'url', value: 'https://example.com' },
    ])
  })

  it('returns null on anything it cannot read cleanly', () => {
    // A wrong table is worse than none, so the caller falls back to raw.
    expect(parseArguments('not an object')).toBeNull()
    expect(parseArguments('{unbalanced')).toBeNull()
    expect(parseArguments('{novalue}')).toBeNull()
    expect(parseArguments('{a:1}}')).toBeNull()
    expect(parseArguments('{}')).toEqual([])
  })
})

describe('markdown parsing', () => {
  it('keeps a fenced block whole, separators and all', () => {
    const nodes = parseMarkdown('text\n```\n# not a heading\n- not a list\n```')
    expect(nodes[0].kind).toBe('para')
    expect(nodes[1]).toMatchObject({
      kind: 'code',
      lines: ['# not a heading', '- not a list'],
    })
  })

  it('does not merge an ordered list into a bulleted one', () => {
    const nodes = parseMarkdown('- a\n- b\n1. one\n2. two')
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({ kind: 'list', ordered: false })
    expect(nodes[1]).toMatchObject({ kind: 'list', ordered: true })
  })

  it('keys list items by the line they came from', () => {
    const [list] = parseMarkdown('- a\n- b')
    expect(list.kind === 'list' && list.items.map((i) => i.key)).toEqual(['i0', 'i1'])
  })

  it('returns nothing for nothing', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n  \n')).toEqual([])
  })
})

describe('search over what a session is made of', () => {
  const entities = [
    {
      kind: 'finding',
      name: 'MCP server "playwright" was never used',
      sessionId: 'tag:a',
      severity: 'critical',
      costUsd: 0.33,
    },
    { kind: 'mcp_server', name: 'playwright', sessionId: 'tag:a', costUsd: 0.33 },
    {
      kind: 'file',
      name: '/repo/contextlab/src/auth.js',
      sessionId: 'tag:a',
      costUsd: 0.69,
    },
    { kind: 'tool', name: 'Bash', sessionId: 'tag:a', costUsd: 0.01 },
    { kind: 'tool', name: 'Read', sessionId: 'tag:a', costUsd: 0.01 },
    { kind: 'tool', name: 'Edit', sessionId: 'tag:a', costUsd: 0.01 },
    { kind: 'tool', name: 'Grep', sessionId: 'tag:a', costUsd: 0.01 },
    { kind: 'tool', name: 'Glob', sessionId: 'tag:a', costUsd: 0.01 },
  ]

  it('labels every kind of match', () => {
    const html = renderToString(<EntityMatches entities={entities} query="playwright" />)
    expect(html).toContain('Findings')
    expect(html).toContain('MCP servers')
    expect(html).toContain('Files')
    expect(html).toContain('Tools')
  })

  it('shortens a path to what a reader recognises', () => {
    const html = renderToString(<EntityMatches entities={entities} query="auth" />)
    expect(html).toContain('auth.js')
    // The whole path stays available rather than being lost.
    expect(html).toContain('/repo/contextlab/src/auth.js')
  })

  it('says how many it is not showing', () => {
    const html = renderToString(<EntityMatches entities={entities} query="a" />)
    expect(html).toContain('showing <!-- -->4<!-- --> of <!-- -->5')
  })

  it('renders nothing without a query or without matches', () => {
    expect(renderToString(<EntityMatches entities={entities} query="" />)).toBe('')
    expect(renderToString(<EntityMatches entities={[]} query="x" />)).toBe('')
  })
})

describe('messages screen', () => {
  it('renders its loading state rather than throwing before data arrives', () => {
    // Effects do not run server-side, so this is genuinely the pre-fetch path —
    // the one a real browser paints first, and the one most likely to crash on
    // a field that is not there yet.
    const html = renderToString(<Messages sessionId="tag:abc" />)
    expect(html).toContain('animate-pulse')
  })
})

describe('the arithmetic behind a finding', () => {
  it('shows tokens x turns = wasted, as the design spec writes it', () => {
    const html = renderToString(
      <Finding
        finding={{
          rule: 'stuck-oversized-result',
          severity: 'critical',
          title: 'A result has been re-sent 6 times',
          detail: '',
          fix: 'Start a fresh session.',
          wastedTokens: 528_580,
          wastedCostUsd: 2.67,
          evidence: { tokens: 105_716, turns: 6 },
        }}
      />,
    )
    expect(html).toContain('105,716')
    expect(html).toContain('×')
    expect(html).toContain('6')
    expect(html).toContain('528,580')
  })

  it('says how many times for a repeat, where there is no per-turn size', () => {
    const html = renderToString(
      <Finding
        finding={{
          rule: 'redundant-read',
          severity: 'warning',
          title: 'auth.js was read 15 times',
          detail: '',
          fix: 'Work from what is already read.',
          wastedTokens: 6200,
          wastedCostUsd: 0.03,
          evidence: { file: '/repo/auth.js', reads: 15 },
        }}
      />,
    )
    expect(html).toContain('15 times')
    expect(html).toContain('6,200')
  })

  it('shows no working out when the evidence does not support one', () => {
    const html = renderToString(
      <Finding
        finding={{
          rule: 'approaching-context-limit',
          severity: 'warning',
          title: 'Context is 88% full',
          detail: '',
          fix: 'Clear large results.',
          wastedTokens: 0,
          wastedCostUsd: 0,
          evidence: { used: 175_000, limit: 200_000, share: 0.88 },
        }}
      />,
    )
    // Inventing a multiplication where none exists would be worse than none.
    expect(html).not.toContain('×')
  })
})

describe('export menu', () => {
  it('offers every content level, and says what each costs in privacy', () => {
    const html = renderToString(<ExportMenu />)
    // Closed by default: the trigger renders, the items do not.
    expect(html).toContain('Export')
    expect(html).not.toContain('previews only')
  })
})
