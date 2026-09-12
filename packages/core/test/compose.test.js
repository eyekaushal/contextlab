import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  classifyBlock,
  composeRequest,
  distribute,
  rescaleToActual,
} from '../src/compose/index.js'
import { parseRequest } from '../src/parse/index.js'

/** @param {string} text @param {Partial<any>} [extra] */
const textBlock = (text, extra = {}) => ({
  type: 'text',
  text,
  chars: text.length,
  ...extra,
})

describe('classification', () => {
  it('labels each block type', () => {
    expect(classifyBlock({ type: 'tool_use', chars: 0 })).toBe('tool_calls')
    expect(classifyBlock({ type: 'tool_result', chars: 0 })).toBe('tool_results')
    expect(classifyBlock({ type: 'thinking', chars: 0 })).toBe('thinking')
    expect(classifyBlock({ type: 'image', chars: 0 })).toBe('images')
    expect(classifyBlock({ type: 'nonsense', chars: 0 })).toBe('other')
  })

  it('splits text by who put it there', () => {
    expect(classifyBlock(textBlock('fix the bug'), 'user')).toBe('user_text')
    expect(classifyBlock(textBlock('I will look'), 'assistant')).toBe('assistant_text')
    expect(classifyBlock(textBlock('You are Claude'), 'system')).toBe('system_prompt')
    expect(classifyBlock(textBlock('result'), 'tool')).toBe('tool_results')
  })

  it('separates injected reminders from what the user actually typed', () => {
    // Charged to the user otherwise, which points the fix at the wrong place.
    const injected = textBlock('<system-reminder>file changed on disk</system-reminder>')
    expect(classifyBlock(injected, 'user')).toBe('system_injections')
  })
})

describe('composeRequest', () => {
  const parsed = parseRequest(
    {
      model: 'claude-opus-5',
      system: 'You are Claude Code, an interactive CLI tool.',
      tools: [
        { name: 'Read', description: 'Read a file', input_schema: { type: 'object' } },
      ],
      messages: [
        { role: 'user', content: 'fix the login bug' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'The auth module is the likely culprit here.' },
            { type: 'text', text: 'Looking at auth now.' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'auth.js' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'export function login' },
          ],
        },
      ],
    },
    { apiFormat: 'anthropic-messages' },
  )

  it('counts every part and totals them consistently', () => {
    const composed = composeRequest(/** @type {any} */ (parsed))
    expect(composed.totalTokens).toBe(
      composed.systemTokens + composed.toolsTokens + composed.messagesTokens,
    )
    expect(composed.messagesTokens).toBe(
      composed.messages.reduce((sum, message) => sum + message.tokens, 0),
    )
    expect(composed.exact).toBe(false)
  })

  it('always reports all eleven categories, so charts keep their shape', () => {
    const composed = composeRequest(/** @type {any} */ (parsed))
    expect(composed.breakdown.map((row) => row.category)).toEqual([...CATEGORIES])
  })

  it('puts each part in the right category', () => {
    const { categories } = composeRequest(/** @type {any} */ (parsed))
    expect(categories.system_prompt).toBeGreaterThan(0)
    expect(categories.tool_definitions).toBeGreaterThan(0)
    expect(categories.user_text).toBeGreaterThan(0)
    expect(categories.assistant_text).toBeGreaterThan(0)
    expect(categories.thinking).toBeGreaterThan(0)
    expect(categories.tool_calls).toBeGreaterThan(0)
    expect(categories.tool_results).toBeGreaterThan(0)
  })

  it('categories sum to the total', () => {
    const composed = composeRequest(/** @type {any} */ (parsed))
    const summed = composed.breakdown.reduce((sum, row) => sum + row.tokens, 0)
    expect(summed).toBe(composed.totalTokens)
  })

  it('never runs an encoder over image data', () => {
    const withImage = parseRequest(
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { media_type: 'image/png', data: 'A'.repeat(400_000) },
              },
            ],
          },
        ],
      },
      { apiFormat: 'anthropic-messages' },
    )
    const composed = composeRequest(/** @type {any} */ (withImage))
    // 100,000 tokens if measured; 1,600 because it is estimated instead.
    expect(composed.categories.images).toBe(1600)
    expect(composed.totalTokens).toBe(1600)
  })
})

