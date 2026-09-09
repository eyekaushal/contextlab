import { describe, expect, it } from 'vitest'
import {
  buildMitmEnv,
  buildToolEnv,
  identifyTool,
  MITM_TOOLS,
  TOOLS,
  toolBaseUrl,
} from '../src/tools.js'

const PROXY = 'http://localhost:4040'

describe('the tool table', () => {
  it('covers all seven tools promised on day one', () => {
    expect(Object.keys(TOOLS).sort()).toEqual([
      'aider',
      'claude',
      'cline',
      'codex',
      'copilot',
      'gemini',
      'opencode',
    ])
  })

  it('knows which three cannot be redirected by an env var', () => {
    expect(MITM_TOOLS.sort()).toEqual(['cline', 'codex', 'opencode'])
  })

  it('gives every mitm tool a reason doctor can print', () => {
    for (const name of MITM_TOOLS) {
      expect(TOOLS[name]?.reason).toBeTruthy()
    }
  })
})

describe('buildToolEnv', () => {
  it('points claude at the proxy', () => {
    const launch = buildToolEnv('claude', PROXY, 'a1b2c3d4')
    expect(launch.env).toEqual({
      ANTHROPIC_BASE_URL: 'http://localhost:4040/claude/a1b2c3d4',
    })
    expect(launch.needsMitm).toBe(false)
  })

  it('sets both base URLs for aider, which talks to two providers', () => {
    const launch = buildToolEnv('aider', PROXY, 'a1b2c3d4')
    expect(launch.env.ANTHROPIC_BASE_URL).toBe('http://localhost:4040/aider/a1b2c3d4')
    expect(launch.env.OPENAI_BASE_URL).toBe('http://localhost:4040/aider/a1b2c3d4')
  })

  it('keeps the trailing slash the gemini CLI needs', () => {
    const launch = buildToolEnv('gemini', PROXY, 'a1b2c3d4')
    expect(launch.env.GOOGLE_GEMINI_BASE_URL).toBe(
      'http://localhost:4040/gemini/a1b2c3d4/',
    )
    expect(launch.env.GOOGLE_VERTEX_BASE_URL).toBe(
      'http://localhost:4040/gemini/a1b2c3d4/',
    )
    // Code Assist takes the path without one.
    expect(launch.env.CODE_ASSIST_ENDPOINT).toBe('http://localhost:4040/gemini/a1b2c3d4')
  })

  it('tells the proxy where copilot really lives', () => {
    const launch = buildToolEnv('copilot', PROXY, 'a1b2c3d4')
    expect(launch.env.COPILOT_API_URL).toBe('http://localhost:4040/copilot/a1b2c3d4')
    expect(launch.serverEnv).toEqual({
      UPSTREAM_OPENAI_URL: 'https://api.githubcopilot.com',
    })
  })

  it('sets no base URL for a tool that needs mitm', () => {
    const launch = buildToolEnv('codex', PROXY, 'a1b2c3d4')
    expect(launch.needsMitm).toBe(true)
    expect(launch.env).toEqual({})
    expect(launch.reason).toContain('chatgpt.com')
  })

  it('falls back to both base URLs for an unknown tool', () => {
    const launch = buildToolEnv('my-agent', PROXY, 'a1b2c3d4')
    expect(launch.known).toBe(false)
    expect(Object.keys(launch.env).sort()).toEqual([
      'ANTHROPIC_BASE_URL',
      'OPENAI_BASE_URL',
    ])
  })

  it('works without a session tag', () => {
    expect(buildToolEnv('claude', PROXY).env.ANTHROPIC_BASE_URL).toBe(
      'http://localhost:4040/claude',
    )
  })

  it('does not double the slash when the proxy URL has one', () => {
    expect(toolBaseUrl('http://localhost:4040/', 'claude', 'a1b2c3d4')).toBe(
      'http://localhost:4040/claude/a1b2c3d4',
    )
  })
})

describe('buildMitmEnv', () => {
  it('sets every CA variable, because no single one covers node and python', () => {
    const env = buildMitmEnv('/Users/x/.mitmproxy/mitmproxy-ca-cert.pem')
    expect(env.https_proxy).toBe('http://localhost:8080')
    // Node ignores SSL_CERT_FILE; python ignores NODE_EXTRA_CA_CERTS.
    expect(env.NODE_EXTRA_CA_CERTS).toContain('mitmproxy-ca-cert.pem')
    expect(env.SSL_CERT_FILE).toContain('mitmproxy-ca-cert.pem')
    expect(env.REQUESTS_CA_BUNDLE).toContain('mitmproxy-ca-cert.pem')
  })
})

describe('identifyTool', () => {
  it('reads the tool off the user agent', () => {
    expect(identifyTool({ 'user-agent': 'claude-cli/1.2.3 (external)' })).toBe('claude')
    expect(identifyTool({ 'user-agent': 'Aider/0.60' })).toBe('aider')
    expect(identifyTool({ 'user-agent': 'GeminiCLI/0.1.0' })).toBe('gemini')
  })

  it('falls back to the system prompt when the agent is anonymous', () => {
    expect(identifyTool({}, 'You are Claude Code, an interactive CLI')).toBe('claude')
    expect(identifyTool({}, 'Act as an expert software developer')).toBe('aider')
  })

  it('admits when it cannot tell', () => {
    expect(identifyTool({ 'user-agent': 'python-httpx/0.27' })).toBeNull()
  })
})
