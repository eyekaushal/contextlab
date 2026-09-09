/**
 * Per-tool configuration.
 *
 * This is the entire "integration" for each coding agent: the name of the
 * environment variable that tool honours for its API base URL. It is a table,
 * not logic — adding an eighth tool is a table entry, not a code path.
 *
 * Three tools cannot be redirected by an environment variable at all and need
 * the mitmproxy transport instead. See notes/WIRE-FORMATS.md section 8.
 *
 * @module
 */

/**
 * @typedef {Object} ToolConfig
 * @property {string} label            human name, for CLI output
 * @property {string} command          the binary we spawn
 * @property {string[]} [vars]         env vars set to the proxy URL
 * @property {string[]} [slashVars]    subset of `vars` that need a trailing "/"
 * @property {Record<string, string>} [serverEnv] env for the proxy process itself
 * @property {boolean} [needsMitm]     cannot be redirected by env var
 * @property {string} [reason]         why it needs mitm, shown by `doctor`
 */

/** @type {Record<string, ToolConfig>} */
export const TOOLS = {
  claude: {
    label: 'Claude Code',
    command: 'claude',
    vars: ['ANTHROPIC_BASE_URL'],
  },

  aider: {
    label: 'Aider',
    command: 'aider',
    vars: ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL'],
  },

  copilot: {
    label: 'GitHub Copilot CLI',
    command: 'copilot',
    vars: ['COPILOT_API_URL'],
    // Copilot speaks the OpenAI format but lives on its own host, so the proxy
    // needs to be told where "openai" really is for this run.
    serverEnv: { UPSTREAM_OPENAI_URL: 'https://api.githubcopilot.com' },
  },

  gemini: {
    label: 'Gemini CLI',
    command: 'gemini',
    vars: ['GOOGLE_GEMINI_BASE_URL', 'GOOGLE_VERTEX_BASE_URL', 'CODE_ASSIST_ENDPOINT'],
    // The Gemini CLI concatenates its path onto these two without inserting a
    // separator. Without the trailing slash the request lands on a 404.
    slashVars: ['GOOGLE_GEMINI_BASE_URL', 'GOOGLE_VERTEX_BASE_URL'],
  },

  codex: {
    label: 'Codex CLI',
    command: 'codex',
    needsMitm: true,
    reason:
      'Rust binary that connects to chatgpt.com directly, ignoring base-URL env vars',
  },

  cline: {
    label: 'Cline',
    command: 'cline',
    needsMitm: true,
    reason: 'OAuth traffic routes through api.cline.bot, which is not configurable',
  },

  opencode: {
    label: 'OpenCode',
    command: 'opencode',
    needsMitm: true,
    reason: 'Talks to several providers at once, with no single base URL to point at',
  },
}

/**
 * What we do with a tool we have never heard of.
 *
 * Setting both base URLs covers most things built on the two big SDKs,
 * including `contextlab -- python my_agent.py`.
 *
 * @type {ToolConfig}
 */
export const DEFAULT_TOOL = {
  label: 'Unknown tool',
  command: '',
  vars: ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL'],
}

/**
 * @typedef {Object} ToolLaunch
 * @property {string} tool
 * @property {string} label
 * @property {boolean} known           was it in the table?
 * @property {boolean} needsMitm
 * @property {string} [reason]
 * @property {Record<string, string>} env        set on the child process
 * @property {Record<string, string>} serverEnv  set on the proxy process
 */

/**
 * Look a tool up, falling back to the both-base-URLs default.
 *
 * @param {string} name
 * @returns {{ config: ToolConfig, known: boolean }}
 */
export function resolveTool(name) {
  const config = TOOLS[name.toLowerCase()]
  if (config) return { config, known: true }
  return { config: { ...DEFAULT_TOOL, command: name }, known: false }
}

/**
 * Build the environment for one tool run.
 *
 * The session tag is a per-run identifier the proxy reads back out of the URL,
 * so two agents running at once against the same provider stay in separate
 * sessions. See WIRE-FORMATS.md section 4.
 *
 * @param {string} name
 * @param {string} proxyUrl      e.g. "http://localhost:4040"
 * @param {string} [sessionTag]  8 hex characters
 * @returns {ToolLaunch}
 */
export function buildToolEnv(name, proxyUrl, sessionTag) {
  const tool = name.toLowerCase()
  const { config, known } = resolveTool(tool)
  const base = toolBaseUrl(proxyUrl, tool, sessionTag)

  /** @type {Record<string, string>} */
  const env = {}
  for (const variable of config.vars ?? []) {
    env[variable] = config.slashVars?.includes(variable) ? `${base}/` : base
  }

  return {
    tool,
    label: config.label,
    known,
    needsMitm: config.needsMitm === true,
    ...(config.reason ? { reason: config.reason } : {}),
    env,
    serverEnv: { ...config.serverEnv },
  }
}

/**
 * `http://localhost:4040/claude/a1b2c3d4`
 *
 * @param {string} proxyUrl
 * @param {string} tool
 * @param {string} [sessionTag]
 * @returns {string}
 */
export function toolBaseUrl(proxyUrl, tool, sessionTag) {
  const root = proxyUrl.endsWith('/') ? proxyUrl.slice(0, -1) : proxyUrl
  return sessionTag ? `${root}/${tool}/${sessionTag}` : `${root}/${tool}`
}

/**
 * Environment that routes a process through mitmproxy instead.
 *
 * Node ignores SSL_CERT_FILE and needs NODE_EXTRA_CA_CERTS; Python tools want
 * REQUESTS_CA_BUNDLE. We set all of them because the alternative is a matrix
 * of per-tool special cases.
 *
 * @param {string} certPath  path to mitmproxy-ca-cert.pem
 * @param {number} [port]
 * @returns {Record<string, string>}
 */
export function buildMitmEnv(certPath, port = 8080) {
  const proxy = `http://localhost:${port}`
  return {
    http_proxy: proxy,
    https_proxy: proxy,
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    NODE_USE_ENV_PROXY: '1',
    SSL_CERT_FILE: certPath,
    NODE_EXTRA_CA_CERTS: certPath,
    REQUESTS_CA_BUNDLE: certPath,
  }
}

/** Tools that need the mitm transport, for `doctor` to check up front. */
export const MITM_TOOLS = Object.keys(TOOLS).filter((name) => TOOLS[name]?.needsMitm)

/**
 * Work out which tool sent a request when the URL carries no tag — every
 * request that arrives over mitmproxy, and anything pointed at the proxy by
 * hand. Headers first, then the system prompt.
 *
 * A bare provider name is not a tool identity, so it never appears here.
 * WIRE-FORMATS.md section 4.
 *
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} [systemText] the system prompt, already flattened to text
 * @returns {string | null}
 */
export function identifyTool(headers, systemText = '') {
  const raw = headers['user-agent']
  const agent = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')

  if (/^claude-cli\//.test(agent)) return 'claude'
  if (/aider/i.test(agent)) return 'aider'
  if (/^GeminiCLI\//.test(agent)) return 'gemini'
  if (/kimi/i.test(agent)) return 'kimi'

  if (systemText.includes('You are Claude Code')) return 'claude'
  if (systemText.includes('Act as an expert software developer')) return 'aider'
  if (systemText.includes('operating inside pi, a coding agent')) return 'pi'

  return null
}
