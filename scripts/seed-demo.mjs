#!/usr/bin/env node
/**
 * Write a set of demo captures, so the dashboard has something to show.
 *
 *   node scripts/seed-demo.mjs              # into ~/.contextlab-demo
 *   node scripts/seed-demo.mjs ./somewhere  # into a directory you choose
 *
 * Then point the dashboard at the same place:
 *
 *   CONTEXTLAB_HOME=~/.contextlab-demo node packages/cli/bin/contextlab.js dashboard
 *
 * These are capture files in the exact shape the proxy writes, so everything
 * downstream — parsing, composition, attribution, pricing, the rules — runs for
 * real. Nothing here is a fixture injected into the database.
 *
 * The five sessions are chosen to exercise different corners of the UI: one
 * badly behaved, one clean, one near its context limit, one full of images and
 * reasoning, and one stuck in a retry loop.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const home = resolve(process.argv[2] ?? join(homedir(), '.contextlab-demo'))
const captures = join(home, 'captures')

// Start from a clean slate so re-running does not stack five more sessions on
// top of the last five.
rmSync(home, { recursive: true, force: true })
mkdirSync(captures, { recursive: true })

const MINUTE = 60_000
let clock = Date.now() - 6 * 60 * MINUTE
let sequence = 0

/**
 * @param {string} server
 * @param {string} name
 * @returns {object}
 */
const mcpTool = (server, name) => ({
  name: `mcp__${server}__${name}`,
  description:
    `${name} via ${server}. Performs the operation against the current target, ` +
    'waiting for it to settle, and returns a structured result describing what ' +
    'changed or an error explaining why it could not be completed.',
  input_schema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description:
          'A CSS selector identifying the element to act on. Must match exactly one.',
      },
      timeout: { type: 'number', description: 'Milliseconds before giving up.' },
      waitUntil: {
        type: 'string',
        enum: ['load', 'domcontentloaded', 'networkidle'],
        description: 'Which lifecycle event to wait for.',
      },
    },
    required: ['selector'],
  },
})

/** @param {number} lines */
const claudeMd = (lines) =>
  'Contents of /repo/contextlab/CLAUDE.md (project instructions, checked into the codebase):\n' +
  '# a project rule that goes on at some length and then repeats itself\n'.repeat(lines)

/**
 * @param {object} options
 * @returns {void}
 */
function write({
  tool,
  tag,
  model,
  cwd,
  turns,
  tools = [],
  messages,
  usage,
  systemLines = 40,
  transport = 'reverse-proxy',
}) {
  for (let turn = 0; turn < turns; turn += 1) {
    clock += MINUTE
    sequence += 1

    const capture = {
      schemaVersion: 1,
      id: `demo-${String(sequence).padStart(4, '0')}`,
      capturedAt: new Date(clock).toISOString(),
      transport,
      tool,
      sessionTag: tag,
      provider: 'anthropic',
      apiFormat: 'anthropic-messages',
      request: {
        method: 'POST',
        path: '/v1/messages',
        headers: {
          'user-agent': `${tool}-cli/1.2.3`,
          'x-api-key': '[redacted]',
          'anthropic-version': '2023-06-01',
        },
        body: {
          model,
          system:
            `You are ${tool}, an interactive CLI tool for software engineering.\n` +
            `Primary working directory: ${cwd}\n` +
            claudeMd(systemLines),
          tools,
          messages: messages(turn),
        },
        bodyEncoding: 'json',
        bodyBytes: 40_000,
        bodyTruncated: false,
      },
      response: {
        status: 200,
        streaming: false,
        headers: { 'content-type': 'application/json' },
        body: {
          model: `${model}-20260101`,
          stop_reason: 'end_turn',
          usage: usage(turn),
        },
        bodyEncoding: 'json',
        bodyBytes: 900,
        bodyTruncated: false,
      },
      timing: { startedAt: clock, firstByteMs: 420, completedMs: 3200 },
    }

    writeFileSync(
      join(captures, `${capture.capturedAt.replace(/[:.]/g, '-')}-${capture.id}.json`),
      JSON.stringify(capture, null, 2),
    )
  }
}

const npmLog = 'npm WARN deprecated left-pad@1.0.0 this package is deprecated\n'.repeat(
  1800,
)
const authFile =
  'export function login(user, password) {\n  return verify(user, password)\n}\n'.repeat(
    90,
  )

