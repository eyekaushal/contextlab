/**
 * A hash router, in forty lines.
 *
 * The dashboard has four screens and one detail route. A routing library would
 * be more code than this, and the hash form has a property that matters here:
 * the built files are served as static assets with no server-side rewrite, so
 * `#/s/abc` cannot 404 the way `/s/abc` would.
 *
 * Back and forward work because that is what `hashchange` is.
 *
 * @module
 */

import { useEffect, useState } from 'react'

/**
 * Reading the location is guarded because this runs during render, and render
 * happens outside a browser in tests. Without the guard the whole app is
 * unrenderable anywhere but a tab, which makes it untestable.
 *
 * @returns {string} the current path, always starting with "/"
 */
export function currentPath() {
  if (typeof window === 'undefined') return '/'
  const hash = window.location.hash.replace(/^#/, '')
  return hash.startsWith('/') ? hash : '/'
}

/**
 * @param {string} path
 * @returns {void}
 */
export function navigate(path) {
  if (typeof window === 'undefined' || currentPath() === path) return
  window.location.hash = path
}

/**
 * @returns {string}
 */
export function useRoute() {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onChange = () => setPath(currentPath())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return path
}

/**
 * Match a path against a pattern with `:name` segments.
 *
 * @param {string} pattern
 * @param {string} path
 * @returns {Record<string, string> | null}
 */
export function match(pattern, path) {
  const expected = pattern.split('/').filter(Boolean)
  const actual = path.split('/').filter(Boolean)
  if (expected.length !== actual.length) return null

  /** @type {Record<string, string>} */
  const params = {}
  for (let i = 0; i < expected.length; i += 1) {
    const part = expected[i] ?? ''
    const value = actual[i] ?? ''
    if (part.startsWith(':')) {
      // Session ids can contain a colon (`tag:a1b2c3d4`), so segments are
      // encoded when linked and decoded here.
      params[part.slice(1)] = decodeURIComponent(value)
      continue
    }
    if (part !== value) return null
  }
  return params
}

/**
 * @param {string[]} segments
 * @returns {string}
 */
export function href(...segments) {
  return `#/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`
}
