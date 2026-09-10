#!/usr/bin/env node
/**
 * Regenerate the bundled pricing snapshot from models.dev.
 *
 *   node scripts/update-pricing-snapshot.mjs
 *
 * The snapshot is the offline fallback: it makes `contextlab cost` correct on a
 * plane, on first run, and if models.dev is ever down. At runtime the server
 * refreshes from the live API and stores newer prices in SQLite, so this file
 * only has to be good, not current.
 *
 * Prices are USD per million tokens, which is how models.dev publishes them.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://models.dev/api.json'

/** The providers our seven tools actually reach. */
const PROVIDERS = [
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
  // Deliberately not openrouter: 354 models that are almost all restatements of
  // other providers under "vendor/model" ids, which normalizeModelId already
  // resolves to the underlying provider.
]

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, '..', 'packages', 'core', 'src', 'pricing', 'snapshot.js')

const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`models.dev returned ${response.status}`)
const raw = await response.json()

/** @type {Record<string, Record<string, object>>} */
const providers = {}
let models = 0

for (const providerId of PROVIDERS) {
  const provider = raw[providerId]
  if (!provider?.models) continue

  /** @type {Record<string, object>} */
  const table = {}
  for (const [modelId, model] of Object.entries(provider.models)) {
    // No price means we cannot cost it, so carrying it is dead weight.
    if (!model?.cost || typeof model.cost.input !== 'number') continue
    table[modelId] = {
      input: model.cost.input,
      output: model.cost.output ?? 0,
      ...(typeof model.cost.cache_read === 'number'
        ? { cacheRead: model.cost.cache_read }
        : {}),
      ...(typeof model.cost.cache_write === 'number'
        ? { cacheWrite: model.cost.cache_write }
        : {}),
      ...(model.limit?.context ? { context: model.limit.context } : {}),
      ...(model.limit?.output ? { maxOutput: model.limit.output } : {}),
    }
    models += 1
  }
  if (Object.keys(table).length > 0) providers[providerId] = table
}

const snapshot = {
  updatedAt: new Date().toISOString().slice(0, 10),
  source: SOURCE,
  unit: 'usd_per_million_tokens',
  providers,
}

const file = `/**
 * Bundled pricing snapshot — generated, do not edit by hand.
 *
 * Regenerate with:  node scripts/update-pricing-snapshot.mjs
 *
 * Prices are USD per million tokens. This is the offline fallback; the server
 * refreshes from models.dev at runtime and newer prices live in SQLite.
 *
 * @module
 */

/** @type {import('./index.js').PriceTable} */
export const SNAPSHOT = ${JSON.stringify(snapshot, null, 2)}
`

writeFileSync(target, file, 'utf8')
console.log(
  `wrote ${target}\n${Object.keys(providers).length} providers, ${models} models, ${(file.length / 1024).toFixed(0)}KB`,
)
