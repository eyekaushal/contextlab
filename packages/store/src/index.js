/**
 * @contextlab/store — everything in one SQLite file at ~/.contextlab/data.db.
 *
 * The only package that touches the database.
 *
 * @module
 */

export { closeDatabase, defaultDbPath, openDatabase } from './db.js'
export {
  dismissalKey,
  dismissFinding,
  listDismissals,
  markDismissed,
  restoreFinding,
} from './dismissals.js'
export { MIGRATIONS, runMigrations, schemaVersion } from './migrations.js'
export { loadPriceTable, pricingFetchedAt, savePriceTable } from './pricing.js'
export {
  attributionFor,
  compositionDelta,
  contextTrends,
  costByDay,
  costByProject,
  escapeFtsQuery,
  findRepeatedBlocks,
  findRepeatedCalls,
  getBlock,
  getComposition,
  getSession,
  listBlocksForTurn,
  listFilterOptions,
  listFindings,
  listSessions,
  listTurns,
  overallSummary,
  searchBlocks,
  spendTotals,
  staleFindingSessions,
  systemSegments,
} from './read.js'
export { localDay, recordTurn, refreshSessionTotals, replaceFindings } from './write.js'
