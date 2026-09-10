/**
 * What every command needs: a database, the captures directory, and the
 * pending captures folded in before anything is read.
 *
 * @module
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { ingestDirectory } from '@contextlab/server'
import { openDatabase } from '@contextlab/store'

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function contextlabHome(env = process.env) {
  return env.CONTEXTLAB_HOME || join(homedir(), '.contextlab')
}

/**
 * Open the database and ingest anything the proxy has captured since last time.
 *
 * Commands read stored data, and the proxy only writes capture files — so
 * without this step every command would be one session behind. Doing it here
 * means the CLI works with no background service running at all.
 *
 * @param {{ ingest?: boolean }} [options]
 * @returns {{ db: any, ingested: number, home: string }}
 */
export function open(options = {}) {
  const home = contextlabHome()
  const db = openDatabase(join(home, 'data.db'))

  let ingested = 0
  if (options.ingest !== false) {
    const result = ingestDirectory(db, join(home, 'captures'))
    ingested = result.stored
  }

  return { db, ingested, home }
}
