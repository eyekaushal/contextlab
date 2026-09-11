import { describe, expect, it } from 'vitest'
import {
  costPresentation,
  detectBillingMode,
  resolveBillingMode,
} from '../src/billing.js'
import { budgetProgress, evaluateBudget, hasBudget } from '../src/budget.js'
import { DEFAULT_CONFIG, loadConfig, parseToml } from '../src/config.js'

describe('detecting how a turn was paid for', () => {
  it('calls an api key an api key', () => {
    expect(detectBillingMode({ 'x-api-key': '[redacted]' })).toBe('api')
    expect(detectBillingMode({ 'x-goog-api-key': '[redacted]' })).toBe('api')
  })

  it('reads a subscription off the oauth beta flag', () => {
    // This is the real header Claude Code sends when signed in with an account,
    // and it survives redaction because it is not a credential.
    const headers = {
      authorization: '[redacted]',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,context-1m-2025-08-07',
    }
    expect(detectBillingMode(headers)).toBe('subscription')
  })

  it("knows chatgpt's own backend is never a metered key", () => {
    expect(detectBillingMode({}, { provider: 'chatgpt' })).toBe('subscription')
    expect(detectBillingMode({}, { path: '/backend-api/codex/responses' })).toBe(
      'subscription',
    )
  })

  it('says unknown rather than guessing', () => {
    expect(detectBillingMode({})).toBe('unknown')
    expect(detectBillingMode({ authorization: '[redacted]' })).toBe('unknown')
  })

  it('lets the user override a heuristic they know is wrong', () => {
    expect(resolveBillingMode('unknown', { mode: 'subscription' })).toBe('subscription')
    expect(resolveBillingMode('api', { mode: 'subscription' })).toBe('subscription')
    // auto means "keep whatever you detected".
    expect(resolveBillingMode('api', { mode: 'auto' })).toBe('api')
    expect(resolveBillingMode('api', {})).toBe('api')
  })
})

describe('which cost figure to show', () => {
  it('never tells a subscription user they were billed for a turn', () => {
    const presentation = costPresentation('subscription')
    expect(presentation.field).toBe('equivalent')
    expect(presentation.label).toBe('Equivalent API cost')
    expect(presentation.note).toContain('Included in your plan')
  })

  it('leads with actual spend on a metered key', () => {
    expect(costPresentation('api').field).toBe('actual')
  })

  it('admits when it does not know, and says how to settle it', () => {
    expect(costPresentation('unknown').note).toContain('config.toml')
  })
})

describe('budgets', () => {
  const budget = { daily: 5, monthly: 100, session: 2, warnAt: 0.8 }

  it('stays quiet below the warning threshold', () => {
    expect(evaluateBudget({ daily: 1, monthly: 10, session: 0.5 }, budget)).toEqual([])
  })

  it('warns on approach and flags on breach', () => {
    const alerts = evaluateBudget({ daily: 4.5, monthly: 101 }, budget)
    const daily = alerts.find((alert) => alert.scope === 'daily')
    const monthly = alerts.find((alert) => alert.scope === 'monthly')

    expect(daily?.level).toBe('warning')
    expect(daily?.title).toBe('90% of the daily budget')
    expect(monthly?.level).toBe('exceeded')
    expect(monthly?.detail).toContain('$101.00')
  })

  it('puts what has already broken above what is merely close', () => {
    const alerts = evaluateBudget({ daily: 4.5, monthly: 101 }, budget)
    expect(alerts[0]?.level).toBe('exceeded')
  })

  it('ignores a scope with no budget set', () => {
    expect(evaluateBudget({ daily: 1000 }, { monthly: 50 })).toEqual([])
    expect(hasBudget({})).toBe(false)
    expect(hasBudget({ daily: 5 })).toBe(true)
    expect(hasBudget({ daily: 0 })).toBe(false)
  })

  it('reports progress whether or not anything has tripped', () => {
    const rows = budgetProgress({ daily: 1, monthly: 95 }, budget)
    expect(rows.find((row) => row.scope === 'daily')?.level).toBe('good')
    expect(rows.find((row) => row.scope === 'monthly')?.level).toBe('warning')
    expect(rows.find((row) => row.scope === 'session')?.spent).toBe(0)
  })
})

describe('the config file', () => {
  it('reads the shape the example file uses', () => {
    const config = loadConfig(`
      # a comment
      [budget]
      daily = 5.00
      monthly = 100
      warn_at = 0.9

      [billing]
      mode = "subscription"
    `)
    expect(config.budget.daily).toBe(5)
    expect(config.budget.monthly).toBe(100)
    expect(config.budget.warnAt).toBe(0.9)
    expect(config.billing.mode).toBe('subscription')
  })

  it('accepts either reading of "warn at 80 percent"', () => {
    expect(loadConfig('[budget]\nwarn_at = 80').budget.warnAt).toBe(0.8)
    expect(loadConfig('[budget]\nwarn_at = 0.8').budget.warnAt).toBe(0.8)
  })

  it('falls back to defaults on an empty or missing file', () => {
    expect(loadConfig('').budget.warnAt).toBe(DEFAULT_CONFIG.budget.warnAt)
    expect(loadConfig('   ').billing.mode).toBe('auto')
  })

  it('refuses a billing mode it does not recognise', () => {
    expect(loadConfig('[billing]\nmode = "freemium"').billing.mode).toBe('auto')
  })

  it('names the line when it cannot read something', () => {
    // Silently misreading a budget is worse than refusing the file.
    expect(() => loadConfig('[budget]\ndaily = five dollars')).toThrow(/line 2/)
    expect(() => loadConfig('not a pair')).toThrow(/line 1/)
  })

  it('handles the awkward corners of the subset it claims', () => {
    const parsed = parseToml(`
      [a.b]
      flag = true
      list = ["x", "y"]
      big = 1_000
      hashed = "has # inside"    # trailing comment
    `)
    expect(parsed.a.b).toEqual({
      flag: true,
      list: ['x', 'y'],
      big: 1000,
      hashed: 'has # inside',
    })
  })

  it('keeps settings it does not understand rather than dropping them', () => {
    // A key from a newer version must survive an older binary reading the file.
    const config = loadConfig('[future]\nsomething = "new"')
    expect(config.raw?.future).toEqual({ something: 'new' })
  })
})
