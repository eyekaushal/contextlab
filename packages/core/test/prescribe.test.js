import { describe, expect, it } from 'vitest'
import { attributeComposition, mergeAttribution } from '../src/attribute/index.js'
import { composeRequest } from '../src/compose/index.js'
import { parseRequest } from '../src/parse/index.js'
import {
  approachingContextLimit,
  bloatedMemoryFile,
  cacheNotWorking,
  imageOverhead,
  modelTooExpensiveForWork,
  RULES,
  rankFindings,
  reconcileFindings,
  redundantReads,
  runRules,
  stuckOnError,
  stuckOversizedResult,
  summarizeSession,
  thinkingDominates,
  totalWaste,
  unusedMcpServer,
} from '../src/prescribe/index.js'

/**
 * @param {unknown} body
 * @returns {any}
 */
function compose(body) {
  return composeRequest(
    /** @type {any} */ (parseRequest(body, { apiFormat: 'anthropic-messages' })),
  )
}

/**
 * Build a session the way the pipeline really does: compose each turn, attribute
 * each turn, merge, summarize.
 *
 * @param {unknown[]} bodies
 * @param {any} [options]
 * @returns {any}
 */
function session(bodies, options = {}) {
  const rate = options.inputPricePerMillion ?? 5
  const compositions = bodies.map((body) => compose(body))
  const attribution = mergeAttribution(
    compositions.map((composition) =>
      attributeComposition(composition, { inputPricePerMillion: rate }),
    ),
    { inputPricePerMillion: rate },
  )
  return summarizeSession(
    compositions.map((composition) => ({ composition, ...(options.usage ?? {}) })),
    { inputPricePerMillion: rate, attribution, ...options },
  )
}

/**
 * A tool definition the size real MCP servers actually ship — a few hundred
 * tokens of JSON schema each. Using a toy schema here would let the rule pass
 * its test while never firing on a real session.
 */
const mcpTool = (/** @type {string} */ server, /** @type {string} */ name) => ({
  name: `mcp__${server}__${name}`,
  description:
    `${name} via ${server}. Performs the ${name} operation against the current ` +
    'target, waiting for the page to settle before and after. Returns a ' +
    'structured result describing what changed, or an error explaining why the ' +
    'operation could not be completed.',
  input_schema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description:
          'A CSS selector identifying the element to act on. Must match exactly ' +
          'one element; if it matches several the call fails with an error.',
      },
      timeout: {
        type: 'number',
        description:
          'How long to wait, in milliseconds, before giving up. Defaults to 30000.',
      },
      waitUntil: {
        type: 'string',
        enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
        description: 'Which lifecycle event to wait for before considering it done.',
      },
      force: {
        type: 'boolean',
        description: 'Skip actionability checks and act on the element regardless.',
      },
      position: {
        type: 'object',
        description: 'Point relative to the top-left of the element to act on.',
        properties: {
          x: { type: 'number', description: 'Horizontal offset in pixels' },
          y: { type: 'number', description: 'Vertical offset in pixels' },
        },
      },
    },
    required: ['selector'],
  },
})

describe('the ten rules', () => {
  it('ships exactly ten, each with a unique name', () => {
    expect(RULES).toHaveLength(10)
    expect(new Set(RULES.map((rule) => rule.name)).size).toBe(10)
  })
})

describe('1 — unused mcp server', () => {
  const bodies = Array.from({ length: 6 }, () => ({
    tools: Array.from({ length: 12 }, (_, i) => mcpTool('playwright', `action_${i}`)),
    messages: [{ role: 'user', content: 'hello' }],
  }))

  it('flags a server that was defined every turn and never called', () => {
    const [finding] = unusedMcpServer(session(bodies))
    expect(finding?.title).toContain('playwright')
    expect(finding?.severity).toBe('critical')
    expect(finding?.wastedTokens).toBeGreaterThan(0)
    // The fix has to be a change someone can make, not a suggestion to reflect.
    expect(finding?.fix).toContain('.mcp.json')
  })

  it('stays quiet when the server is actually used', () => {
    const used = bodies.map((body) => ({
      ...body,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'c1',
              name: 'mcp__playwright__action_0',
              input: { selector: '#go' },
            },
          ],
        },
      ],
    }))
    expect(unusedMcpServer(session(used))).toHaveLength(0)
  })

  it('stays quiet about a server too small to be worth removing', () => {
    const tiny = [{ tools: [{ name: 'mcp__tiny__ping' }], messages: [] }]
    expect(unusedMcpServer(session(tiny))).toHaveLength(0)
  })
})

