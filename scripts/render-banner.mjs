/**
 * Render docs/assets/banner.html to banner-dark.png and banner-light.png.
 *
 *   node scripts/render-banner.mjs
 *
 * Uses whatever headless Chrome puppeteer-core can find: set CHROME_PATH to
 * point at one, or let it look in puppeteer's cache. 1600×500 at 2x, so the
 * PNGs are 3200×1000 and stay sharp on a retina screen.
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const page = resolve(here, '..', 'docs', 'assets', 'banner.html')
const out = resolve(here, '..', 'docs', 'assets')

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  const cache = join(homedir(), '.cache', 'puppeteer', 'chrome-headless-shell')
  if (!existsSync(cache)) throw new Error('no Chrome found; set CHROME_PATH')
  const builds = readdirSync(cache).sort()
  const latest = builds[builds.length - 1]
  const dir = join(cache, latest)
  const inner = readdirSync(dir).find((n) => n.startsWith('chrome-headless-shell'))
  return join(dir, inner, 'chrome-headless-shell')
}

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true })
const tab = await browser.newPage()
await tab.setViewport({ width: 1600, height: 500, deviceScaleFactor: 2 })
await tab.goto(pathToFileURL(page).href, { waitUntil: 'load' })
await tab.evaluate(() => document.fonts.ready)

for (const theme of ['dark', 'light']) {
  await tab.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
  const path = join(out, `banner-${theme}.png`)
  await tab.screenshot({ path, type: 'png' })
  console.log('wrote', path)
}
await browser.close()
