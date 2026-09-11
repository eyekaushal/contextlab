/**
 * The HTTP API on :4041.
 *
 * Thin on purpose: each route reads from `store`, runs a pure function from
 * `core` where one is needed, and serialises. No analysis lives here — if a
 * route starts doing arithmetic, the arithmetic belongs in `core` where it can
 * be tested without a server.
 *
 * This process never sees an API key. That is the proxy's job, and keeping the
 * two apart is the whole reason they are separate processes.
 *
 * @module
 */

import { budgetProgress, evaluateBudget, hasBudget } from '@contextlab/core/budget'
import { runRules, totalWaste } from '@contextlab/core/prescribe'
import { toOtlp } from '@contextlab/format'
import {
  attributionFor,
  compositionDelta,
  contextTrends,
  costByDay,
  costByProject,
  findRepeatedBlocks,
  getBlock,
  getComposition,
  getSession,
  listBlocksForTurn,
  listFilterOptions,
  listFindings,
  listSessions,
  listTurns,
  replaceFindings,
  searchBlocks,
  spendTotals,
  systemSegments,
} from '@contextlab/store'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { createEventHub } from './events.js'
import { buildExport } from './export.js'
import { ingestCapture } from './ingest.js'
import { currentPriceTable } from './pricing.js'
import { toCamel, toCamelAll } from './serialize.js'
import { buildSessionSummary } from './summary.js'

/** @typedef {import('better-sqlite3').Database} Db */
/** @typedef {ReturnType<typeof createEventHub>} EventHub */

/** How often an idle SSE connection gets a keepalive. */
const SSE_PING_MS = 25_000

/**
 * @param {{ db: Db, hub?: EventHub,
 *           config?: { budget?: any, billing?: any } }} options
 * @returns {{ app: Hono, hub: EventHub }}
 */
