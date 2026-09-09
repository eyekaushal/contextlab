/**
 * Every constant the proxy needs, in one file you can read in a minute.
 *
 * @module
 */

/** Default port. The server (the part that analyses) lives on 4041. */
export const DEFAULT_PORT = 4040

/**
 * Where each provider actually lives. See notes/WIRE-FORMATS.md section 8.
 * Vertex is regional and is computed from the request path instead.
 */
export const UPSTREAMS = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  chatgpt: 'https://chatgpt.com',
  gemini: 'https://generativelanguage.googleapis.com',
  geminiCodeAssist: 'https://cloudcode-pa.googleapis.com',
  vertex: 'https://us-central1-aiplatform.googleapis.com',
}

/**
 * Environment variable that overrides each upstream, so a tool pointed at an
 * OpenAI-compatible gateway (GitHub Copilot, a local vLLM, OpenRouter) still
 * works. `copilot` sets UPSTREAM_OPENAI_URL for exactly this reason.
 */
export const UPSTREAM_ENV = {
  openai: 'UPSTREAM_OPENAI_URL',
  anthropic: 'UPSTREAM_ANTHROPIC_URL',
  chatgpt: 'UPSTREAM_CHATGPT_URL',
  gemini: 'UPSTREAM_GEMINI_URL',
  geminiCodeAssist: 'UPSTREAM_GEMINI_CODE_ASSIST_URL',
  vertex: 'UPSTREAM_VERTEX_URL',
}

/**
 * URL segments that belong to the provider's API, not to a tool name. The CLI
 * routes tools at `/<tool>/<sessionTag>/v1/messages`, so the first segment is a
 * tool name only when it is not one of these.
 */
export const API_SEGMENTS = new Set([
  'v1',
  'v1beta',
  'v1alpha',
  'v1internal',
  'responses',
  'chat',
  'models',
  'embeddings',
  'api',
  'backend-api',
  'codex',
])

/**
 * A bare provider name in the URL is a routing hint, not a tool identity.
 * We strip it from the path but leave `tool` null so header/system-prompt
 * detection runs later. See WIRE-FORMATS.md section 4.
 */
export const BARE_PROVIDER_SEGMENTS = new Set([
  'anthropic',
  'openai',
  'gemini',
  'chatgpt',
  'vertex',
])

/**
 * Utility endpoints. Forwarded like everything else, never captured — they are
 * not conversation turns and they pollute sessions. WIRE-FORMATS.md section 9.
 */
export const IGNORED_PATH_MARKERS = [
  '/count_tokens',
  ':countTokens',
  ':loadCodeAssist',
  ':retrieveUserQuota',
  ':listExperiments',
  ':onboardUser',
  ':fetchAdminControls',
  ':recordCodeAssistMetrics',
]

/**
 * Headers whose values never reach disk. This is the whole point of keeping the
 * credential-handling code in one small package: the redaction list is right
 * here, and `redactHeaders` is the only thing that decides what a capture file
 * is allowed to contain.
 */
export const SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-goog-api-key',
  'x-goog-iam-authorization-token',
  'x-api-token',
  'x-auth-token',
  'x-session-token',
  'x-subscription-token',
  'cookie',
  'set-cookie',
  'openai-organization',
  'openai-project',
])

/** Belt and braces: anything that looks like a credential is redacted too. */
export const SECRET_HEADER_PATTERN = /(^|-)(key|token|secret|password|auth|cookie)(-|$)/

/**
 * Connection-level headers that must not be copied between the two hops.
 * RFC 9110 section 7.6.1.
 */
export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * Hard ceiling on how much of a body we hold in memory for a capture. Past
 * this we keep forwarding every byte to the tool and mark the capture
 * truncated — a capped capture is a bad number, a stalled agent is a bug.
 */
export const MAX_CAPTURE_BYTES = 24 * 1024 * 1024

/** Bump when the capture file shape changes in a way readers must notice. */
export const CAPTURE_SCHEMA_VERSION = 1
