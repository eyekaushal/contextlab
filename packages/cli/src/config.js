/**
 * Reading `~/.contextlab/config.toml`.
 *
 * Parsing lives in `core`, where it is pure and tested. This is the file I/O
 * half, plus writing the example on first run so the settings are discoverable
 * rather than something you have to read the source to learn about.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONFIG, EXAMPLE_CONFIG, loadConfig } from '@contextlab/core'
import { contextlabHome } from './context.js'

/**
 * @param {string} [home]
 * @returns {string}
 */
export function configPath(home = contextlabHome()) {
  return join(home, 'config.toml')
}

/**
 * @param {string} [home]
 * @returns {import('@contextlab/core/config').Config & { path: string, exists: boolean,
 *           error?: string }}
 */
export function readConfig(home = contextlabHome()) {
  const path = configPath(home)
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG, raw: {}, path, exists: false }
  }

  try {
    return { ...loadConfig(readFileSync(path, 'utf8')), path, exists: true }
  } catch (error) {
    // A broken config must not stop the tool working. Fall back to defaults and
    // say exactly which line is wrong.
    return {
      ...DEFAULT_CONFIG,
      raw: {},
      path,
      exists: true,
      error: String(error instanceof Error ? error.message : error),
    }
  }
}

/**
 * Write the commented example, once, if there is nothing there.
 *
 * @param {string} [home]
 * @returns {boolean} true if it wrote one
 */
export function ensureExampleConfig(home = contextlabHome()) {
  const path = configPath(home)
  if (existsSync(path)) return false
  mkdirSync(home, { recursive: true })
  writeFileSync(path, EXAMPLE_CONFIG, 'utf8')
  return true
}