export function createApp({ db, hub = createEventHub(), config = {} }) {
  const app = new Hono()

  // The dashboard is served from the same origin in production, but runs on
  // Vite's port in development.
  app.use('/api/*', cors({ origin: (origin) => origin ?? '*' }))

  app.get('/api/health', (c) =>
    c.json({ ok: true, service: 'contextlab-server', version: 1 }),
  )

  // -------------------------------------------------------------------------
  // Screen 1 — Sessions
  // -------------------------------------------------------------------------

  app.get('/api/sessions', (c) => {
    const query = c.req.query()
    const limit = clamp(Number(query.limit ?? 50), 1, 500)

    const filters = {
      ...(query.tool ? { tool: query.tool } : {}),
      ...(query.model ? { model: query.model } : {}),
      ...(query.project ? { project: query.project } : {}),
      ...(query.since ? { since: Number(query.since) } : {}),
      ...(query.until ? { until: Number(query.until) } : {}),
    }

    let sessions = /** @type {any[]} */ (
      listSessions(db, {
        ...filters,
        limit: query.q ? 500 : limit,
        offset: Number(query.offset ?? 0),
      })
    )

    /** @type {Record<string, { matches: number, snippet: string }>} */
    const matched = {}

    if (query.q) {
      // Search runs over message content, not session ids. Filters still apply,
      // so "authentication" inside one project stays inside that project.
      const hits = /** @type {any[]} */ (searchBlocks(db, query.q, { limit: 500 }))
      for (const hit of hits) {
        const id = String(hit.session_id)
        const existing = matched[id]
        if (existing) existing.matches += 1
        else matched[id] = { matches: 1, snippet: String(hit.snippet ?? '') }
      }
      sessions = sessions.filter((session) => matched[String(session.id)]).slice(0, limit)
    }

    // One query for every row on screen, not one per row.
    const trends = contextTrends(
      db,
      sessions.map((session) => String(session.id)),
    )

    return c.json({
      sessions: toCamelAll(sessions).map((session) => ({
        ...session,
        trend: trends[String(session.id)] ?? [],
        ...(query.q ? (matched[String(session.id)] ?? { matches: 0, snippet: '' }) : {}),
      })),
      ...(query.q ? { query: query.q } : {}),
    })
  })

  app.get('/api/filters', (c) => c.json(listFilterOptions(db)))

  app.get('/api/search', (c) => {
    const query = c.req.query('q') ?? ''
    const results = searchBlocks(db, query, {
      limit: clamp(Number(c.req.query('limit') ?? 50), 1, 200),
      ...(c.req.query('session') ? { sessionId: c.req.query('session') } : {}),
      ...(c.req.query('category') ? { category: c.req.query('category') } : {}),
    })
    return c.json({ query, results: toCamelAll(/** @type {any[]} */ (results)) })
  })

  // -------------------------------------------------------------------------
  // Screen 2 — Session Overview
  // -------------------------------------------------------------------------

  app.get('/api/sessions/:id', (c) => {
    const id = c.req.param('id')
    const session = /** @type {any} */ (getSession(db, id))
    if (!session) return c.json({ error: 'no such session' }, 404)

    const turns = /** @type {any[]} */ (listTurns(db, id))
    const last = turns[turns.length - 1]

    return c.json({
      session: toCamel(session),
      turns: toCamelAll(turns),
      composition: toCamelAll(
        /** @type {any[]} */ (getComposition(db, { sessionId: id })),
      ),
      // The panel is per-turn, and the latest turn is what the window holds now.
      systemSegments: last
        ? toCamelAll(/** @type {any[]} */ (systemSegments(db, String(last.id))))
        : [],
      attribution: toCamelAll(
        /** @type {any[]} */ (attributionFor(db, id, { limit: 100 })),
      ),
      repeated: toCamelAll(
        /** @type {any[]} */ (findRepeatedBlocks(db, id, { minTurns: 2, limit: 20 })),
      ),
      findings: toCamelAll(/** @type {any[]} */ (listFindings(db, id))),
    })
  })

  app.get('/api/sessions/:id/turns/:turnId', (c) => {
    const id = c.req.param('id')
    const turnId = c.req.param('turnId')
    const turns = /** @type {any[]} */ (listTurns(db, id))
    const index = turns.findIndex((turn) => String(turn.id) === turnId)
    if (index === -1) return c.json({ error: 'no such turn' }, 404)

    const previous = turns[index - 1]
    return c.json({
      turn: toCamel(turns[index]),
      composition: toCamelAll(/** @type {any[]} */ (getComposition(db, { turnId }))),
      systemSegments: toCamelAll(/** @type {any[]} */ (systemSegments(db, turnId))),
      attribution: toCamelAll(
        /** @type {any[]} */ (attributionFor(db, id, { turnId, limit: 100 })),
      ),
      // Only what changed. Two near-identical full bars are unreadable; the
      // delta is the thing a person is actually looking for.
      delta: previous ? compositionDelta(db, turnId, String(previous.id)) : [],
    })
  })

  // -------------------------------------------------------------------------
  // Screen 3 — Messages
  // -------------------------------------------------------------------------

  app.get('/api/sessions/:id/messages', (c) => {
    const id = c.req.param('id')
    const session = /** @type {any} */ (getSession(db, id))
    if (!session) return c.json({ error: 'no such session' }, 404)

    const turns = /** @type {any[]} */ (listTurns(db, id))
    const turnId = c.req.query('turn') ?? String(turns[turns.length - 1]?.id ?? '')
    if (!turnId) return c.json({ turn: null, systemPrompt: null, messages: [] })

    const blocks = /** @type {any[]} */ (listBlocksForTurn(db, turnId))

    // Blocks are flat; the screen shows messages. Group them back up.
    /** @type {Map<number, any>} */
    const messages = new Map()
    for (const block of blocks) {
      const index = Number(block.message_index)
      const message = messages.get(index) ?? {
        index,
        role: block.role,
        tokens: 0,
        blocks: [],
      }
      message.tokens += Number(block.tokens) || 0
      // The full text stays behind /api/blocks/:id. One stuck tool result can
      // be eighty thousand characters, and the list only draws previews.
      const { text, ...rest } = block
      message.blocks.push(toCamel(rest))
      messages.set(index, message)
    }

    const segments = /** @type {any[]} */ (systemSegments(db, turnId))

    return c.json({
      turn: toCamel(turns.find((turn) => String(turn.id) === turnId) ?? null),
      turns: toCamelAll(turns.map((turn) => ({ id: turn.id, seq: turn.seq }))),
      // The system prompt is Turn 0: pinned, expandable, and segmented. It is
      // routinely the largest single block and the prior tool never showed it.
      systemPrompt: {
        tokens: segments.reduce((sum, segment) => sum + (Number(segment.tokens) || 0), 0),
        segments: toCamelAll(segments),
      },
      messages: [...messages.values()].sort((a, b) => a.index - b.index),
    })
  })

  app.get('/api/blocks/:id', (c) => {
    const block = /** @type {any} */ (getBlock(db, c.req.param('id')))
    if (!block) return c.json({ error: 'no such block' }, 404)
    return c.json({ block: toCamel(block) })
  })

  // -------------------------------------------------------------------------
  // Screen 4 — Optimize
  // -------------------------------------------------------------------------

  app.get('/api/sessions/:id/optimize', (c) => {
    const id = c.req.param('id')
    const summary = buildSessionSummary(db, id)
    if (!summary) return c.json({ error: 'no such session' }, 404)

    const findings = runRules(summary)
    // Deterministic, so caching them costs nothing and makes a reload instant.
    replaceFindings(db, id, findings)

    return c.json({
      sessionId: id,
      summary: {
        turnCount: summary.turnCount,
        model: summary.model,
        peakContextTokens: summary.peakContextTokens,
        contextLimit: summary.contextLimit,
        totalCostUsd: summary.totalCostUsd,
      },
      total: totalWaste(findings),
      findings,
    })
  })

  app.get('/api/findings', (c) =>
    c.json({
      findings: toCamelAll(
        /** @type {any[]} */ (
          listFindings(db, undefined, {
            limit: clamp(Number(c.req.query('limit') ?? 50), 1, 200),
          })
        ),
      ).map(reviveEvidence),
    }),
  )

  /**
   * Waste across recent sessions, ranked by money.
   *
   * Rules are deterministic, so running them here rather than reading cached
   * findings means the screen is never stale — and it caches as it goes, so the
   * per-session view is free afterwards.
   */
  app.get('/api/optimize', (c) => {
    const limit = clamp(Number(c.req.query('limit') ?? 10), 1, 50)
    const sessions = /** @type {any[]} */ (listSessions(db, { limit }))

    /** @type {any[]} */
    const reports = []
    for (const row of sessions) {
      const id = String(row.id)
      const summary = buildSessionSummary(db, id)
      if (!summary) continue

      const findings = runRules(summary)
      replaceFindings(db, id, findings)
      if (findings.length === 0) continue

      reports.push({
        session: toCamel(row),
        total: totalWaste(findings),
        findings,
      })
    }

    reports.sort((a, b) => b.total.wastedCostUsd - a.total.wastedCostUsd)

    return c.json({
      scanned: sessions.length,
      total: {
        count: reports.reduce((sum, report) => sum + report.total.count, 0),
        critical: reports.reduce((sum, report) => sum + report.total.critical, 0),
        wastedTokens: reports.reduce((sum, report) => sum + report.total.wastedTokens, 0),
        wastedCostUsd: reports.reduce(
          (sum, report) => sum + report.total.wastedCostUsd,
          0,
        ),
      },
      reports,
    })
  })

  // -------------------------------------------------------------------------
  // Cost
  // -------------------------------------------------------------------------

  app.get('/api/cost', (c) => {
    const by = c.req.query('by') ?? 'day'
    if (by === 'project') {
      return c.json({ by, rows: toCamelAll(/** @type {any[]} */ (costByProject(db))) })
    }
    const rows = costByDay(db, {
      days: clamp(Number(c.req.query('days') ?? 30), 1, 365),
      ...(c.req.query('project') ? { project: c.req.query('project') } : {}),
    })
    return c.json({ by: 'day', rows: toCamelAll(/** @type {any[]} */ (rows)) })
  })

  /**
   * Everything the cost screen needs: spend by day, by project, and how it
   * stands against whatever budgets the user configured.
   */
  app.get('/api/budget', (c) => {
    const budget = config.budget ?? {}
    const spend = spendTotals(db, {
      ...(c.req.query('session') ? { sessionId: c.req.query('session') } : {}),
    })

    return c.json({
      configured: hasBudget(budget),
      budget,
      spend,
      progress: budgetProgress(spend, budget),
      alerts: evaluateBudget(spend, budget),
      billing: config.billing ?? { mode: 'auto' },
    })
  })

  app.get('/api/pricing', (c) => {
    const table = currentPriceTable(db)
    // Stamped so the UI can say "pricing as of", rather than implying the
    // figures are current when they may be a snapshot from install day.
    return c.json({
      updatedAt: table.updatedAt,
      source: table.source,
      unit: table.unit,
      providers: Object.keys(table.providers),
    })
  })

  /**
   * Export, as our format or as OTLP traces.
   *
   * Content defaults to previews: a shared session is somebody's source code
   * and prompts, and every number survives without the text.
   */
  app.get('/api/export', (c) => {
    const content = c.req.query('content') ?? 'preview'
    const document = buildExport(db, {
      ...(c.req.query('session') ? { sessionId: c.req.query('session') } : {}),
      content,
      limit: clamp(Number(c.req.query('limit') ?? 50), 1, 200),
    })

    const otlp = c.req.query('format') === 'otlp'
    const body = otlp ? toOtlp(document) : document
    const stem = c.req.query('session') ? 'session' : 'contextlab'
    const name = otlp ? `${stem}.otlp.json` : `${stem}.ctxlab.json`

    c.header('content-disposition', `attachment; filename="${name}"`)
    return c.json(body)
  })

  // -------------------------------------------------------------------------
  // Ingest — the mitmproxy addon posts captures here
  // -------------------------------------------------------------------------

  app.post('/api/ingest', async (c) => {
    /** @type {unknown} */
    let capture
    try {
      capture = await c.req.json()
    } catch {
      return c.json({ error: 'body must be a capture object' }, 400)
    }

    try {
      const result = ingestCapture(db, /** @type {any} */ (capture))
      if (result.status === 'stored') {
        hub.publish({ type: 'turn', data: { sessionId: result.sessionId } })
      }
      return c.json(result)
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Live updates
  // -------------------------------------------------------------------------

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let open = true
      let id = 0

      const send = async (/** @type {import('./events.js').ServerEvent} */ event) => {
        if (!open) return
        id += 1
        await stream.writeSSE({
          id: String(id),
          event: event.type,
          data: JSON.stringify(event.data ?? {}),
        })
      }

      const unsubscribe = hub.subscribe((event) => {
        void send(event)
      })
      stream.onAbort(() => {
        open = false
        unsubscribe()
      })

      await send({ type: 'ping', data: { connected: true } })

      // Without a periodic write, an idle connection is indistinguishable from
      // a dead one and proxies will close it.
      while (open) {
        await stream.sleep(SSE_PING_MS)
        await send({ type: 'ping', data: {} })
      }
    }),
  )

  app.notFound((c) =>
    c.req.path.startsWith('/api/')
      ? c.json({ error: 'no such endpoint' }, 404)
      : c.text('contextlab server. The dashboard is served from /.', 404),
  )

  return { app, hub }
}

/**
 * Findings read back from the database carry `evidence` as a JSON string, while
 * freshly computed ones carry an object. The client should not have to know
 * which path a finding came down.
 *
 * @param {Record<string, unknown>} finding
 * @returns {Record<string, unknown>}
 */
function reviveEvidence(finding) {
  if (typeof finding.evidence !== 'string') return finding
  try {
    return { ...finding, evidence: JSON.parse(finding.evidence) }
  } catch {
    return { ...finding, evidence: null }
  }
}

/**
 * @param {number} value
 * @param {number} low
 * @param {number} high
 * @returns {number}
 */
function clamp(value, low, high) {
  if (!Number.isFinite(value)) return low
  return Math.min(high, Math.max(low, Math.round(value)))
}
