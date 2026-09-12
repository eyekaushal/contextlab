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
 * @returns {string} the whole route — path and query — always starting with "/"
 */
export function currentRoute() {
  if (typeof window === 'undefined') return '/'
  const hash = window.location.hash.replace(/^#/, '')
  return hash.startsWith('/') ? hash : '/'
}

/**
 * The route without its query string.
 *
 * Compare takes a list of sessions, and a list belongs in a query rather than
 * in a path segment: it varies in length, and the ids inside it contain
 * characters (a colon, in `tag:a1b2c3d4`) that a path segment has to escape.
 *
 * @returns {string}
 */
export function currentPath() {
  return pathOf(currentRoute())
}

/**
 * @param {string} route
 * @returns {string}
 */
export function pathOf(route) {
  const cut = route.indexOf('?')
  return cut < 0 ? route : route.slice(0, cut)
}

/**
 * @param {string} route
 * @returns {URLSearchParams}
 */
export function queryOf(route) {
  const cut = route.indexOf('?')
  return new URLSearchParams(cut < 0 ? '' : route.slice(cut + 1))
}

/**
 * @param {string} route
 * @returns {void}
 */
export function navigate(route) {
  if (typeof window === 'undefined' || currentRoute() === route) return
  window.location.hash = route
}

/**
 * The whole route, query included.
 *
 * Returning only the path would make a move from `/compare?ids=a` to
 * `?ids=a,b` a no-op: `hashchange` fires, the path is unchanged, and setting
 * state to the same string renders nothing.
 *
 * @returns {string}
 */
export function useRoute() {
  const [route, setRoute] = useState(currentRoute)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onChange = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
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
  const actual = pathOf(path).split('/').filter(Boolean)
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