describe('distribute', () => {
  it('sums to the target exactly', () => {
    expect(distribute([1, 1, 1], 10).reduce((a, b) => a + b, 0)).toBe(10)
    expect(distribute([7, 3], 100)).toEqual([70, 30])
    expect(distribute([1, 2, 3, 4, 5, 6, 7], 1000).reduce((a, b) => a + b, 0)).toBe(1000)
  })

  it('keeps proportions', () => {
    const [big, small] = distribute([900, 100], 1000)
    expect(big).toBe(900)
    expect(small).toBe(100)
  })

  it('handles the awkward cases without inventing numbers', () => {
    expect(distribute([], 500)).toEqual([])
    expect(distribute([0, 0], 0)).toEqual([0, 0])
    expect(distribute([0, 0], 7)).toEqual([7, 0])
    expect(distribute([5, 5], 1).reduce((a, b) => a + b, 0)).toBe(1)
  })
})

describe('rescaleToActual', () => {
  const parsed = parseRequest(
    {
      model: 'claude-opus-5',
      system: 'You are Claude Code',
      tools: [{ name: 'Read', input_schema: {} }],
      messages: [
        { role: 'user', content: 'short' },
        { role: 'user', content: 'a much longer message '.repeat(50) },
        { role: 'assistant', content: 'medium length reply here' },
      ],
    },
    { apiFormat: 'anthropic-messages' },
  )

  it('makes the total exactly what the provider billed', () => {
    const composed = composeRequest(/** @type {any} */ (parsed))
    const exact = rescaleToActual(composed, 142_314)
    expect(exact.totalTokens).toBe(142_314)
    expect(exact.exact).toBe(true)
  })

  it('holds both invariants after rescaling', () => {
    const composed = composeRequest(/** @type {any} */ (parsed))
    for (const actual of [1, 7, 999, 12_345, 142_314, 1_000_003]) {
      const exact = rescaleToActual(composed, actual)
      expect(exact.systemTokens + exact.toolsTokens + exact.messagesTokens).toBe(actual)
      expect(exact.messages.reduce((sum, m) => sum + m.tokens, 0)).toBe(
        exact.messagesTokens,
      )
      for (const message of exact.messages) {
        expect(message.blocks.reduce((sum, b) => sum + b.tokens, 0)).toBe(message.tokens)
      }
    }
  })

  it('keeps categories summing to the corrected total', () => {
    const composed = composeRequest(/** @type {any} */ (parsed))
    const exact = rescaleToActual(composed, 88_888)
    const summed = exact.breakdown.reduce((sum, row) => sum + row.tokens, 0)
    expect(summed).toBe(88_888)
  })

  it('keeps the shape of the breakdown roughly intact', () => {
    const composed = composeRequest(/** @type {any} */ (parsed))
    const before = composed.messagesTokens / composed.totalTokens
    const exact = rescaleToActual(composed, 500_000)
    const after = exact.messagesTokens / exact.totalTokens
    expect(Math.abs(after - before)).toBeLessThan(0.001)
  })

  it('leaves the estimate alone when there is nothing to correct with', () => {
    const composed = composeRequest(/** @type {any} */ (parsed))
    expect(rescaleToActual(composed, 0)).toBe(composed)
    expect(rescaleToActual(composed, -5)).toBe(composed)
  })
})

describe('estimated tokens survive rescaling', () => {
  const parsed = parseRequest(
    {
      model: 'claude-opus-5',
      messages: [
        { role: 'user', content: 'make the tests pass' },
        { role: 'user', content: 'a much longer message '.repeat(200) },
      ],
    },
    { apiFormat: 'anthropic-messages' },
  )

  it('keeps what each block actually counts as', () => {
    const composed = composeRequest(/** @type {any} */ (parsed))
    const short = composed.messages[0]?.blocks[0]
    expect(short?.tokensEstimated).toBe(short?.tokens)
    // 19 characters is about five tokens, not sixty-nine.
    expect(short?.tokensEstimated).toBeLessThan(10)
  })

  it('leaves the estimate alone when tokens become a share of the bill', () => {
    const composed = composeRequest(/** @type {any} */ (parsed))
    const before = composed.messages[0]?.blocks[0]?.tokensEstimated

    const exact = rescaleToActual(composed, 500_000)
    const short = exact.messages[0]?.blocks[0]

    // `tokens` is now this block's slice of half a million billed tokens.
    expect(short?.tokens).toBeGreaterThan(100)
    // What it actually says has not changed.
    expect(short?.tokensEstimated).toBe(before)
    expect(short?.tokensEstimated).toBeLessThan(10)
  })
})
