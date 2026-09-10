import { describe, expect, it } from 'vitest'
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  computeCost,
  contextLimitFor,
  findPrice,
  fromModelsDev,
  newerOf,
  normalizeModelId,
  priceTurn,
  SNAPSHOT,
  stripDateSuffix,
} from '../src/pricing/index.js'

describe('the bundled snapshot', () => {
  it('covers the providers our seven tools reach', () => {
    for (const provider of ['anthropic', 'openai', 'google']) {
      expect(Object.keys(SNAPSHOT.providers[provider] ?? {}).length).toBeGreaterThan(5)
    }
  })

  it('is stamped with a date, so the UI can say how old it is', () => {
    expect(SNAPSHOT.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(SNAPSHOT.unit).toBe('usd_per_million_tokens')
  })

  it('carries a sane price for every model it lists', () => {
    for (const [provider, models] of Object.entries(SNAPSHOT.providers)) {
      for (const [id, price] of Object.entries(models)) {
        expect(price.input, `${provider}/${id}`).toBeGreaterThanOrEqual(0)
        expect(price.input, `${provider}/${id}`).toBeLessThan(1000)
        expect(typeof price.output, `${provider}/${id}`).toBe('number')
      }
    }
  })
})

describe('model id matching', () => {
  it('strips the decoration providers add', () => {
    expect(normalizeModelId('models/gemini-2.5-pro')).toBe('gemini-2.5-pro')
    expect(normalizeModelId('anthropic/claude-opus-4-5')).toBe('claude-opus-4-5')
    expect(normalizeModelId('us.anthropic.claude-opus-4-5')).toBe('claude-opus-4-5')
    expect(normalizeModelId('  GPT-5  ')).toBe('gpt-5')
  })

  it('drops the dated snapshot suffix providers report back', () => {
    expect(stripDateSuffix('claude-opus-4-5-20260101')).toBe('claude-opus-4-5')
    expect(stripDateSuffix('gpt-4o-2024-05-13')).toBe('gpt-4o')
    expect(stripDateSuffix('claude-3-5-sonnet-latest')).toBe('claude-3-5-sonnet')
  })

  it('finds a real model exactly', () => {
    const match = findPrice('gpt-5')
    expect(match?.how).toBe('exact')
    expect(match?.provider).toBe('openai')
    expect(match?.price.input).toBeGreaterThan(0)
  })

  it('finds a dated model by falling back to its base id', () => {
    // This is what the response actually reports, and the case that silently
    // priced every real turn at zero if unhandled.
    const anthropic = Object.keys(SNAPSHOT.providers.anthropic ?? {})[0] ?? ''
    const match = findPrice(`${anthropic}-20260101`)
    expect(match?.modelId).toBe(anthropic)
    expect(match?.how).toBe('dated')
  })

  it('prefers the longest prefix, not the first one that fits', () => {
    const table = {
      updatedAt: '2026-01-01',
      source: 'test',
      unit: 'usd_per_million_tokens',
      providers: {
        anthropic: {
          claude: { input: 1, output: 1 },
          'claude-opus-5': { input: 5, output: 25 },
        },
      },
    }
    const match = findPrice('claude-opus-5-thinking', { table })
    expect(match?.modelId).toBe('claude-opus-5')
    expect(match?.how).toBe('prefix')
  })

  it('says so rather than guessing when it has never heard of a model', () => {
    expect(findPrice('totally-made-up-model-xyz')).toBeNull()
    expect(findPrice('')).toBeNull()
  })

  it('knows context windows, for the "82% full" gauge', () => {
    expect(contextLimitFor('gpt-5')).toBeGreaterThan(100_000)
    expect(contextLimitFor('nonexistent-model')).toBeNull()
  })
})

describe('computeCost', () => {
  const price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }

  it('prices a plain turn per million tokens', () => {
    const cost = computeCost({ inputTokens: 1_000_000, outputTokens: 0 }, price)
    expect(cost.input).toBeCloseTo(3)
    expect(cost.total).toBeCloseTo(3)
  })

  it('charges cache reads and writes at their own rates', () => {
    const cost = computeCost(
      {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 100_000,
        cacheWriteTokens: 20_000,
      },
      price,
    )
    expect(cost.cacheRead).toBeCloseTo((100_000 * 0.3) / 1e6)
    expect(cost.cacheWrite).toBeCloseTo((20_000 * 3.75) / 1e6)
    expect(cost.total).toBeCloseTo(
      cost.input + cost.output + cost.cacheRead + cost.cacheWrite,
    )
  })

  it('falls back to the standard multipliers when a model states no cache price', () => {
    const cost = computeCost({ cacheReadTokens: 1_000_000 }, { input: 10, output: 30 })
    expect(cost.cacheRead).toBeCloseTo(10 * CACHE_READ_MULTIPLIER)

    const write = computeCost({ cacheWriteTokens: 1_000_000 }, { input: 10, output: 30 })
    expect(write.cacheWrite).toBeCloseTo(10 * CACHE_WRITE_MULTIPLIER)
  })

  it('does not make a cache-heavy session look ten times worse than it was', () => {
    // 100k cached reads priced as fresh input would be $0.30; at the cache
    // rate it is $0.03. Getting this wrong is the common case, not the rare one.
    const cached = computeCost({ cacheReadTokens: 100_000 }, price)
    const asFresh = computeCost({ inputTokens: 100_000 }, price)
    expect(cached.total).toBeCloseTo(asFresh.total / 10)
  })

  it('tells a subscription user their marginal cost is zero, and what it was worth', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 200_000 }
    const subscription = computeCost(usage, price, { billingMode: 'subscription' })
    expect(subscription.actual).toBe(0)
    expect(subscription.equivalent).toBeGreaterThan(0)

    const api = computeCost(usage, price, { billingMode: 'api' })
    expect(api.actual).toBeCloseTo(api.equivalent)
  })

  it('reports honestly when there is no price rather than showing $0', () => {
    const cost = computeCost({ inputTokens: 1_000_000 }, null)
    expect(cost.priced).toBe(false)
    expect(cost.total).toBe(0)
  })

  it('prices a turn end to end from a model name', () => {
    const cost = priceTurn('gpt-5', { inputTokens: 1_000_000, outputTokens: 100_000 })
    expect(cost.priced).toBe(true)
    expect(cost.total).toBeGreaterThan(0)
    expect(cost.how).toBe('exact')
  })
})

