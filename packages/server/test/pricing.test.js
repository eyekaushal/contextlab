import { SNAPSHOT } from '@contextlab/core/pricing'
import { closeDatabase, openDatabase, savePriceTable } from '@contextlab/store'
import { describe, expect, it } from 'vitest'
import {
  currentPriceTable,
  fetchPriceTable,
  isRefreshDue,
  refreshPricing,
} from '../src/pricing.js'

const MODELS_DEV_RESPONSE = {
  anthropic: {
    models: {
      'claude-future-9': {
        cost: { input: 9, output: 45, cache_read: 0.9, cache_write: 11.25 },
        limit: { context: 2_000_000, output: 128_000 },
      },
    },
  },
}

/**
 * @param {unknown} body
 * @param {{ ok?: boolean, status?: number }} [options]
 * @returns {any}
 */
function fakeFetch(body, options = {}) {
  return async () => ({
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  })
}

describe('fetching prices', () => {
  it('converts a models.dev response into our table', async () => {
    const table = await fetchPriceTable({ fetch: fakeFetch(MODELS_DEV_RESPONSE) })
    expect(table.providers.anthropic?.['claude-future-9']?.input).toBe(9)
    expect(table.unit).toBe('usd_per_million_tokens')
  })

  it('throws on an http error rather than storing nothing', async () => {
    await expect(
      fetchPriceTable({ fetch: fakeFetch({}, { ok: false, status: 503 }) }),
    ).rejects.toThrow('503')
  })

  it('refuses a response with no priceable models', async () => {
    await expect(fetchPriceTable({ fetch: fakeFetch({}) })).rejects.toThrow(
      'no priceable',
    )
  })
})

describe('refreshPricing', () => {
  it('stores a fresh table and reports what it wrote', async () => {
    const db = openDatabase(':memory:')
    const result = await refreshPricing(db, { fetch: fakeFetch(MODELS_DEV_RESPONSE) })
    expect(result).toMatchObject({ status: 'updated', models: 1 })
    expect(currentPriceTable(db).providers.anthropic?.['claude-future-9']).toBeDefined()
    closeDatabase(db)
  })

  it('never throws when the network is unreachable', async () => {
    const db = openDatabase(':memory:')
    const result = await refreshPricing(db, {
      fetch: async () => {
        throw new Error('getaddrinfo ENOTFOUND models.dev')
      },
    })
    // A price list we could not reach is not the user's problem.
    expect(result.status).toBe('failed')
    expect(currentPriceTable(db)).toBe(SNAPSHOT)
    closeDatabase(db)
  })

  it('skips a refresh that is not due yet', async () => {
    const db = openDatabase(':memory:')
    await refreshPricing(db, { fetch: fakeFetch(MODELS_DEV_RESPONSE) })
    const again = await refreshPricing(db, { fetch: fakeFetch(MODELS_DEV_RESPONSE) })
    expect(again.status).toBe('skipped')
    closeDatabase(db)
  })

  it('is due again a week later', async () => {
    const db = openDatabase(':memory:')
    expect(isRefreshDue(db)).toBe(true)
    await refreshPricing(db, { fetch: fakeFetch(MODELS_DEV_RESPONSE) })
    expect(isRefreshDue(db)).toBe(false)
    expect(isRefreshDue(db, { now: Date.now() + 8 * 24 * 60 * 60 * 1000 })).toBe(true)
    closeDatabase(db)
  })
})

describe('currentPriceTable', () => {
  it('works offline on a database that has never been refreshed', () => {
    const db = openDatabase(':memory:')
    expect(currentPriceTable(db)).toBe(SNAPSHOT)
    closeDatabase(db)
  })

  it('ignores a stored table older than the one we shipped', () => {
    const db = openDatabase(':memory:')
    savePriceTable(db, {
      updatedAt: '2000-01-01',
      source: 'stale',
      unit: 'usd_per_million_tokens',
      providers: { anthropic: { old: { input: 1, output: 1 } } },
    })
    expect(currentPriceTable(db)).toBe(SNAPSHOT)
    closeDatabase(db)
  })
})
