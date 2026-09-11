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
import { startServer, webRoot } from '@contextlab/server'
import { contextlabHome } from '../context.js'
import { color } from '../format.js'

/**
 * @param {{ port?: string, open?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function dashboard(options = {}) {
  const port = Number(options.port ?? 4041)
  const home = contextlabHome()
  const built = webRoot()

  const handle = await startServer({ port, home })
  const address = `http://localhost:${port}`

  console.log(`\n  ${color.bold('contextlab')}  ${address}`)
  console.log(color.gray(`  reading ${home}`))

  if (!built) {
    // Honest about it rather than serving a blank page and letting someone
    // wonder whether the server is broken.
    console.log(
      color.yellow('\n  The dashboard has not been built, so only the API is served.'),
    )
    console.log(color.cyan('    pnpm --filter @contextlab/web build'))
  }

  console.log(color.gray('\n  Captures are folded in as they arrive. Ctrl-C to stop.\n'))

  if (options.open !== false && built) openInBrowser(address)

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