// 1. The badly behaved one: a stuck npm log, an unused MCP server, a fat
//    CLAUDE.md and the same file read over and over.
write({
  tool: 'claude',
  tag: 'aaaa0001',
  model: 'claude-opus-4-5',
  cwd: '/repo/contextlab',
  turns: 8,
  systemLines: 380,
  tools: [
    {
      name: 'Read',
      description: 'Read a file from disk',
      input_schema: { type: 'object' },
    },
    {
      name: 'Bash',
      description: 'Run a shell command',
      input_schema: { type: 'object' },
    },
    ...Array.from({ length: 14 }, (_, i) => mcpTool('playwright', `browser_${i}`)),
    ...Array.from({ length: 5 }, (_, i) => mcpTool('sentry', `issue_${i}`)),
  ],
  messages: (turn) => [
    {
      role: 'user',
      content: [{ type: 'text', text: 'the build is failing, please fix it' }],
    },
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
    ...Array.from({ length: turn }, (_, i) => [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: `r${i}`,
            name: 'Read',
            input: { file_path: '/repo/contextlab/src/auth.js' },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `r${i}`, content: authFile }],
      },
    ]).flat(),
  ],
  usage: (turn) => ({
    input_tokens: 132_000 + turn * 5200,
    output_tokens: 280 + turn * 20,
    cache_read_input_tokens: 0,
  }),
})

// 2. The clean one. Optimize should find nothing, which is a result worth
//    being able to see.
write({
  tool: 'claude',
  tag: 'bbbb0002',
  model: 'claude-haiku-4-5',
  cwd: '/repo/website',
  turns: 3,
  systemLines: 12,
  tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object' } }],
  messages: () => [
    { role: 'user', content: [{ type: 'text', text: 'fix the typo in the footer' }] },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'Fixed — "recieve" to "receive".' }],
    },
  ],
  usage: () => ({
    input_tokens: 3400,
    output_tokens: 120,
    cache_read_input_tokens: 2800,
  }),
})

// 3. Nearly out of room, and still climbing.
write({
  tool: 'aider',
  tag: 'cccc0003',
  model: 'claude-sonnet-4-6',
  cwd: '/repo/monolith',
  turns: 6,
  systemLines: 60,
  tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object' } }],
  messages: (turn) => [
    { role: 'user', content: [{ type: 'text', text: 'refactor the billing module' }] },
    ...Array.from({ length: 4 + turn * 3 }, (_, i) => ({
      role: i % 2 === 0 ? 'assistant' : 'user',
      content: [
        {
          type: 'text',
          text: `Working through billing step ${i}. `.repeat(220),
        },
      ],
    })),
  ],
  // Deliberately close to the limit without exceeding it: a window cannot be
  // more than full, and 101% would read as a bug rather than a warning.
  usage: (turn) => ({
    input_tokens: 430_000 + turn * 52_000,
    output_tokens: 900,
    cache_read_input_tokens: 180_000,
  }),
})

// 4. Images and heavy reasoning, for the categories that rarely show up.
write({
  tool: 'gemini',
  tag: 'dddd0004',
  model: 'claude-opus-4-5',
  cwd: '/repo/design-system',
  turns: 4,
  systemLines: 25,
  tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object' } }],
  messages: () => [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'does this screenshot match the spec?' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(180_000) },
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking:
            'Comparing the rendered spacing against the tokens in the spec. '.repeat(900),
        },
        { type: 'text', text: 'The gutter is 4px narrower than specified.' },
      ],
    },
  ],
  usage: () => ({
    input_tokens: 48_000,
    output_tokens: 2400,
    cache_read_input_tokens: 12_000,
  }),
})

// 5. Stuck in a loop: the same failing command, over and over.
write({
  tool: 'codex',
  // Codex cannot be redirected with an environment variable, so in reality its
  // captures arrive over the mitmproxy transport.
  transport: 'mitmproxy',
  tag: 'eeee0005',
  model: 'claude-sonnet-4-6',
  cwd: '/repo/api',
  turns: 5,
  systemLines: 30,
  tools: [
    { name: 'Bash', description: 'Run a command', input_schema: { type: 'object' } },
  ],
  messages: (turn) => [
    { role: 'user', content: [{ type: 'text', text: 'make the tests pass' }] },
    ...Array.from({ length: turn + 1 }, (_, i) => [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: `t${i}`,
            name: 'Bash',
            input: { command: 'pytest -q' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: `t${i}`,
            content: 'E   ModuleNotFoundError: No module named "billing"\n'.repeat(120),
          },
        ],
      },
    ]).flat(),
  ],
  usage: (turn) => ({
    input_tokens: 28_000 + turn * 9000,
    output_tokens: 200,
    cache_read_input_tokens: 4000,
  }),
})

console.log(`Wrote ${sequence} captures across 5 sessions to ${captures}

Start the dashboard against them:

  CONTEXTLAB_HOME=${home} node packages/cli/bin/contextlab.js dashboard
`)
