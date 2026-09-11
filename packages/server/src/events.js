/**
 * The event hub behind SSE.
 *
 * A plain fan-out: subscribers register a callback, the ingest loop publishes,
 * everyone listening gets it. No queue, no retention, no delivery guarantee —
 * this drives a dashboard that can always re-fetch, so a missed event costs a
 * stale second, not correctness.
 *
 * @module
 */

/**
 * @typedef {Object} ServerEvent
 * @property {'turn' | 'session' | 'ingest' | 'ping'} type
 * @property {Record<string, unknown>} [data]
 */

/**
 * @returns {{ subscribe: (listener: (event: ServerEvent) => void) => () => void,
 *             publish: (event: ServerEvent) => void,
 *             count: () => number }}
 */
export function createEventHub() {
  /** @type {Set<(event: ServerEvent) => void>} */
  const listeners = new Set()

  return {
    /**
     * @param {(event: ServerEvent) => void} listener
     * @returns {() => void} unsubscribe
     */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /**
     * @param {ServerEvent} event
     * @returns {void}
     */
    publish(event) {
      for (const listener of listeners) {
        try {
          listener(event)
        } catch {
          // A browser tab that closed mid-write must not take the loop down
          // with it, nor stop the other subscribers from being notified.
        }
      }
    },

    count: () => listeners.size,
  }
}
