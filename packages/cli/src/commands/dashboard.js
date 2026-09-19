/**
 * `contextlab dashboard` — serve the API and the dashboard, and open it.
 *
 * The five analysis commands answer a question and exit. This one stays up,
 * because the dashboard is the thing you leave open on a second monitor while
 * an agent works.
 *
 * @module
 */

import { execFile } from 'node:child_process'
import { ensureDashboardBuilt, startServer, webRoot } from '@contextlab/server'
import { readConfig } from '../config.js'
import { contextlabHome } from '../context.js'
import { color } from '../format.js'

/**
 * @param {{ port?: string, open?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function dashboard(options = {}) {
  const port = Number(options.port ?? 4041)
  const home = contextlabHome()

  // :4041 is the product. It builds the dashboard itself rather than asking
  // someone on a fresh checkout to know a pnpm incantation — and if it cannot,
  // the server shows a page saying so instead of nothing.
  const build = ensureDashboardBuilt({
    log: (line) => console.log(color.gray(`  ${line}`)),
  })
  if (build.status === 'built') console.log(color.gray(`  ${build.detail}`))
  if (build.status === 'failed')
    console.log(color.yellow(`  dashboard build failed: ${build.detail}`))
  const built = webRoot()

  const config = readConfig(home)
  if (config.error) {
    console.error(color.yellow(`\n  config.toml: ${config.error}`))
    console.error(color.gray('  Using defaults for now.'))
  }

  const handle = await startServer({ port, home, config })
  const address = `http://localhost:${port}`

  console.log(`\n  ${color.bold('contextlab')}  ${address}`)
  console.log(color.gray(`  reading ${home}`))

  if (!built) {
    // Honest about it rather than serving a blank page and letting someone
    // wonder whether the server is broken.
    console.log(
      color.yellow(`\n  The dashboard is not built. ${address} explains what to run.`),
    )
    console.log(color.cyan('    pnpm --filter @contextlab/web build'))
  }

  console.log(color.gray('\n  Captures are folded in as they arrive. Ctrl-C to stop.\n'))

  // Opened either way: a page that says "not built, run this" is more useful
  // in a browser than a terminal line nobody reads.
  if (options.open !== false) openInBrowser(address)

  // Stay up until interrupted.
  await new Promise((resolve) => {
    const stop = () => {
      void handle.close().then(resolve)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

/**
 * @param {string} address
 * @returns {void}
 */
function openInBrowser(address) {
  const command =
    process.platform === 'darwin'
      ? ['open', [address]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', address]]
        : ['xdg-open', [address]]

  // Failing to open a browser is not a reason to fail to serve one.
  execFile(/** @type {any} */ (command[0]), /** @type {any} */ (command[1]), () => {})
}
