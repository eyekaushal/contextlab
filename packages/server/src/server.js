/**
 * Starting the server, and keeping it fed.
 *
 * Two jobs beyond serving HTTP: fold new capture files into the database as
 * they appear, and refresh pricing in the background. Neither blocks startup.
 *
 * @module
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSessionTracker } from '@contextlab/core'
import { openDatabase } from '@contextlab/store'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.js'
import { createEventHub } from './events.js'
import { ingestDirectory } from './ingest.js'
import { refreshPricingInBackground } from './pricing.js'

export const DEFAULT_PORT = 4041

/** How often the capture directory is checked for new files. */
const WATCH_MS = 1000

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function contextlabHome(env = process.env) {
  return env.CONTEXTLAB_HOME || join(homedir(), '.contextlab')
}

/**
 * Where the built dashboard lives.
 *
 * Serving it from the same process as the API is what makes the whole product
 * one command and one origin — no CORS in production, no second port to
 * explain, nothing to deploy.
 *
 * @param {string} [override]
 * @returns {string | null}
 */
export function webRoot(override) {
  if (override) return existsSync(override) ? override : null
  const here = dirname(fileURLToPath(import.meta.url))
  const built = join(here, '..', '..', '..', 'apps', 'web', 'dist')
  return existsSync(join(built, 'index.html')) ? built : null
}

/**
 * @typedef {Object} ServerHandle
 * @property {import('node:http').Server} server
 * @property {ReturnType<typeof createEventHub>} hub
 * @property {import('better-sqlite3').Database} db
 * @property {() => Promise<void>} close
 */

/**
 * @param {{ port?: number, host?: string, home?: string, db?: any,
 *           watch?: boolean, refreshPricing?: boolean, web?: string,
 *           config?: { budget?: any, billing?: any } }} [options]
 * @returns {Promise<ServerHandle>}
 */
export async function startServer(options = {}) {
  const home = options.home ?? contextlabHome()
  const db = options.db ?? openDatabase(join(home, 'data.db'))
  const hub = createEventHub()
  const { app } = createApp({ db, hub, config: options.config ?? {} })

  const capturesDir = join(home, 'captures')
  const tracker = createSessionTracker()

  // Fold in anything the proxy captured while we were not running, so the
  // dashboard is correct the moment it loads rather than one poll later.
  if (options.watch !== false && existsSync(capturesDir)) {
    ingestDirectory(db, capturesDir, { tracker })
  }

  const timer =
    options.watch === false
      ? null
      : setInterval(() => {
          try {
            const result = ingestDirectory(db, capturesDir, { tracker })
            if (result.stored > 0) {
              hub.publish({
                type: 'ingest',
                data: { stored: result.stored, sessionIds: result.sessionIds },
              })
            }
          } catch {
            // A transient read error must not kill the watcher; the next tick
            // picks the files up again.
          }
        }, WATCH_MS)

  timer?.unref()

  if (options.refreshPricing !== false) {
    // Deliberately not awaited: a price list is never worth delaying startup.
    refreshPricingInBackground(db)
  }

  // Static assets are mounted after the API routes, so /api never resolves to
  // a file and a missing build simply leaves the API working on its own.
  const root = webRoot(options.web)
  if (root) {
    app.use('/assets/*', serveStatic({ root: relativeTo(root) }))
    app.get('*', serveStatic({ root: relativeTo(root), path: 'index.html' }))
  }

  const port = options.port ?? DEFAULT_PORT
  const server = await new Promise((resolve) => {
    const handle = serve(
      { fetch: app.fetch, port, hostname: options.host ?? '127.0.0.1' },
      () => resolve(handle),
    )
  })

  return {
    server: /** @type {any} */ (server),
    hub,
    db,
    close: async () => {
      if (timer) clearInterval(timer)
      await new Promise((resolve) => /** @type {any} */ (server).close(resolve))
      if (!options.db) db.close()
    },
  }
}

/**
 * serveStatic resolves its root against the process working directory, which
 * is wherever the user happened to run the command from.
 *
 * @param {string} absolute
 * @returns {string}
 */
function relativeTo(absolute) {
  const relative = absolute.startsWith(process.cwd())
    ? absolute.slice(process.cwd().length).replace(/^\//, '')
    : absolute
  return `./${relative}`
}