describe('2 — stuck oversized tool result', () => {
  const npmLog = 'npm WARN deprecated package@1.0.0 this is deprecated\n'.repeat(1200)
  const turn = {
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'npm install' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'c1', content: npmLog }],
      },
    ],
  }

  it('charges only the re-sends, not the first legitimate send', () => {
    const [finding] = stuckOversizedResult(session([turn, turn, turn, turn]))
    expect(finding?.title).toContain('re-sent 4 times')
    expect(finding?.evidence?.tool).toBe('Bash')

    const one = stuckOversizedResult(session([turn]))
    expect(one).toHaveLength(0)

    const four = /** @type {any} */ (finding)
    // Four turns, one original send: three re-sends.
    expect(four.wastedTokens).toBe(four.evidence.tokens * 3)
  })

  it('ignores a small result that happens to repeat', () => {
    const small = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }],
        },
      ],
    }
    expect(stuckOversizedResult(session([small, small, small]))).toHaveLength(0)
  })
})

describe('3 — bloated memory file', () => {
  it('claims only the excess over a reasonable size', () => {
    const body = {
      system:
        'You are Claude Code.\nContents of /repo/CLAUDE.md (project instructions):\n' +
        '# a rule that goes on and on and on\n'.repeat(700),
      messages: [{ role: 'user', content: 'hi' }],
    }
    const [finding] = bloatedMemoryFile(session([body, body, body]))
    expect(finding?.title).toContain('CLAUDE.md')
    expect(finding?.detail).toContain('all 3 turns')
    // Not the whole file: the file is useful, its size is not.
    expect(finding?.wastedTokens).toBeLessThan(Number(finding?.evidence?.perTurn) * 3)
  })

  it('leaves a lean memory file alone', () => {
    const body = {
      system: 'Base.\nContents of /repo/CLAUDE.md (project instructions):\nbe concise',
      messages: [],
    }
    expect(bloatedMemoryFile(session([body]))).toHaveLength(0)
  })
})

describe('4 — redundant read', () => {
  it('flags a file read twice and charges the repeat', () => {
    const contents = 'export function login() {}\n'.repeat(400)
    const read = (/** @type {string} */ id) => ({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id, name: 'Read', input: { file_path: '/repo/auth.js' } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: contents }],
        },
      ],
    })
    const [finding] = redundantReads(session([read('c1'), read('c2')]))
    expect(finding?.title).toContain('/repo/auth.js')
    expect(finding?.title).toContain('2 times')
    expect(finding?.wastedTokens).toBeGreaterThan(500)
  })
})

describe('5 — approaching context limit', () => {
  it('warns when the window is filling and still growing', () => {
    const summary = {
      ...session([{ messages: [] }]),
      turnCount: 5,
      contextLimit: 200_000,
      firstContextTokens: 40_000,
      lastContextTokens: 175_000,
    }
    const [finding] = approachingContextLimit(/** @type {any} */ (summary))
    expect(finding?.title).toContain('88%')
    // Nothing has been spent badly yet, so it claims no waste.
    expect(finding?.wastedCostUsd).toBe(0)
    expect(finding?.severity).toBe('warning')
  })

  it('says nothing when the context is shrinking', () => {
    const summary = {
      ...session([{ messages: [] }]),
      turnCount: 5,
      contextLimit: 200_000,
      firstContextTokens: 190_000,
      lastContextTokens: 170_000,
    }
    expect(approachingContextLimit(/** @type {any} */ (summary))).toHaveLength(0)
  })

  it('says nothing when we do not know the limit', () => {
    const summary = { ...session([{ messages: [] }]), turnCount: 5, contextLimit: null }
    expect(approachingContextLimit(/** @type {any} */ (summary))).toHaveLength(0)
  })
})

describe('6 — model too expensive for the work', () => {
  const reads = Array.from({ length: 6 }, (_, i) => ({
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: `c${i}`,
            name: 'Read',
            input: { file_path: `/repo/${i}.js` },
          },
        ],
      },
    ],
  }))

  it('offers a cheaper model when every call was a read', () => {
    const summary = { ...session(reads), model: 'claude-opus-5', totalCostUsd: 2 }
    const [finding] = modelTooExpensiveForWork(/** @type {any} */ (summary), {
      alternative: { model: 'claude-haiku-4-5', inputPricePerMillion: 1 },
    })
    expect(finding?.fix).toContain('claude-haiku-4-5')
    expect(finding?.wastedCostUsd).toBeCloseTo(2 * (1 - 1 / 5))
  })

  it('says nothing once real edits are involved', () => {
    const edits = [
      ...reads,
      {
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'e1',
                name: 'Edit',
                input: { file_path: '/repo/a.js' },
              },
            ],
          },
        ],
      },
    ]
    const summary = { ...session(edits), totalCostUsd: 2 }
    expect(
      modelTooExpensiveForWork(/** @type {any} */ (summary), {
        alternative: { model: 'claude-haiku-4-5', inputPricePerMillion: 1 },
      }),
    ).toHaveLength(0)
  })

  it('says nothing without a cheaper alternative to name', () => {
    expect(modelTooExpensiveForWork(/** @type {any} */ (session(reads)))).toHaveLength(0)
  })
})

