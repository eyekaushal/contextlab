export { ingestCapture, ingestDirectory } from './ingest.js'
/**
 * @contextlab/server — the brain, on :4041.
 *
 * Reads capture files, runs them through core, writes to store, pushes SSE to
 * the dashboard. Holds no analysis logic of its own and never handles a
 * credential.
 *
 * Populated on day 3.
 */
export {
  currentPriceTable,
  fetchPriceTable,
  isRefreshDue,
  MODELS_DEV_URL,
  REFRESH_INTERVAL_MS,
  refreshPricing,
  refreshPricingInBackground,
} from './pricing.js'
export { buildSessionSummary } from './summary.js'
