/**
 * Talking to the server.
 *
 * All requests are origin-relative, so the same code works against Vite's dev
 * proxy and against the built files served from :4041.
 *
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * @param {string} path
 * @param {Record<string, string | number | undefined | null>} [params]
 * @returns {string}
 */
export function url(path, params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
export async function get(path, init) {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  }
  return response.json()
}

/**
 * A write. Same shape as `get`, and just as small.
 *
 * @param {string} path
 * @param {any} body
 * @returns {Promise<any>}
 */
export async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}))
    throw new Error(failure.error ?? `${response.status} ${response.statusText}`)
  }
  return response.json()
}

/**
 * Fetch on mount and whenever the path changes.
 *
 * Deliberately small: no cache, no deduplication, no library. The server is on
 * localhost and every response is a few kilobytes, so a refetch is cheaper than
 * the machinery to avoid one.
 *
 * @param {string | null} path
 * @param {{ refreshKey?: unknown }} [options]
 * @returns {{ data: any, error: string | null, loading: boolean,
 *             reload: () => void }}
 */
export function useApi(path, options = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [loading, setLoading] = useState(Boolean(path))
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  // `nonce` and `refreshKey` are not read inside the effect — they are the
  // signal to run it again, which is how a refetch is requested from outside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional refetch triggers
  useEffect(() => {
    if (!path) {
      setData(null)
      setLoading(false)
      return
    }

    // An in-flight request for a path we have navigated away from must not win
    // a race against the newer one.
    let live = true
    const controller = new AbortController()
    setLoading(true)

    get(path, { signal: controller.signal })
      .then((body) => {
        if (!live) return
        setData(body)
        setError(null)
      })
      .catch((cause) => {
        if (!live || cause.name === 'AbortError') return
        setError(String(cause.message ?? cause))
      })
      .finally(() => {
        if (live) setLoading(false)
      })

    return () => {
      live = false
      controller.abort()
    }
  }, [path, nonce, options.refreshKey])

  return { data, error, loading, reload }
}

/**
 * Subscribe to server events.
 *
 * The stream carries a hint that something changed, not the change itself, so
 * this returns a counter. Screens depend on it to know when to refetch, which
 * keeps one source of truth: the API.
 *
 * @returns {{ version: number, connected: boolean }}
 */
export function useServerEvents() {
  const [version, setVersion] = useState(0)
  const [connected, setConnected] = useState(false)
  const source = useRef(/** @type {EventSource | null} */ (null))

  useEffect(() => {
    const stream = new EventSource('/api/events')
    source.current = stream

    stream.addEventListener('open', () => setConnected(true))
    stream.addEventListener('error', () => setConnected(false))

    const bump = () => setVersion((value) => value + 1)
    stream.addEventListener('turn', bump)
    stream.addEventListener('ingest', bump)
    stream.addEventListener('session', bump)
    stream.addEventListener('ping', () => setConnected(true))

    return () => {
      stream.close()
      source.current = null
    }
  }, [])

  return { version, connected }
}
