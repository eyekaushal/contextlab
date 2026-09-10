/**
 * The price table, persisted.
 *
 * `core/pricing` does the arithmetic and ships a bundled snapshot; this file
 * is the only thing that reads or writes the refreshed copy. Storing it in
 * SQLite rather than a second JSON file keeps ~/.contextlab to one queryable
 * file, as ARCHITECTURE.md specifies.
 *
 * @module
 */

/** @typedef {import('better-sqlite3').Database} Db */
/** @typedef {import('@contextlab/core/pricing').PriceTable} PriceTable */

/**
 * Replace the stored price table.
 *
 * All or nothing: a half-written table would price some models and silently
 * zero others.
 *
 * @param {Db} db
 * @param {PriceTable} table
 * @returns {number} models written
 */
export function savePriceTable(db, table) {
  return db.transaction(() => {
    db.prepare('DELETE FROM model_prices').run()

    const insert = db.prepare(`
      INSERT INTO model_prices
        (provider, model_id, input, output, cache_read, cache_write, context, max_output)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let count = 0
    for (const [provider, models] of Object.entries(table.providers ?? {})) {
      for (const [modelId, price] of Object.entries(models)) {
        insert.run(
          provider,
          modelId,
          price.input,
          price.output ?? 0,
          price.cacheRead ?? null,
          price.cacheWrite ?? null,
          price.context ?? null,
          price.maxOutput ?? null,
        )
        count += 1
      }
    }

    db.prepare(`
      INSERT INTO pricing_meta (id, updated_at, source, unit, fetched_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        source     = excluded.source,
        unit       = excluded.unit,
        fetched_at = excluded.fetched_at
    `).run(
      table.updatedAt,
      table.source,
      table.unit ?? 'usd_per_million_tokens',
      Date.now(),
    )

    return count
  })()
}

/**
 * Read the stored price table back, or null if none has been saved.
 *
 * @param {Db} db
 * @returns {PriceTable | null}
 */
export function loadPriceTable(db) {
  const meta = /** @type {any} */ (
    db.prepare('SELECT * FROM pricing_meta WHERE id = 1').get()
  )
  if (!meta) return null

  const rows = /** @type {any[]} */ (db.prepare('SELECT * FROM model_prices').all())

  /** @type {Record<string, Record<string, any>>} */
  const providers = {}
  for (const row of rows) {
    if (!providers[row.provider]) providers[row.provider] = {}
    const table = providers[row.provider]
    if (!table) continue
    table[row.model_id] = {
      input: row.input,
      output: row.output,
      ...(row.cache_read === null ? {} : { cacheRead: row.cache_read }),
      ...(row.cache_write === null ? {} : { cacheWrite: row.cache_write }),
      ...(row.context === null ? {} : { context: row.context }),
      ...(row.max_output === null ? {} : { maxOutput: row.max_output }),
    }
  }

  return {
    updatedAt: meta.updated_at,
    source: meta.source,
    unit: meta.unit,
    providers,
  }
}

/**
 * When the stored table was last refreshed, as epoch ms. Null if never.
 *
 * @param {Db} db
 * @returns {number | null}
 */
export function pricingFetchedAt(db) {
  const row = /** @type {any} */ (
    db.prepare('SELECT fetched_at FROM pricing_meta WHERE id = 1').get()
  )
  return row?.fetched_at ?? null
}
