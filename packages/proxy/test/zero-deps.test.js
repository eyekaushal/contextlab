import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')
const srcDir = join(pkgRoot, 'src')

/**
 * Non-negotiable #4 in CLAUDE.md: this package handles API keys, so it must be
 * readable end to end by a stranger. That claim dies the moment a convenience
 * library gets added. These are the two tests that make the rule enforceable
 * rather than aspirational.
 */
describe('the zero-dependency rule', () => {
  it('declares no dependencies of any kind', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.devDependencies).toBeUndefined()
    expect(pkg.peerDependencies).toBeUndefined()
    expect(pkg.optionalDependencies).toBeUndefined()
  })

  it('imports nothing but node builtins and its own files', () => {
    const offenders = []
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.js'))) {
      const source = readFileSync(join(srcDir, file), 'utf8')
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1] ?? ''
        const allowed = specifier.startsWith('node:') || specifier.startsWith('./')
        if (!allowed) offenders.push(`${file} imports ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
