/**
 * Copy the built dashboard into this package before it is packed.
 *
 * `pnpm pack` and `pnpm publish` run `prepack`, which runs this. It builds the
 * dashboard and copies `apps/web/dist` to `packages/server/web`, so the
 * published contextlab-server carries the page it serves. The folder is
 * gitignored — a build artefact, not source.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const dist = join(repo, 'apps', 'web', 'dist')
const target = join(here, '..', 'web')

execFileSync('pnpm', ['--filter', '@contextlab/web', 'build'], {
  cwd: repo,
  stdio: 'inherit',
})
if (!existsSync(join(dist, 'index.html'))) {
  throw new Error(`dashboard build produced no ${dist}/index.html`)
}
rmSync(target, { recursive: true, force: true })
cpSync(dist, target, { recursive: true })
console.log(`bundled the dashboard into ${target}`)