describe('7 — cache not working', () => {
  it('flags a session paying full price for a repeated prefix', () => {
    const summary = {
      ...session([{ messages: [] }, { messages: [] }, { messages: [] }]),
      turnCount: 4,
      usage: {
        inputTokens: 120_000,
        outputTokens: 400,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        thinkingTokens: 0,
      },
      turns: [
        { seq: 0, contextTokens: 30_000 },
        { seq: 1, contextTokens: 30_000 },
        { seq: 2, contextTokens: 30_000 },
        { seq: 3, contextTokens: 30_000 },
      ],
    }
    const [finding] = cacheNotWorking(/** @type {any} */ (summary))
    expect(finding?.severity).toBe('critical')
    expect(finding?.title).toContain('0%')
    // Three re-sent turns at the 0.9 discount they should have had.
    expect(finding?.wastedTokens).toBeCloseTo(90_000 * 0.9)
  })

  it('stays quiet when caching is working', () => {
    const summary = {
      ...session([{ messages: [] }]),
      turnCount: 5,
      usage: {
        inputTokens: 10_000,
        outputTokens: 0,
        cacheReadTokens: 190_000,
        cacheWriteTokens: 0,
        thinkingTokens: 0,
      },
    }
    expect(cacheNotWorking(/** @type {any} */ (summary))).toHaveLength(0)
  })

  it('stays quiet on a session too short to judge', () => {
    const summary = { ...session([{ messages: [] }]), turnCount: 2 }
    expect(cacheNotWorking(/** @type {any} */ (summary))).toHaveLength(0)
  })
})

describe('8 — stuck on an error', () => {
  it('flags the same call repeated with identical arguments', () => {
    const attempt = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'pytest -q' } },
          ],
        },
      ],
    }
    const [finding] = stuckOnError(session([attempt, attempt, attempt, attempt]))
    expect(finding?.title).toContain('4 times')
    expect(finding?.evidence?.tool).toBe('Bash')
  })

  it('does not flag the same tool called on different arguments', () => {
    const bodies = ['a', 'b', 'c', 'd'].map((file) => ({
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'c',
              name: 'Read',
              input: { file_path: `/repo/${file}.js` },
            },
          ],
        },
      ],
    }))
    expect(stuckOnError(session(bodies))).toHaveLength(0)
  })

  it('treats argument order as irrelevant', () => {
    const one = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'c', name: 'X', input: { a: 1, b: 2 } }],
        },
      ],
    }
    const other = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'c', name: 'X', input: { b: 2, a: 1 } }],
        },
      ],
    }
    expect(stuckOnError(session([one, other, one]))).toHaveLength(1)
  })
})

describe('9 — image overhead', () => {
  it('charges for every re-send after the first', () => {
    const withImage = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: { media_type: 'image/png', data: 'AAAA' } }],
        },
      ],
    }
    const [finding] = imageOverhead(session([withImage, withImage, withImage]))
    expect(finding?.wastedTokens).toBe(1600 * 2)
  })

  it('says nothing about a single screenshot', () => {
    const once = {
      messages: [
        { role: 'user', content: [{ type: 'image', source: { data: 'AAAA' } }] },
      ],
    }
    expect(imageOverhead(session([once]))).toHaveLength(0)
  })
})

describe('10 — thinking dominates', () => {
  it('flags reasoning above 40% of the context', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Let me reason about this at length. '.repeat(400),
            },
            { type: 'text', text: 'ok' },
          ],
        },
      ],
    }
    const [finding] = thinkingDominates(session([body]))
    expect(finding?.title).toMatch(/Reasoning is \d+% of the context/)
    expect(finding?.fix).toContain('thinking budget')
  })

  it('says nothing when reasoning is a normal share', () => {
    const body = {
      system: 'A long system prompt. '.repeat(500),
      messages: [
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'brief' }] },
      ],
    }
    expect(thinkingDominates(session([body]))).toHaveLength(0)
  })
})

