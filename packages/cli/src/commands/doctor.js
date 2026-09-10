/**
 * `contextlab doctor` — check everything before you need it to work.
 *
 * Each check reports pass, warn or fail, and a failure always comes with the
 * command that fixes it. A diagnostic that tells you something is broken
 * without telling you what to do is only half a diagnostic.
 *
 * @module
 */

import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MITM_TOOLS, TOOLS } from '@contextlab/core'
import { SNAPSHOT } from '@contextlab/core/pricing'
import { pricingFetchedAt } from '@contextlab/store'
import { contextlabHome, open } from '../context.js'
import { color, heading, when } from '../format.js'

const MITM_CERT = join(homedir(), '.mitmproxy', 'mitmproxy-ca-cert.pem')

/**
 * @typedef {Object} Check
 * @property {'pass' | 'warn' | 'fail'} status
 * @property {string} label
 * @property {string} [detail]
 * @property {string} [fix]
 */

/**
 * @param {{ json?: boolean }} [options]
 * @returns {Promise<number>} process exit code
 */
export async function doctor(options = {}) {
  /** @type {Check[]} */
  const checks = []

  checks.push(nodeVersion())
  checks.push(await portFree(4040, 'proxy'))
  checks.push(await portFree(4041, 'server'))
  checks.push(storage())
  checks.push(pricing())
  checks.push(...toolsOnPath())
  checks.push(mitmproxy())
  checks.push(mitmCertificate())

  if (options.json) {
    console.log(JSON.stringify(checks, null, 2))
    return checks.some((check) => check.status === 'fail') ? 1 : 0
  }

  console.log(heading('contextlab doctor'))

  for (const check of checks) {
    const mark =
      check.status === 'pass'
        ? color.green('✓')
        : check.status === 'warn'
          ? color.yellow('!')
          : color.red('✗')
    console.log(
      `  ${mark} ${check.label}${check.detail ? color.gray(`  ${check.detail}`) : ''}`,
    )
    if (check.fix) {
      for (const line of check.fix.split('\n')) console.log(`      ${color.cyan(line)}`)
    }
  }

  const failed = checks.filter((check) => check.status === 'fail').length
  const warned = checks.filter((check) => check.status === 'warn').length

  console.log(
    failed > 0
      ? `\n  ${color.red(`${failed} problem${failed === 1 ? '' : 's'}`)} to fix before this will work.\n`
      : warned > 0
        ? `\n  ${color.yellow(`${warned} thing${warned === 1 ? '' : 's'} worth knowing`)}, nothing blocking.\n`
        : `\n  ${color.green('Everything checks out.')}\n`,
  )

  return failed > 0 ? 1 : 0
}

/** @returns {Check} */
function nodeVersion() {
  const major = Number(process.versions.node.split('.')[0])
  const minor = Number(process.versions.node.split('.')[1])
  const ok = major > 20 || (major === 20 && minor >= 9)
  return {
    status: ok ? 'pass' : 'fail',
    label: `Node ${process.versions.node}`,
    ...(ok ? {} : { detail: 'need 20.9 or newer', fix: 'nvm install 22' }),
  }
}

/**
 * @param {number} port
 * @param {string} name
 * @returns {Promise<Check>}
 */
function portFree(port, name) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => {
      resolve({
        // Something is already listening. That is usually contextlab itself,
        // which is fine, so this is a warning rather than a failure.
        status: 'warn',
        label: `Port ${port} (${name})`,
        detail: 'in use',
        fix: `lsof -i :${port}    # check it is contextlab and not something else`,
      })
    })
    server.once('listening', () => {
      server.close(() =>
        resolve({ status: 'pass', label: `Port ${port} (${name})`, detail: 'free' }),
      )
    })
    server.listen(port, '127.0.0.1')
  })
}

/** @returns {Check} */
function storage() {
  const home = contextlabHome()
  const db = join(home, 'data.db')
  if (!existsSync(db)) {
    return {
      status: 'warn',
      label: 'Database',
      detail: 'not created yet',
      fix: 'contextlab claude    # it is created on the first captured turn',
    }
  }
  const size = statSync(db).size
  return {
    status: 'pass',
    label: 'Database',
    detail: `${(size / 1024 / 1024).toFixed(1)}MB at ${db}`,
  }
}

/** @returns {Check} */
function pricing() {
  try {
    const { db } = open({ ingest: false })
    const fetchedAt = pricingFetchedAt(db)
    if (fetchedAt === null) {
      return {
        status: 'pass',
        label: 'Pricing',
        detail: `bundled snapshot, ${SNAPSHOT.updatedAt}`,
      }
    }
    return { status: 'pass', label: 'Pricing', detail: `refreshed ${when(fetchedAt)}` }
  } catch {
    return {
      status: 'pass',
      label: 'Pricing',
      detail: `bundled snapshot, ${SNAPSHOT.updatedAt}`,
    }
  }
}

/** @returns {Check[]} */
function toolsOnPath() {
  /** @type {string[]} */
  const found = []
  for (const [name, config] of Object.entries(TOOLS)) {
    if (!config.command) continue
    if (which(config.command)) found.push(name)
  }

  if (found.length === 0) {
    return [
      {
        status: 'warn',
        label: 'Coding agents',
        detail: 'none found on PATH',
        fix: 'contextlab -- your-command    # works with anything that reads the base-URL env vars',
      },
    ]
  }
  return [{ status: 'pass', label: 'Coding agents', detail: found.join(', ') }]
}

/** @returns {Check} */
function mitmproxy() {
  if (which('mitmdump')) {
    return { status: 'pass', label: 'mitmproxy', detail: 'installed' }
  }
  return {
    status: 'warn',
    label: 'mitmproxy',
    detail: `not installed — needed only for ${MITM_TOOLS.join(', ')}`,
    fix: 'brew install mitmproxy',
  }
}

/** @returns {Check} */
function mitmCertificate() {
  if (!existsSync(MITM_CERT)) {
    return {
      status: 'warn',
      label: 'mitmproxy certificate',
      detail: 'not generated yet',
      fix: 'mitmdump --version    # generates the CA on first run',
    }
  }

  // Codex on macOS uses rustls with the system Keychain and ignores every CA
  // environment variable, so trust has to be checked at the OS level.
  if (process.platform === 'darwin') {
    try {
      execFileSync('security', ['verify-cert', '-c', MITM_CERT], { stdio: 'ignore' })
      return { status: 'pass', label: 'mitmproxy certificate', detail: 'trusted' }
    } catch {
      return {
        status: 'warn',
        label: 'mitmproxy certificate',
        detail: 'not trusted by the system keychain — codex will fail',
        fix:
          'sudo security add-trusted-cert -d -p ssl -k /Library/Keychains/System.keychain \\\n' +
          `  ${MITM_CERT}`,
      }
    }
  }

  return { status: 'pass', label: 'mitmproxy certificate', detail: 'present' }
}

/**
 * @param {string} command
 * @returns {boolean}
 */
function which(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
