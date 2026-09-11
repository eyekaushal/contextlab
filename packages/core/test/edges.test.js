/**
 * The defensive paths.
 *
 * Everything here is a branch that exists because a provider might send
 * something we did not expect. Those branches are the ones that never run in
 * development and then run on somebody else's machine at 2am, so they are worth
 * an assertion each — an untested fallback is a guess.
 */

import { describe, expect, it } from 'vitest'
import { detectBillingMode } from '../src/billing.js'
import { classifyMessage } from '../src/compose/classify.js'
import { composeRequest, distribute, rescaleToActual } from '../src/compose/index.js'
import {
  definitionChars,
  flattenContent,
  mcpServerOf,
  parseRequest,
} from '../src/parse/index.js'
import { countJsonTokens, countTokens, encoderFor } from '../src/tokenize.js'
import { buildToolEnv, identifyTool } from '../src/tools.js'

describe('anthropic content that is not the usual shape', () => {
  it('reads a system array holding bare strings', () => {
    // Documented as an array of blocks, but a bare string appears in the wild.
    const parsed = parseRequest(
      {
        system: ['You are Claude Code', '', { type: 'text', text: 'and careful' }],
        messages: [],
      },
      { apiFormat: 'anthropic-messages' },
    )
    expect(parsed?.system.map((segment) => segment.text)).toEqual([
      'You are Claude Code',
      'and careful',
    ])
  })

  it('reads a message content array holding bare strings', () => {
    const parsed = parseRequest(
      {
        messages: [{ role: 'user', content: ['fix it', { type: 'text', text: 'now' }] }],
      },
      { apiFormat: 'anthropic-messages' },
    )
    expect(parsed?.messages[0]?.blocks.map((block) => block.text)).toEqual([
      'fix it',
      'now',
    ])
  })

  it('ignores entries that are neither string nor object', () => {
    const parsed = parseRequest(
      { system: [null, 42], messages: [{ role: 'user', content: [null, 7] }] },
      { apiFormat: 'anthropic-messages' },
    )
    expect(parsed?.system).toEqual([])
    expect(parsed?.messages[0]?.blocks).toEqual([])
  })
})

describe('flattening tool result content', () => {
  it('reads a bare object with text on it', () => {
    expect(flattenContent({ text: 'the output' })).toEqual({
      text: 'the output',
      images: 0,
    })
  })

  it('counts a bare image object without measuring it', () => {
    expect(flattenContent({ type: 'image', source: { data: 'AAAA' } })).toEqual({
      text: '',
      images: 1,
    })
  })

  it('gives up quietly on anything else', () => {
    expect(flattenContent(42)).toEqual({ text: '', images: 0 })
    expect(flattenContent(null)).toEqual({ text: '', images: 0 })
    expect(flattenContent(undefined)).toEqual({ text: '', images: 0 })
  })
})

describe('measuring a tool definition', () => {
  it('counts the serialised schema', () => {
    expect(definitionChars({ name: 'Read' })).toBe(
      JSON.stringify({ name: 'Read' }).length,
    )
    expect(definitionChars(undefined)).toBe(2)
  })

  it('returns zero rather than throwing on something unserialisable', () => {
    /** @type {any} */
    const circular = { name: 'Loop' }
    circular.self = circular
    // A tool schema that cannot be stringified must not take the parse down.
    expect(definitionChars(circular)).toBe(0)
  })
})

describe('naming an MCP server', () => {
  it('reads the server out of the convention every client follows', () => {
    expect(mcpServerOf('mcp__playwright__click')).toBe('playwright')
    expect(mcpServerOf('mcp__my_server__do_thing')).toBe('my_server')
  })

  it('says nothing for a tool that is not from a server', () => {
    expect(mcpServerOf('Read')).toBeUndefined()
    expect(mcpServerOf('')).toBeUndefined()
  })
})