describe('running every rule', () => {
  const npmLog = 'npm WARN deprecated thing@1.0.0\n'.repeat(1500)
  const turn = {
    system:
      'You are Claude Code.\nContents of /repo/CLAUDE.md (project instructions):\n' +
      '# rule\n'.repeat(800),
    tools: Array.from({ length: 12 }, (_, i) => mcpTool('playwright', `action_${i}`)),
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'npm install' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'c1', content: npmLog }],
      },
    ],
  }
  const summary = session([turn, turn, turn, turn, turn])

  it('finds the real problems in a bad session', () => {
    const findings = runRules(summary)
    const rules = findings.map((finding) => finding.rule)
    expect(rules).toContain('unused-mcp-server')
    expect(rules).toContain('stuck-oversized-result')
    expect(rules).toContain('bloated-memory-file')
  })

  it('ranks by money, because that is the question being asked', () => {
    const costs = runRules(summary).map((finding) => finding.wastedCostUsd)
    expect([...costs].sort((a, b) => b - a)).toEqual(costs)
  })

  it('gives every finding a title, a cost and an actual fix', () => {
    for (const finding of runRules(summary)) {
      expect(finding.title.length).toBeGreaterThan(10)
      expect(finding.fix.length).toBeGreaterThan(20)
      expect(finding.wastedCostUsd).toBeGreaterThanOrEqual(0)
      expect(['critical', 'warning', 'info']).toContain(finding.severity)
    }
  })

  it('produces the same answer every time', () => {
    // The whole promise: no model, no sampling, no clock.
    expect(JSON.stringify(runRules(summary))).toBe(JSON.stringify(runRules(summary)))
  })

  it('totals the waste for the headline', () => {
    const findings = runRules(summary)
    const total = totalWaste(findings)
    expect(total.count).toBe(findings.length)
    expect(total.critical).toBeGreaterThan(0)
    // Only findings that survived reconciliation, and only the recoverable
    // kind, contribute to the headline.
    const counted = findings.filter(
      (/** @type {any} */ f) =>
        f.claim === 'recoverable' && f.countsTowardTotal !== false,
    )
    expect(total.recoverableUsd).toBeCloseTo(
      counted.reduce((sum, /** @type {any} */ f) => sum + f.wastedCostUsd, 0),
    )
  })

  it('survives a rule that throws instead of losing the whole report', () => {
    /** @type {string[]} */
    const failed = []
    const findings = runRules(/** @type {any} */ ({ ...summary, attribution: null }), {
      onError: (rule) => failed.push(rule),
    })
    expect(failed.length).toBeGreaterThan(0)
    expect(Array.isArray(findings)).toBe(true)
  })

  it('finds nothing wrong with a clean session', () => {
    const clean = session([
      { messages: [{ role: 'user', content: 'fix the typo in the readme' }] },
    ])
    expect(runRules(clean)).toEqual([])
  })
})

describe('rankFindings', () => {
  it('breaks a cost tie with severity', () => {
    const ranked = rankFindings(
      /** @type {any[]} */ ([
        {
          rule: 'a',
          severity: 'info',
          title: 'A',
          detail: '',
          fix: '',
          wastedTokens: 0,
          wastedCostUsd: 0,
        },
        {
          rule: 'b',
          severity: 'warning',
          title: 'B',
          detail: '',
          fix: '',
          wastedTokens: 0,
          wastedCostUsd: 0,
        },
      ]),
    )
    expect(ranked.map((finding) => finding.rule)).toEqual(['b', 'a'])
  })
})

