import { describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from '../src/db.js'
import { loadPriceTable, pricingFetchedAt, savePriceTable } from '../src/pricing.js'

const TABLE = {
  updatedAt: '2026-09-10',
  source: 'https://models.dev/api.json',
  unit: 'usd_per_million_tokens',
  providers: {
    anthropic: {
      'claude-opus-5': {
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
        context: 200_000,
        maxOutput: 64_000,
      },
    },
    openai: {
      // No cache prices, no limits: the round trip must not invent any.
      'gpt-mini': { input: 0.15, output: 0.6 },
    },
  },
}

describe('the stored price table', () => {
  it('survives a round trip unchanged', () => {
    const db = openDatabase(':memory:')
    expect(savePriceTable(db, TABLE)).toBe(2)
    expect(loadPriceTable(db)).toEqual(TABLE)
    closeDatabase(db)
  })

  it('does not turn missing cache prices into zeroes', () => {
    const db = openDatabase(':memory:')
    savePriceTable(db, TABLE)
    const loaded = loadPriceTable(db)
    // A zero here would price every cached token at nothing.
    expect(loaded?.providers.openai?.['gpt-mini']).not.toHaveProperty('cacheRead')
    closeDatabase(db)
  })

  it('replaces the whole table rather than merging into a stale one', () => {
    const db = openDatabase(':memory:')
    savePriceTable(db, TABLE)
    savePriceTable(db, {
      ...TABLE,
      updatedAt: '2026-10-01',
      providers: { anthropic: { 'claude-opus-6': { input: 6, output: 30 } } },
    })
    const loaded = loadPriceTable(db)
    expect(loaded?.providers.openai).toBeUndefined()
    expect(loaded?.updatedAt).toBe('2026-10-01')
    closeDatabase(db)
  })

  it('records when it was fetched, so refresh can tell if it is due', () => {
    const db = openDatabase(':memory:')
    expect(pricingFetchedAt(db)).toBeNull()
    expect(loadPriceTable(db)).toBeNull()
    savePriceTable(db, TABLE)
    expect(pricingFetchedAt(db)).toBeGreaterThan(0)
    closeDatabase(db)
  })
})