describe('sniffing a format from the body', () => {
  it('recognises anthropic by system plus messages', () => {
    const parsed = parseRequest(
      { system: 'You are helpful', messages: [{ role: 'user', content: 'hi' }] },
      { apiFormat: 'unknown' },
    )
    expect(parsed?.apiFormat).toBe('anthropic-messages')
  })

  it('falls back to chat completions on messages alone', () => {
    const parsed = parseRequest(
      { messages: [{ role: 'user', content: 'hi' }] },
      { apiFormat: 'unknown' },
    )
    expect(parsed?.apiFormat).toBe('chat-completions')
  })

  it('returns null rather than guessing at a body it cannot place', () => {
    expect(parseRequest({ prompt: 'hello' }, { apiFormat: 'unknown' })).toBeNull()
  })
})

describe('classifying a whole message', () => {
  it('labels every block in order', () => {
    const parsed = parseRequest(
      {
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'hmm' },
              { type: 'text', text: 'here goes' },
              { type: 'tool_use', id: 'c1', name: 'Read', input: {} },
            ],
          },
        ],
      },
      { apiFormat: 'anthropic-messages' },
    )
    expect(classifyMessage(/** @type {any} */ (parsed?.messages[0]))).toEqual([
      'thinking',
      'assistant_text',
      'tool_calls',
    ])
  })
})

describe('the tokenizer degrading gracefully', () => {
  it('loads an encoder and reuses it', () => {
    expect(encoderFor('gpt-5')).toBe(encoderFor('gpt-4o'))
    expect(encoderFor('claude-opus-5')).not.toBe(encoderFor('gpt-5'))
  })

  it('estimates rather than throwing on a special-token string', () => {
    const text = '<|endoftext|> appeared in a tool result'
    expect(countTokens(text)).toBe(Math.ceil(text.length / 4))
  })

  it('returns zero for json it cannot serialise', () => {
    /** @type {any} */
    const circular = {}
    circular.self = circular
    expect(countJsonTokens(circular)).toBe(0)
    expect(countJsonTokens(undefined)).toBe(0)
  })
})

describe('rescaling edge cases', () => {
  it('leaves an empty composition alone', () => {
    const empty = composeRequest(
      /** @type {any} */ (
        parseRequest({ messages: [] }, { apiFormat: 'anthropic-messages' })
      ),
    )
    expect(rescaleToActual(empty, 1000)).toBe(empty)
  })

  it('hands everything to the first slot when there is nothing to scale by', () => {
    // No proportion to preserve, so inventing a distribution would be a lie.
    expect(distribute([0, 0, 0], 900)).toEqual([900, 0, 0])
  })

  it('rounds to whole tokens even when the target is smaller than the parts', () => {
    const out = distribute([500, 300, 200], 2)
    expect(out.reduce((a, b) => a + b, 0)).toBe(2)
    expect(out.every(Number.isInteger)).toBe(true)
  })
})

describe('billing for providers where a bearer token is ambiguous', () => {
  it('treats a bearer token as metered for the api providers', () => {
    for (const provider of ['openai', 'gemini', 'vertex']) {
      expect(detectBillingMode({ authorization: '[redacted]' }, { provider })).toBe('api')
    }
  })
})

describe('tool identification and launch', () => {
  it('recognises kimi from its user agent', () => {
    expect(identifyTool({ 'user-agent': 'Kimi-CLI/0.3' })).toBe('kimi')
  })

  it('recognises pi from its system prompt', () => {
    expect(identifyTool({}, 'you are operating inside pi, a coding agent')).toBe('pi')
  })

  it('handles a user-agent header arriving as an array', () => {
    expect(identifyTool({ 'user-agent': ['claude-cli/1.0', 'extra'] })).toBe('claude')
  })

  it('carries no server env for a tool that needs none', () => {
    expect(buildToolEnv('claude', 'http://localhost:4040').serverEnv).toEqual({})
  })
})
