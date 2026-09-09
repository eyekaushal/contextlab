/**
 * Opening the database.
 *
 * One file, no server, no setup — but with the pragmas a local write-heavy
 * tool actually needs. The proxy writes while the dashboard reads; WAL is what
 * stops those two blocking each other.
 *
 * @module
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations.js'

/** @typedef {import('better-sqlite3').Database} Db */

/**
 * `~/.contextlab/data.db`, unless CONTEXTLAB_HOME says otherwise.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function defaultDbPath(env = process.env) {
  const home = env.CONTEXTLAB_HOME || join(homedir(), '.contextlab')
  return join(home, 'data.db')
}

/**
 * Open (creating if needed), configure, and migrate.
 *
 * @param {string} [path] file path, or ':memory:' for tests
 * @param {{ readonly?: boolean }} [options]
 * @returns {Db}
 */
export function openDatabase(path = defaultDbPath(), options = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const db = new Database(path, { readonly: options.readonly === true })

  // Readers never block the writer and the writer never blocks readers. The
  // dashboard polls while the ingest loop writes, so this is not optional.
  db.pragma('journal_mode = WAL')
  // Durability we can live with: a crash can lose the last transaction, which
  // for captured telemetry is a re-ingest, not data loss.
  db.pragma('synchronous = NORMAL')
  // ON DELETE CASCADE in the schema does nothing without this.
  db.pragma('foreign_keys = ON')
  // Two processes will touch this file. Wait rather than throw SQLITE_BUSY.
  db.pragma('busy_timeout = 5000')

  if (!options.readonly) runMigrations(db)
  return db
}

/**
 * Close cleanly, folding the WAL back into the main file so the database is
 * one portable file again.
 *
 * @param {Db} db
 * @returns {void}
 */
export function closeDatabase(db) {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // A readonly or already-closed handle cannot checkpoint. Not worth failing.
  }
  db.close()
}
