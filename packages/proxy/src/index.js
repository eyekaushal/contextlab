/**
 * @contextlab/proxy — forward + capture.
 *
 * Zero external dependencies. Node built-ins only. See README.md for why.
 *
 * @module
 */

export {
  buildCapture,
  capturesDir,
  contextlabHome,
  decodeBody,
  writeCapture,
} from './capture.js'
export { DEFAULT_PORT, MAX_CAPTURE_BYTES, UPSTREAMS } from './constants.js'
export { isSecretHeader, redactHeaders } from './headers.js'
export {
  detectProvider,
  parseUrlTag,
  resolveUpstream,
  routeRequest,
  shouldCapture,
} from './route.js'
export { createProxyServer, startProxy } from './server.js'
