/**
 * Starting the server, and keeping it fed.
 *
 * Two jobs beyond serving HTTP: fold new capture files into the database as
 * they appear, and refresh pricing in the background. Neither blocks startup.
 *
 * @module
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createSessionTracker } from 'contextlab-core'
import { openDatabase } from 'contextlab-store'
import { createApp } from './app.js'
import { createEventHub } from './events.js'
import { ingestDirectory } from './ingest.js'
import { refreshPricingInBackground } from './pricing.js'

export const DEFAULT_PORT = 4041

/**
 * What :4041 shows when the dashboard has not been built. Plain HTML with the
 * page colour and the one command that fixes it — the API is up and answering,
 * and this says so rather than looking like a crash.
 */
export const NOT_BUILT_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>contextlab</title>
<style>
  html,body{margin:0;background:#1a222c;color:#e6edf3;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
  main{max-width:36rem;margin:18vh auto;padding:0 1.5rem}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{color:#a9b6c3;margin:.5rem 0}
  code{display:block;margin:1rem 0;padding:.75rem 1rem;border:1px solid rgba(255,255,255,.08);
       border-radius:.5rem;background:#222d38;font:13px ui-monospace,Menlo,monospace;color:#3987e5}
  a{color:#3987e5}
</style></head>
<body><main>
  <h1>The API is running. The dashboard is not built.</h1>
  <p>This server serves the dashboard from <code style="display:inline;padding:.1rem .35rem;margin:0">apps/web/dist</code>,
     and that folder does not exist on this machine yet. The API at
     <a href="/api/health">/api/health</a> is answering.</p>
  <p>Build it once, then restart:</p>
  <code>pnpm --filter @contextlab/web build</code>
  <p><small>contextlab dashboard tries to run this build for you when it can. If you are seeing this page,
     it could not — usually because pnpm is not installed on the PATH.</small></p>
</main></body></html>`

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

  // Two places the dashboard can live. In a published package it is copied
  // into this package's own `web/` at pack time, because `apps/web/dist` does
  // not exist inside node_modules — a first publish that looked only there
  // would have shown every user the not-built page. In a checkout it is the
  // Vite output, one level up.
  //
  // When both exist — a checkout that has been packed — the newer one wins.
  // A fixed order served the day-old pack copy over a fresh build, and a
  // theme change that every test had passed was invisible in the browser.
  const candidates = [
    join(here, '..', 'web'),
    join(here, '..', '..', '..', 'apps', 'web', 'dist'),
  ]
    .map((dir) => ({ dir, index: join(dir, 'index.html') }))
    .filter(({ index }) => existsSync(index))
    .sort((a, b) => statSync(b.index).mtimeMs - statSync(a.index).mtimeMs)
  return candidates[0]?.dir ?? null
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
  const { app } = createApp({
    db,
    hub,
    config: options.config ?? {},
    configPath: join(home, 'config.toml'),
  })

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
    // Our own file handler rather than serveStatic. serveStatic resolves its
    // root against the process working directory, and the earlier workaround
    // only covered a root *inside* the cwd — run from /tmp against a package
    // in ~/.npm, it looked for ./Users/... under /tmp, found nothing, and
    // fell through to the API's "served from /" text. That is what the first
    // person to run the published package saw. Absolute paths, read directly.
    app.get('/assets/*', (c) => serveFile(root, c.req.path))
    // A root-level file that exists in the build — the favicon — is sent as
    // itself. Anything else is an app route and gets the page, which the app
    // then routes; a session id with a dot in it must not become a 404.
    // Before this the browser asked for /favicon.svg and was handed
    // index.html under the wrong content type.
    app.get('*', (c) => {
      const direct = extname(c.req.path) ? serveFile(root, c.req.path) : null
      return direct?.status === 200 ? direct : serveFile(root, '/index.html')
    })
  } else {
    // Never a blank page. Someone on a fresh checkout opened :4041, saw
    // nothing, and reasonably concluded the server was broken. It was not;
    // it had chosen silence. Now it says what is missing and what to run.
    app.get('*', (c) => c.html(NOT_BUILT_PAGE, 503))
  }

  const port = options.port ?? DEFAULT_PORT
  // Listen, then wait for the server to say so. The callback form referenced
  // the handle from inside its own initializer; when listen failed
  // synchronously that was a TDZ error on top of the real one. Events do
  // not have that problem: a port in use rejects with EADDRINUSE, cleanly.
  const server = await new Promise((resolve, reject) => {
    const handle = /** @type {any} */ (
      serve({ fetch: app.fetch, port, hostname: options.host ?? '127.0.0.1' })
    )
    handle.once('listening', () => resolve(handle))
    handle.once('error', reject)
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
 * Send one file out of the dashboard build, by absolute path.
 *
 * The path is confined to `root`: anything that resolves outside it — `..`
 * in a request, an encoded slash — is answered 404 rather than read. Assets
 * are content-hashed by Vite, so they may be cached for a year; index.html
 * may not, or a new build would not reach a browser that had the old one.
 *
 * @param {string} root
 * @param {string} requestPath
 * @returns {Response}
 */
function serveFile(root, requestPath) {
  const absolute = resolve(root, `.${decodeURIComponent(requestPath)}`)
  if (!absolute.startsWith(`${resolve(root)}${sep}`) && absolute !== resolve(root)) {
    return new Response('not found', { status: 404 })
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return new Response('not found', { status: 404 })
  }
  const type =
    CONTENT_TYPES[extname(absolute).toLowerCase()] ?? 'application/octet-stream'
  const cache = requestPath.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
  return new Response(readFileSync(absolute), {
    headers: { 'content-type': type, 'cache-control': cache },
  })
}

/**
 * What the dashboard build actually contains. Anything else is a stream.
 * @type {Record<string, string>}
 */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Build the dashboard if it is missing or older than its source.
 *
 * Only possible from a checkout of the repo, where `apps/web` and its
 * devDependencies exist; a published package ships the build already. Returns
 * what happened so the caller can say so, and never throws — a failed build
 * must not stop the API from starting.
 *
 * @param {{ log?: (line: string) => void }} [options]
 * @returns {{ status: 'fresh' | 'built' | 'failed' | 'unavailable', detail: string }}
 */
export function ensureDashboardBuilt(options = {}) {
  const here = dirname(fileURLToPath(import.meta.url))
  const repo = join(here, '..', '..', '..')
  const web = join(repo, 'apps', 'web')
  const index = join(web, 'dist', 'index.html')

  if (!existsSync(join(web, 'package.json'))) {
    return { status: 'unavailable', detail: 'not running from the repository' }
  }

  if (
    existsSync(index) &&
    statSync(index).mtimeMs >= newestSourceMtime(join(web, 'src'))
  ) {
    return { status: 'fresh', detail: 'apps/web/dist is up to date' }
  }

  options.log?.(
    'building the dashboard (apps/web/dist is missing or older than its source)…',
  )
  try {
    execFileSync('pnpm', ['--filter', '@contextlab/web', 'build'], {
      cwd: repo,
      stdio: 'pipe',
      timeout: 120_000,
    })
    return existsSync(index)
      ? { status: 'built', detail: 'built apps/web/dist' }
      : { status: 'failed', detail: 'build ran but produced no dist/index.html' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'failed', detail: message.split('\n')[0] ?? message }
  }
}

/**
 * The newest modification time under a directory, so a stale build is rebuilt
 * and a fresh one is left alone.
 *
 * @param {string} dir
 * @returns {number}
 */
function newestSourceMtime(dir) {
  let newest = 0
  if (!existsSync(dir)) return newest
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, newestSourceMtime(path))
    else newest = Math.max(newest, statSync(path).mtimeMs)
  }
  return newest
}
