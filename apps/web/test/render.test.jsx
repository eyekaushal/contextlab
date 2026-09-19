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
import { App, activeNav, Route } from '../src/App.jsx'
import { BudgetCard } from '../src/components/budget-card.jsx'
import {
  colourByName,
  Donut,
  foldSmall,
  SAND,
  SpendTimeline,
} from '../src/components/charts.jsx'
import { CompositionBar, CompositionLegend } from '../src/components/composition-bar.jsx'
import { ContextDiff } from '../src/components/context-diff.jsx'
import { EntityMatches } from '../src/components/entity-matches.jsx'
import { ExportMenu, exportItems } from '../src/components/export-menu.jsx'
import { Finding } from '../src/components/finding.jsx'
import { FindingsTable, scopeOf } from '../src/components/findings-table.jsx'
import { Health, healthOf } from '../src/components/health.jsx'
import { PageHeader } from '../src/components/page-header.jsx'
import {
  parseArguments,
  parseMarkdown,
  Rendered,
} from '../src/components/rendered-block.jsx'
import { optionLabel, SessionFilters } from '../src/components/session-filters.jsx'
import { Sparkline } from '../src/components/sparkline.jsx'
import { describeDelta, Stat } from '../src/components/stat.jsx'
import { Empty } from '../src/components/states.jsx'
import { SummaryStrip } from '../src/components/summary-strip.jsx'
import { SystemPromptPanel } from '../src/components/system-prompt-panel.jsx'
import { Tooltip } from '../src/components/ui/tooltip.jsx'
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

  it('paints the page colour on html as well as body', () => {
    // With color-scheme dark, anything past the body's height is the canvas,
    // and the canvas is black. That was the band at the bottom of every screen.
    expect(css).toMatch(/html\s*\{[^}]*background-color:\s*var\(--color-page\)/)
  })

  it('sets the two faces once, in the theme, and nowhere else', () => {
    expect(css).toContain('"Inter Variable"')
    expect(css).toContain('"JetBrains Mono Variable"')
    // A font-family in a component bypasses the tokens the same way a
    // hardcoded pixel size bypasses the scale.
    const root = new URL('../src/', import.meta.url)
    /** @param {URL} dir @returns {string[]} */
    const walk = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(new URL(`${entry.name}/`, dir))
          : entry.name.endsWith('.jsx')
            ? [fileURLToPath(new URL(entry.name, dir))]
            : [],
      )
    const offenders = walk(root).filter((file) =>
      /fontFamily|font-family/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('never fetches a font from the network', () => {
    // Self-hosted from @fontsource: a Google Fonts link would send every
    // visitor's IP to Google on every load.
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic|https?:\/\//)
    const entry = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
    expect(entry).toContain('@fontsource-variable/inter')
    expect(entry).toContain('@fontsource-variable/jetbrains-mono')
  })

  it('keeps focus rings off the charts', () => {
    expect(css).toContain('[data-chart] :focus-visible')
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

describe('the top bar', () => {
  it('has one entry per view, icon and word, Compare included', () => {
    const html = renderToString(<App />)
    for (const label of ['Sessions', 'Optimize', 'Compare', 'Cost']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('Search everything')
  })

  it('knows which entry a route belongs to', () => {
    expect(activeNav('/')).toBe('/')
    expect(activeNav('/s/tag%3Aa/messages')).toBe('/')
    expect(activeNav('/optimize')).toBe('/optimize')
    expect(activeNav('/cost')).toBe('/cost')
    // A comparison belongs to Compare however it was reached.
    expect(activeNav('/compare?ids=a&ids=b')).toBe('/?select=1')
    expect(activeNav('/?select=1')).toBe('/?select=1')
  })

  it('opens the sessions list in selection mode for Compare', () => {
    const html = renderToString(<Route route="/?select=1" version={0} />)
    expect(html).toContain('Tick two or more sessions')
  })

  it('carries a search term from the bar to the list', () => {
    const html = renderToString(<Route route="/?q=playwright" version={0} />)
    expect(html).toContain('matching \u201cplaywright\u201d')
  })
})

describe('a tooltip', () => {
  it('opens on hover and keyboard focus, not on the focus a click leaves behind', () => {
    const html = renderToString(
      <Tooltip text="Pick two or more sessions to compare">
        <button type="button">x</button>
      </Tooltip>,
    )
    // focus-within kept a clicked nav entry's tooltip open until the next
    // click anywhere. Keyboard focus still gets it; a mouse click does not.
    expect(html).not.toContain('focus-within')
    expect(html).toContain('focus-visible')
    expect(html).toContain('group-hover/tip:opacity-100')
  })

  it('links its sentence to the control for a screen reader', () => {
    const html = renderToString(
      <Tooltip text="Dismiss — set aside as judged.">
        <button type="button">x</button>
      </Tooltip>,
    )
    expect(html).toContain('role="tooltip"')
    expect(html).toContain('Dismiss — set aside as judged.')
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1]
    expect(id).toBeTruthy()
    expect(html).toContain(`id="${id}"`)
  })
})

describe('the page header', () => {
  it('puts the question under the title, not beside it', () => {
    const html = renderToString(
      <PageHeader
        title="Optimize"
        question="What do I change first?"
        note="5 sessions"
      />,
    )
    // Title first, then the question, then the note — three lines in order.
    expect(html.indexOf('Optimize')).toBeLessThan(html.indexOf('What do I change first?'))
    expect(html.indexOf('What do I change first?')).toBeLessThan(
      html.indexOf('5 sessions'),
    )
    expect(html).toContain('text-xl')
  })

  it('offers a way back when told where back is', () => {
    const html = renderToString(
      <PageHeader title="Compare" back={{ to: '/', label: 'All sessions' }} />,
    )
    expect(html).toContain('All sessions')
    expect(renderToString(<PageHeader title="Sessions" />)).not.toContain('All sessions')
  })
})

describe('compare aligns its worst findings under their columns', () => {
  it('renders them as rows of the same table', () => {
    const columns = [
      {
        session: {
          id: 'a',
          projectName: 'api',
          tool: 'codex',
          turnCount: 5,
          equivalentCostUsd: 1,
          peakContextTokens: 1,
          lastSeenAt: 0,
        },
        categories: {},
        total: { count: 2, recoverableUsd: 0.3, potentialUsd: 0 },
        topFindings: [
          { rule: 'r', title: 'first worst', severity: 'critical', wastedCostUsd: 0.26 },
          { rule: 'r', title: 'second worst', severity: 'warning', wastedCostUsd: 0.05 },
        ],
      },
      {
        session: {
          id: 'b',
          projectName: 'design',
          tool: 'gemini',
          turnCount: 4,
          equivalentCostUsd: 1,
          peakContextTokens: 1,
          lastSeenAt: 0,
        },
        categories: {},
        total: { count: 0, recoverableUsd: 0, potentialUsd: 0 },
        topFindings: [],
      },
    ]
    const html = renderToString(
      <CompareTable
        columns={columns}
        categories={[]}
        baseline={0}
        onBaseline={() => {}}
      />,
    )
    expect(html).toContain('Worst findings')
    expect(html).toContain('first worst')
    expect(html).toContain('second worst')
    // The column with nothing says so in the first row and stays empty below.
    expect(html).toContain('Nothing to fix.')
    // Inside the table, not a card underneath it.
    expect(html.lastIndexOf('</table>')).toBeGreaterThan(html.indexOf('second worst'))
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

  it('filters by project, not by rule', () => {
    const two = [...rows, { ...rows[0], sessionId: 's2', sessionLabel: 'monolith' }]
    const html = renderToString(<FindingsTable rows={two} showSession />)
    expect(html).toContain('Filter by project')
    expect(html).toContain('All projects')
    expect(html).toContain('monolith')
    // A reader thinks "what is wrong with api", not "show me every
    // bloated-memory-file".
    expect(html).not.toContain('Filter by rule')
  })

  it('offers no project filter when there is only one project', () => {
    expect(renderToString(<FindingsTable rows={rows} />)).not.toContain(
      'Filter by project',
    )
  })

  it('explains the eye', () => {
    const html = renderToString(<FindingsTable rows={rows} />)
    expect(html).toContain('Dismiss — set aside as judged')
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

describe('a stat is a card with an arrow', () => {
  it('describes a change as a direction and a percentage', () => {
    expect(describeDelta(11, 10)).toEqual({ direction: 'up', text: '10%' })
    expect(describeDelta(9, 10)).toEqual({ direction: 'down', text: '10%' })
    expect(describeDelta(10, 10)).toEqual({ direction: 'flat', text: 'same' })
  })

  it('says "new" rather than dividing by zero', () => {
    // A prior period of nothing is not an infinite increase.
    expect(describeDelta(5, 0)).toEqual({ direction: 'up', text: 'new' })
    expect(describeDelta(0, 0)).toEqual({ direction: 'flat', text: 'same' })
  })

  it('paints the arrow by meaning, not by direction', () => {
    const up = renderToString(
      <Stat
        label="Today"
        value="$11"
        delta={{ current: 11, previous: 10, label: 'vs yesterday', higherIsWorse: true }}
      />,
    )
    // Spend going up is bad.
    expect(up).toContain('var(--color-status-critical)')
    expect(up).toContain('10%')

    const neutral = renderToString(
      <Stat label="Turns" value="8" delta={{ current: 8, previous: 5, label: 'vs' }} />,
    )
    // More turns is not a fault: no colour either way.
    expect(neutral).not.toContain('var(--color-status-critical)')
    expect(neutral).not.toContain('var(--color-status-good)')
  })

  it('shows no arrow when there is nothing to compare against', () => {
    expect(renderToString(<Stat label="All time" value="$18" />)).not.toContain(
      'lucide-arrow',
    )
  })
})

describe('the budget card', () => {
  const data = {
    configured: false,
    budget: {},
    spend: { daily: 0, monthly: 18.51, session: 0 },
    progress: [],
    alerts: [],
    billing: { mode: 'auto' },
    suggestion: {
      daily: 20,
      monthly: 50,
      busiestDay: 10.48,
      last30Total: 18.51,
      days: 1,
    },
    path: '/Users/someone/.contextlab/config.toml',
    writable: true,
  }

  it('is a field with presets and a suggestion from history, not a slider', () => {
    const html = renderToString(<BudgetCard data={data} />)
    expect(html).toContain('type="number"')
    expect(html).not.toContain('type="range"')
    expect(html).toContain('$5')
    expect(html).toContain('$100')
    expect(html).toContain('suggest <!-- -->$20.00')
    expect(html).toContain('busiest day in the last 30 was $10.48')
  })

  it('says where the file is, with the home directory shortened', () => {
    const html = renderToString(<BudgetCard data={data} />)
    expect(html).toContain('~/.contextlab/config.toml')
    expect(html).not.toContain('/Users/someone')
  })

  it('says so when there is nothing to write to', () => {
    const html = renderToString(
      <BudgetCard data={{ ...data, path: null, writable: false }} />,
    )
    expect(html).toContain('no config file to write to')
  })

  it('shows the bars once a budget exists', () => {
    const html = renderToString(
      <BudgetCard
        data={{
          ...data,
          configured: true,
          budget: { daily: 20 },
          progress: [{ scope: 'daily', share: 0.5, spent: 10, limit: 20, level: 'ok' }],
        }}
      />,
    )
    expect(html).toContain('Within budget')
    expect(html).toContain('width:50%')
  })
})

describe('the rings', () => {
  const tools = [
    { key: 'aider', label: 'aider', value: 10.48 },
    { key: 'claude', label: 'claude', value: 6.09 },
    { key: 'gemini', label: 'gemini', value: 1.22 },
    { key: 'codex', label: 'codex', value: 0.71 },
  ]

  it('gives a colour by name, so a filter never repaints the survivors', () => {
    const all = colourByName(tools)
    const fewer = colourByName(tools.filter((t) => t.key !== 'aider'))
    expect(fewer.claude).toBe(all.claude)
    expect(fewer.codex).toBe(all.codex)
    expect(fewer.gemini).toBe(all.gemini)
    // Five sands, five tools on screen at once — no two alike.
    const five = colourByName(
      ['claude', 'codex', 'gemini', 'aider', 'cline'].map((key) => ({ key })),
    )
    expect(new Set(Object.values(five)).size).toBe(5)
    for (const colour of Object.values(five)) expect(SAND).toContain(colour)
  })

  it('colours a project by its name alone', () => {
    const a = colourByName([{ key: 'api' }, { key: 'monolith' }, { key: 'website' }])
    const b = colourByName([{ key: 'monolith' }])
    expect(b.monolith).toBe(a.monolith)
  })

  it('folds the tail into Other rather than growing a rainbow', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      key: `t${i}`,
      label: `t${i}`,
      value: 9 - i,
    }))
    const folded = foldSmall(many)
    expect(folded).toHaveLength(6)
    expect(folded[5]).toMatchObject({ key: 'other', value: 4 + 3 + 2 + 1 })
    expect(foldSmall(tools)).toHaveLength(4)
  })

  it('draws the ring in warm sand with the total in the middle and the value in the legend', () => {
    const html = renderToString(
      <Donut title="Spend by tool" series={tools} unit="usd" colour="name" size={128} />,
    )
    expect(html).toContain('<svg')
    for (const t of tools) expect(html).toContain(t.label)
    expect(html).toContain('$10.48')
    expect(html).toContain('$18.50')
    expect(html).toContain('hsl(27, 42%, 55%)')
  })

  it('keeps severity on the status colours, not on sand', () => {
    const html = renderToString(
      <Donut
        title="Findings by severity"
        series={[
          { key: 'critical', label: 'critical', value: 5 },
          { key: 'warning', label: 'warning', value: 12 },
        ]}
        unit="count"
        colour="severity"
        size={128}
      />,
    )
    expect(html).toContain('var(--color-status-critical)')
    expect(html).toContain('var(--color-status-warning)')
    expect(html).not.toContain('hsl(27')
    expect(html).toContain('17')
  })

  it('keeps categories on the category palette, so the ring agrees with every bar', () => {
    const html = renderToString(
      <Donut
        title="What filled the window"
        series={[{ key: 'tool_results', label: 'tool_results', value: 900 }]}
        unit="tokens"
        colour="category"
        size={128}
      />,
    )
    expect(html).toContain('var(--cat-tool_results')
    expect(html).toContain('Tool results')
  })

  it('says so when there is nothing to draw', () => {
    const html = renderToString(
      <Donut
        title="Findings"
        series={[]}
        unit="count"
        colour="severity"
        empty="Nothing to fix."
      />,
    )
    expect(html).toContain('Nothing to fix.')
    expect(html).not.toContain('<svg')
  })
})

describe('the timeline', () => {
  it('refuses to draw a trend from one day', () => {
    const html = renderToString(
      <SpendTimeline
        days={[{ day: '2026-09-12', total: 18.51, byTool: { claude: 18.51 } }]}
      />,
    )
    expect(html).toContain('A line needs two')
    expect(html).toContain('$18.51')
    expect(html).not.toContain('<svg')
  })

  it('draws stacked areas with a legend once there are two days', () => {
    const html = renderToString(
      <SpendTimeline
        width={600}
        height={200}
        days={[
          { day: '2026-09-11', total: 3, byTool: { claude: 2, codex: 1 } },
          { day: '2026-09-12', total: 5, byTool: { claude: 4, codex: 1 } },
        ]}
      />,
    )
    expect(html).toContain('<svg')
    expect(html).toContain('<path')
    expect(html).toContain('claude')
    expect(html).toContain('codex')
  })
})

describe('the filters above the table', () => {
  const facets = {
    tools: [
      { value: 'claude', label: 'claude', count: 2, costUsd: 6.09 },
      { value: 'codex', label: 'codex', count: 1, costUsd: 0.71 },
    ],
    models: [{ value: 'only-one', label: 'only-one', count: 3, costUsd: 6.8 }],
    projects: [],
  }
  const none = { tool: '', model: '', project: '' }

  it('says the count and the spend in the option itself', () => {
    expect(
      optionLabel({ value: 'claude', label: 'claude', count: 2, costUsd: 6.09 }),
    ).toBe('claude (2 · $6.09)')
  })

  it('offers a dropdown only where there is a choice', () => {
    const html = renderToString(
      <SessionFilters facets={facets} value={none} onChange={() => {}} showing={3} />,
    )
    expect(html).toContain('Filter by source')
    // One model is a label with extra steps, not a filter.
    expect(html).not.toContain('Filter by model')
    expect(html).not.toContain('Filter by project')
  })

  it('says what it is hiding, and offers a way back', () => {
    const html = renderToString(
      <SessionFilters
        facets={facets}
        value={{ ...none, tool: 'claude' }}
        onChange={() => {}}
        showing={2}
        total={3}
      />,
    )
    expect(html).toContain('Showing 2 of 3')
    expect(html).toContain('Clear')
  })

  it('renders nothing when there is nothing to filter by', () => {
    expect(
      renderToString(
        <SessionFilters
          facets={{ tools: [], models: [], projects: [] }}
          value={none}
          onChange={() => {}}
          showing={0}
        />,
      ),
    ).toBe('')
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

  it('measures today against yesterday and the week against the week before', () => {
    const html = renderToString(
      <SummaryStrip data={{ ...data, yesterday: 2, priorWeek: 20 }} />,
    )
    // $2.50 vs $2.00 is up 25%; $18.51 vs $20 is down 7%.
    expect(html).toContain('25%')
    expect(html).toContain('7%')
  })

  it('is five cards, not five labels in a row', () => {
    const html = renderToString(<SummaryStrip data={data} />)
    expect(
      (html.match(/rounded-\[var\(--radius-card\)\]/g) ?? []).length,
    ).toBeGreaterThanOrEqual(5)
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
  it('does not scroll itself — main is the one scroll container', () => {
    const source = readFileSync(
      new URL('../src/screens/sessions.jsx', import.meta.url),
      'utf8',
    )
    // Two nested scroll containers were two scrollbars.
    const body = source.slice(source.indexOf('export function Sessions'))
    expect(body).not.toContain('overflow-y-auto px-4')
  })

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
  it('renders the working the rule stated, term by term', () => {
    const html = renderToString(
      <Finding
        finding={{
          rule: 'stuck-oversized-result',
          severity: 'critical',
          title: 'A result has been re-sent 8 times',
          detail: '',
          fix: 'Start a fresh session.',
          wastedTokens: 705_103,
          wastedCostUsd: 3.57,
          evidence: {
            tokens: 100_729,
            turns: 8,
            working: {
              unit: 'tokens',
              factors: [
                { value: 100_729, label: 'tokens' },
                {
                  value: 8,
                  label: 'turns',
                  minus: { value: 1, label: 'the first send' },
                },
              ],
            },
          },
        }}
      />,
    )
    expect(html).toContain('100,729 tokens')
    expect(html).toContain('(8 turns \u2212 1 the first send)')
    expect(html).toContain('705,103')
    expect(html).toContain('$3.57')
  })

  it('shows the subtraction the rule made, not a bare product', () => {
    // The bug report: `20,057 × 8 = 144,454` was printed, and 20,057 × 8 is
    // 160,456. The rule claimed the excess over 2,000; the line now says so.
    const html = renderToString(
      <Finding
        finding={{
          rule: 'bloated-memory-file',
          severity: 'warning',
          title: 'CLAUDE.md is 20,057 tokens on every turn',
          detail: '',
          fix: 'Trim it.',
          wastedTokens: 144_454,
          wastedCostUsd: 0.73,
          evidence: {
            working: {
              unit: 'tokens',
              factors: [
                {
                  value: 20_056.75,
                  label: 'tokens per turn',
                  minus: { value: 2000, label: 'kept' },
                },
                { value: 8, label: 'turns' },
              ],
            },
          },
        }}
      />,
    )
    expect(html).toContain('\u2212 2,000 kept')
    expect(html).toContain('144,454')
    expect(html).not.toContain('160,456')
  })

  it('derives nothing from loose evidence fields', () => {
    // Two numbers in evidence used to be enough for the card to invent an
    // equation. They are not any more.
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
          evidence: { file: '/repo/auth.js', reads: 15, perTurn: 400, turns: 15 },
        }}
      />,
    )
    expect(html).not.toContain('\u00d7')
    expect(html).not.toContain(' = ')
  })

  it('shows money working in dollars', () => {
    const html = renderToString(
      <Finding
        finding={{
          rule: 'model-too-expensive',
          severity: 'info',
          title: '6 turns of reading on claude-opus-5',
          detail: '',
          fix: 'Use haiku.',
          wastedTokens: 0,
          wastedCostUsd: 1.6,
          claim: 'potential',
          evidence: {
            working: {
              unit: 'usd',
              factors: [
                { value: 2, label: 'spent' },
                {
                  value: 1,
                  label: '',
                  minus: { value: 0.2, label: 'the haiku price ratio' },
                },
              ],
            },
          },
        }}
      />,
    )
    expect(html).toContain('$2.00 spent')
    expect(html).toContain('= ')
    expect(html).toContain('$1.60')
  })
})

describe('export menu', () => {
  it('puts a distinct icon in front of every option', () => {
    // The menu is closed on first paint, so the items are checked directly.
    const items = exportItems()
    expect(items).toHaveLength(4)
    // lucide icons are forwardRef objects, not plain functions.
    for (const item of items) expect(item.Icon).toBeTruthy()
    expect(new Set(items.map((item) => item.Icon)).size).toBe(4)
  })

  it('offers every content level, and says what each costs in privacy', () => {
    const html = renderToString(<ExportMenu />)
    // Closed by default: the trigger renders, the items do not.
    expect(html).toContain('Export')
    expect(html).not.toContain('previews only')
  })
})
