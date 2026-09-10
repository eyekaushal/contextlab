/**
 * @contextlab/store — everything in one SQLite file at ~/.contextlab/data.db.
 *
 * The only package that touches the database.
 *
 * @module
 */

export { closeDatabase, defaultDbPath, openDatabase } from './db.js'
export { MIGRATIONS, runMigrations, schemaVersion } from './migrations.js'
export { loadPriceTable, pricingFetchedAt, savePriceTable } from './pricing.js'
export {
  attributionFor,
  costByDay,
  costByProject,
  escapeFtsQuery,
  findRepeatedBlocks,
  findRepeatedCalls,
  getComposition,
  getSession,
  listFindings,
  listSessions,
  listTurns,
  searchBlocks,
  systemSegments,
} from './read.js'
export { localDay, recordTurn, refreshSessionTotals, replaceFindings } from './write.js'
