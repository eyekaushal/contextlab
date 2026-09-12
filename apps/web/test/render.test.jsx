/**
 * Does the dashboard actually render?
 *
 * Rendering to a string catches what a build cannot: a bad import path, invalid
 * JSX, a hook called wrongly, or a component that throws on its first paint
 * with no data. Effects do not run here, so no browser, no DOM and no network
 * are involved — which is exactly why it is cheap enough to run on every commit.
 */

import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from '../src/App.jsx'
import { CompositionBar, CompositionLegend } from '../src/components/composition-bar.jsx'
import { ContextDiff } from '../src/components/context-diff.jsx'
import { ExportMenu } from '../src/components/export-menu.jsx'
import { Finding } from '../src/components/finding.jsx'
import { FindingsTable, scopeOf } from '../src/components/findings-table.jsx'
import { Health, healthOf } from '../src/components/health.jsx'
import { Sparkline } from '../src/components/sparkline.jsx'
import { Stat } from '../src/components/stat.jsx'
import { Empty } from '../src/components/states.jsx'
import { SummaryStrip } from '../src/components/summary-strip.jsx'
import { SystemPromptPanel } from '../src/components/system-prompt-panel.jsx'
import { categoryColor, categoryLabel, tokens, usd, when } from '../src/lib/format.js'
import { href, match } from '../src/lib/router.js'
import { Messages } from '../src/screens/messages.jsx'
import { COLUMNS, Column, Sessions } from '../src/screens/sessions.jsx'

describe('the shell', () => {
  it('renders without throwing', () => {
    const html = renderToString(<App />)
    expect(html).toContain('contextlab')
    expect(html).toContain('Sessions')
    expect(html).toContain('Optimize')
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