describe('fromModelsDev', () => {
  const raw = {
    anthropic: {
      models: {
        'claude-x': {
          cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
          limit: { context: 200_000, output: 64_000 },
        },
        'no-price': { limit: { context: 1000 } },
      },
    },
    ignored: { models: { thing: { cost: { input: 1 } } } },
  }

  it('converts their shape to ours and keeps only priceable models', () => {
    const table = fromModelsDev(raw, ['anthropic'])
    expect(table.providers.anthropic?.['claude-x']).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
      context: 200_000,
      maxOutput: 64_000,
    })
    expect(table.providers.anthropic?.['no-price']).toBeUndefined()
    expect(table.providers.ignored).toBeUndefined()
  })

  it('does not fall over on nonsense', () => {
    expect(fromModelsDev(null).providers).toEqual({})
    expect(fromModelsDev({ x: { models: 'not an object' } }).providers).toEqual({})
  })
})

describe('newerOf', () => {
  it('prefers a cached table only when it is at least as new as the bundled one', () => {
    const stale = {
      updatedAt: '2000-01-01',
      source: 's',
      unit: 'u',
      providers: { a: { m: { input: 1, output: 1 } } },
    }
    const fresh = { ...stale, updatedAt: '2999-01-01' }
    expect(newerOf(stale)).toBe(SNAPSHOT)
    expect(newerOf(fresh)).toBe(fresh)
    expect(newerOf(null)).toBe(SNAPSHOT)
    expect(
      newerOf({ updatedAt: '2999-01-01', source: 's', unit: 'u', providers: {} }),
    ).toBe(SNAPSHOT)
  })
})
