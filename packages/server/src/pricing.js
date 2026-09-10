/**
 * Keeping the price table fresh.
 *
 * The only part of pricing that touches the network. Everything it fetches is
 * public, and nothing about the user is sent: it is a plain GET for a price
 * list.
 *
 * The rules this file exists to obey (WIRE-FORMATS.md section 10):
 *
 *   - never block startup on the network
 *   - work offline, from the bundled snapshot, on the very first run
 *   - refresh in the background, weekly
 *   - a failed refresh is not an error the user needs to see
 *
 * @module
 */

import { fromModelsDev, newerOf, SNAPSHOT } from '@contextlab/core/pricing'
import { loadPriceTable, pricingFetchedAt, savePriceTable } from '@contextlab/store'

/** @typedef {import('better-sqlite3').Database} Db */
/** @typedef {import('@contextlab/core/pricing').PriceTable} PriceTable */

export const MODELS_DEV_URL = 'https://models.dev/api.json'

/** Prices move rarely. Weekly is often enough and costs one request. */
export const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

/** Providers worth carrying. Matches scripts/update-pricing-snapshot.mjs. */
export const PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'google-vertex',
  'google-vertex-anthropic',
  'github-copilot',
  'amazon-bedrock',
  'azure',
  'xai',
  'deepseek',
  'mistral',
  'groq',
]

/**
 * Fetch the live table. Throws on any failure — the caller decides that a
 * failed refresh is survivable, not this function.
 *
 * @param {{ fetch?: typeof globalThis.fetch, url?: string,
 *           timeoutMs?: number }} [options]
 * @returns {Promise<PriceTable>}
 */
export async function fetchPriceTable(options = {}) {
  const doFetch = options.fetch ?? globalThis.fetch
  const url = options.url ?? MODELS_DEV_URL
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)

  try {
    const response = await doFetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`models.dev returned ${response.status}`)
    const raw = await response.json()
    const table = fromModelsDev(raw, PROVIDERS)
    if (Object.keys(table.providers).length === 0) {
      throw new Error('models.dev returned no priceable models')
    }
    return table
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The table to price with right now, without touching the network.
 *
 * Stored table if we have one and it is at least as new as what we shipped,
 * otherwise the bundled snapshot. Always returns something, so a cost figure
 * is never blocked on a refresh.
 *
 * @param {Db} db
 * @returns {PriceTable}
 */
export function currentPriceTable(db) {
  try {
    return newerOf(loadPriceTable(db))
  } catch {
    return SNAPSHOT
  }
}

/**
 * @param {Db} db
 * @param {{ now?: number, intervalMs?: number }} [options]
 * @returns {boolean}
 */
export function isRefreshDue(db, options = {}) {
  const fetchedAt = pricingFetchedAt(db)
  if (fetchedAt === null) return true
  const now = options.now ?? Date.now()
  return now - fetchedAt >= (options.intervalMs ?? REFRESH_INTERVAL_MS)
}

/**
 * @typedef {Object} RefreshResult
 * @property {'updated' | 'skipped' | 'failed'} status
 * @property {number} [models]
 * @property {string} [updatedAt]
 * @property {string} [reason]
 */

/**
 * Refresh if it is due. Never throws.
 *
 * A price list we could not reach is not something to interrupt anyone about —
 * the previous table, or the bundled one, is still perfectly usable and only
 * slightly stale.
 *
 * @param {Db} db
 * @param {{ fetch?: typeof globalThis.fetch, url?: string, force?: boolean,
 *           now?: number, intervalMs?: number }} [options]
 * @returns {Promise<RefreshResult>}
 */
export async function refreshPricing(db, options = {}) {
  if (!options.force && !isRefreshDue(db, options)) {
    return { status: 'skipped', reason: 'not due yet' }
  }

  try {
    const table = await fetchPriceTable(options)
    const models = savePriceTable(db, table)
    return { status: 'updated', models, updatedAt: table.updatedAt }
  } catch (error) {
    return { status: 'failed', reason: String(error) }
  }
}

/**
 * Kick a refresh off without waiting for it.
 *
 * Startup must not depend on a network round trip: the caller carries on with
 * the bundled snapshot and picks up newer prices whenever this lands.
 *
 * @param {Db} db
 * @param {Parameters<typeof refreshPricing>[1]} [options]
 * @returns {void}
 */
export function refreshPricingInBackground(db, options = {}) {
  void refreshPricing(db, options).catch(() => {})
}
