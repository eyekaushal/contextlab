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
import { Health, healthOf } from '../src/components/health.jsx'
import { Stat } from '../src/components/stat.jsx'
import { Empty } from '../src/components/states.jsx'
import { categoryColor, categoryLabel, tokens, usd, when } from '../src/lib/format.js'
import { href, match } from '../src/lib/router.js'

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