describe('reconciling what a finding claims', () => {
  const authFile = 'export function login() {}\n'.repeat(400)

  /** A session where a large file is both re-read and stuck in the history. */
  const overlapping = session(
    Array.from({ length: 6 }, (_, turn) => ({
      tools: [{ name: 'Read', description: 'Read a file', input_schema: {} }],
      messages: [
        { role: 'user', content: 'fix the build' },
        ...Array.from({ length: turn + 1 }, (_, i) => [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: `r${i}`,
                name: 'Read',
                input: { file_path: '/repo/auth.js' },
              },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: `r${i}`, content: authFile }],
          },
        ]).flat(),
      ],
    })),
  )

  it('never lets two rules claim the same tokens', () => {
    const findings = runRules(overlapping)
    const counted = findings.filter(
      (/** @type {any} */ f) =>
        f.claim === 'recoverable' && f.countsTowardTotal !== false,
    )
    const keys = counted.map((/** @type {any} */ f) => f.claimKey)
    // A file read many times is both a redundant read and a stuck result.
    // Both are true; only one may be counted.
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps a superseded finding visible, and says what took its claim', () => {
    const findings = reconcileFindings(
      /** @type {any[]} */ ([
        {
          rule: 'big',
          severity: 'critical',
          title: 'B',
          detail: '',
          fix: '',
          wastedTokens: 900,
          wastedCostUsd: 9,
          claim: 'recoverable',
          claimKey: 'file:/a.js',
        },
        {
          rule: 'small',
          severity: 'warning',
          title: 'S',
          detail: '',
          fix: '',
          wastedTokens: 100,
          wastedCostUsd: 1,
          claim: 'recoverable',
          claimKey: 'file:/a.js',
        },
      ]),
    )
    const small = findings.find((f) => f.rule === 'small')
    expect(small?.countsTowardTotal).toBe(false)
    expect(small?.supersededBy).toBe('big')
    // Still in the list — it is worth reading, it just is not counted twice.
    expect(findings).toHaveLength(2)
  })

  it('keeps a hypothetical out of the money already spent', () => {
    const findings = /** @type {any[]} */ ([
      {
        rule: 'r',
        severity: 'critical',
        title: 'R',
        detail: '',
        fix: '',
        wastedTokens: 100,
        wastedCostUsd: 2,
        claim: 'recoverable',
        claimKey: 'r',
      },
      {
        rule: 'cache-not-working',
        severity: 'critical',
        title: 'C',
        detail: '',
        fix: '',
        wastedTokens: 900,
        wastedCostUsd: 9,
        claim: 'potential',
        claimKey: 'cache',
      },
    ])
    const total = totalWaste(findings)
    // "A working cache would have saved $9" is not $9 you lost.
    expect(total.recoverableUsd).toBe(2)
    expect(total.potentialUsd).toBe(9)
  })

  it('cannot report recovering more than the session cost', () => {
    // The helper attaches no cost to its turns, so price the session's own
    // billed tokens: the ceiling on what could possibly be recovered.
    const spendUsd =
      ((overlapping.usage.inputTokens + overlapping.usage.cacheReadTokens) / 1_000_000) *
        overlapping.inputPricePerMillion || 5

    const total = totalWaste(runRules(overlapping), { spendUsd })
    expect(total.recoverableUsd).toBeLessThanOrEqual(spendUsd)
  })

  it('reports a clamp rather than hiding it', () => {
    // The clamp is a seatbelt, not the fix. When it binds, `capped` says so,
    // surfacing an over-claiming rule instead of quietly trimming it.
    const overClaiming = /** @type {any[]} */ ([
      {
        rule: 'r',
        severity: 'critical',
        title: 'R',
        detail: '',
        fix: '',
        wastedTokens: 10,
        wastedCostUsd: 99,
        claim: 'recoverable',
        claimKey: 'r',
      },
    ])
    expect(totalWaste(overClaiming, { spendUsd: 10 })).toMatchObject({
      capped: true,
      recoverableUsd: 10,
    })
    expect(totalWaste(overClaiming, { spendUsd: 200 }).capped).toBe(false)
  })

  it('leaves a dismissed finding out of every total but still in the list', () => {
    // Setting a finding aside is a judgement, not a deletion. It stops counting
    // and stays visible behind a filter, so the decision can be reversed.
    const findings = /** @type {any[]} */ ([
      {
        rule: 'a',
        severity: 'critical',
        title: 'A',
        detail: '',
        fix: '',
        wastedTokens: 100,
        wastedCostUsd: 3,
        claim: 'recoverable',
        claimKey: 'a',
      },
      {
        rule: 'b',
        severity: 'critical',
        title: 'B',
        detail: '',
        fix: '',
        wastedTokens: 50,
        wastedCostUsd: 1,
        claim: 'recoverable',
        claimKey: 'b',
        dismissedAt: 1_700_000_000_000,
      },
      {
        rule: 'cache-not-working',
        severity: 'warning',
        title: 'C',
        detail: '',
        fix: '',
        wastedTokens: 900,
        wastedCostUsd: 9,
        claim: 'potential',
        claimKey: 'cache',
        dismissedAt: 1_700_000_000_000,
      },
    ])

    const total = totalWaste(findings)
    expect(total.recoverableUsd).toBe(3)
    expect(total.potentialUsd).toBe(0)
    expect(total.count).toBe(1)
    expect(total.critical).toBe(1)
    expect(total.dismissed).toBe(2)

    // Reconciliation still ran over all three — nothing was dropped.
    expect(reconcileFindings(findings)).toHaveLength(3)
  })

  it('gives every rule a claim type and a key', () => {
    for (const finding of runRules(overlapping)) {
      expect(['recoverable', 'potential']).toContain(finding.claim)
      expect(String(finding.claimKey).length).toBeGreaterThan(0)
    }
  })
})
