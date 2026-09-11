#!/usr/bin/env node
/**
 * Write the JSON Schema out as plain JSON.
 *
 * The schema is authored as a JS object so it can carry comments explaining why
 * each field exists. This produces the machine-readable copy for anyone
 * validating with their own tooling.
 *
 *   node scripts/write-schema.mjs
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORMAT_VERSION, SCHEMA } from '../packages/format/src/schema.js'

const here = dirname(fileURLToPath(import.meta.url))
const target = join(
  here,
  '..',
  'packages',
  'format',
  'schema',
  `contextlab-${FORMAT_VERSION}.schema.json`,
)

writeFileSync(target, `${JSON.stringify(SCHEMA, null, 2)}\n`, 'utf8')
console.log(`wrote ${target}`)
