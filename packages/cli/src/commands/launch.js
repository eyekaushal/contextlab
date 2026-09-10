/**
 * `contextlab <tool>` — the whole install story.
 *
 * Starts the proxy, works out which environment variables the tool honours,
 * spawns it with those set, and folds the captures into the database when it
 * exits. No SDK, no config file, no code change in the tool.
 *
 * @module
 */

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { buildToolEnv, resolveTool } from '@contextlab/core'
import { DEFAULT_PORT, startProxy } from '@contextlab/proxy'
import { ingestDirectory } from '@contextlab/server'
import { openDatabase } from '@contextlab/store'
import { contextlabHome } from '../context.js'
import { color, tokens, usd } from '../format.js'

/**
 * @param {string} name
 * @param {string[]} args
 * @param {{ port?: string }} [options]
 * @returns {Promise<number>}
 */
export async function launch(name, args, options = {}) {
  const port = Number(options.port ?? DEFAULT_PORT)
  const home = contextlabHome()
  const capturesDir = join(home, 'captures')

  // A per-run tag so two agents running at once stay in separate sessions.
  const sessionTag = randomBytes(4).toString('hex')
  const launchConfig = buildToolEnv(name, `http://localhost:${port}`, sessionTag)
  const { config } = resolveTool(name)

  if (launchConfig.needsMitm) {
    console.error(
      `\n${color.yellow(`${launchConfig.label} cannot be redirected with an environment variable.`)}`,
    )
    console.error(color.gray(`  ${launchConfig.reason}`))
    console.error(color.gray('\n  It needs the mitmproxy transport:'))
    console.error(color.cyan('    brew install mitmproxy'))
    console.error(color.gray('  then run contextlab doctor to check the certificate.\n'))
    return 1
  }

  let captured = 0
  let contextTokens = 0

  const proxy = await startProxy({
    port,
    dir: capturesDir,
    env: { ...process.env, ...launchConfig.serverEnv },
    onEvent: (event) => {
      if (event.type === 'capture') captured += 1
      if (event.type === 'error') console.error(color.gray(`  proxy: ${event.message}`))
    },
  })

  const command = config.command || name
  console.error(
    color.gray(
      `contextlab  proxy on :${port}  capturing ${launchConfig.label}  (${Object.keys(launchConfig.env).join(', ')})\n`,
    ),
  )

  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...launchConfig.env },
  })

  const code = await new Promise((resolve) => {
    child.on('error', (error) => {
      console.error(`\n${color.red(`Could not start ${command}`)}: ${error.message}`)
      resolve(127)
    })
    child.on('exit', (exitCode) => resolve(exitCode ?? 0))
  })

  await new Promise((resolve) => proxy.close(() => resolve(null)))

  if (captured === 0) {
    console.error(
      color.gray(
        '\ncontextlab  nothing captured. If the tool ignored the base URL, it may need mitmproxy.\n',
      ),
    )
    return code
  }

  // Fold the captures in now, so `contextlab why` works the moment this exits.
  const db = openDatabase(join(home, 'data.db'))
  const result = ingestDirectory(db, capturesDir)
  const totals = /** @type {any} */ (
    db
      .prepare(
        'SELECT SUM(equivalent_cost_usd) AS cost, MAX(context_tokens) AS peak FROM turns WHERE session_id IN (SELECT value FROM json_each(?))',
      )
      .get(JSON.stringify(result.sessionIds))
  )
  contextTokens = Number(totals?.peak) || 0
  db.close()

  console.error(
    color.gray(
      `\ncontextlab  ${result.stored} turns · ${tokens(contextTokens)} peak context · ${usd(Number(totals?.cost) || 0)}` +
        `\n            contextlab why   ·   contextlab optimize\n`,
    ),
  )

  return code
}
