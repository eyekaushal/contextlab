import { describe, expect, it } from 'vitest'
import {
  countJsonTokens,
  countTokens,
  encodingNameFor,
  estimateFromChars,
} from '../src/tokenize.js'

describe('encoder selection', () => {
  it('uses o200k for the models that need it', () => {
    for (const model of [
      'gpt-5',
      'gpt-4.1-mini',
      'gpt-4o',
      'o1-preview',
      'o3',
      'o4-mini',
    ]) {
      expect(encodingNameFor(model)).toBe('o200k_base')
    }
  })

  it('falls back to cl100k for everything else, including the proprietary ones', () => {
    for (const model of [
      'claude-opus-5',
      'gemini-2.5-pro',
      'gpt-4-turbo',
      '',
      'mystery',
    ]) {
      expect(encodingNameFor(model)).toBe('cl100k_base')
    }
  })

  it('ignores the "models/" prefix gemini sometimes carries', () => {
    expect(encodingNameFor('models/gemini-2.5-pro')).toBe('cl100k_base')
  })
})

describe('countTokens', () => {
  it('counts real text', () => {
    expect(countTokens('hello world')).toBe(2)
    expect(countTokens('')).toBe(0)
    expect(countTokens(/** @type {any} */ (undefined))).toBe(0)
  })

  it('gives different counts for the two encoders on the same text', () => {
    const text = 'The quick brown fox jumps over the lazy dog, repeatedly and often.'
    expect(countTokens(text, 'gpt-5')).toBeGreaterThan(0)
    expect(countTokens(text, 'claude-opus-5')).toBeGreaterThan(0)
  })

  it('does not throw on text containing a literal special token', () => {
    // Captured tool results really do contain strings like this.
    const text = 'the model emitted <|endoftext|> in its output'
    expect(() => countTokens(text)).not.toThrow()
    expect(countTokens(text)).toBeGreaterThan(0)
  })

  it('counts json the way a provider bills it — serialised', () => {
    expect(countJsonTokens({ file_path: '/repo/src/app.js' })).toBeGreaterThan(0)
    expect(countJsonTokens(null)).toBe(0)
  })

  it('estimates four characters to a token as the last resort', () => {
    expect(estimateFromChars(400)).toBe(100)
    expect(estimateFromChars(0)).toBe(0)
    expect(estimateFromChars(-5)).toBe(0)
  })
})
