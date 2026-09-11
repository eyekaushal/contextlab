/**
 * @contextlab/server — the brain, on :4041.
 *
 * Reads capture files, runs them through core, writes to store, and serves the
 * dashboard over HTTP and SSE. Holds no analysis of its own and never handles
 * a credential.
 *
 * @module
 */

export { createApp } from './app.js'
export { createEventHub } from './events.js'
export { buildExport } from './export.js'
export { ingestCapture, ingestDirectory } from './ingest.js'
export {
  currentPriceTable,
  fetchPriceTable,
  isRefreshDue,
  MODELS_DEV_URL,
  REFRESH_INTERVAL_MS,
  refreshPricing,
  refreshPricingInBackground,
} from './pricing.js'
export { toCamel, toCamelAll } from './serialize.js'
export { contextlabHome, DEFAULT_PORT, startServer, webRoot } from './server.js'
export { buildSessionSummary } from './summary.js'
