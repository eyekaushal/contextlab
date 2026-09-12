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
import { CATEGORIES } from '@contextlab/core/compose'
import { runRules, totalWaste } from '@contextlab/core/prescribe'
import { toOtlp } from '@contextlab/format'
import {
  attributionFor,
  compositionDelta,
  contextTrends,
  costByDay,
  costByProject,
  dismissFinding,
  findRepeatedBlocks,
  getBlock,
  getComposition,
  getSession,
  listBlocksForTurn,
  listDismissals,
  listFilterOptions,
  listFindings,
  listSessions,
  listTurns,
  markDismissed,
  overallSummary,
  replaceFindings,
  restoreFinding,
  searchBlocks,
  searchEntities,
  spendTotals,
  staleFindingSessions,
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

/**
 * How many sessions a comparison may hold.
 *
 * Not a technical limit — a readable one. Past half a dozen columns the table
 * is a spreadsheet, and the question "which of these was worse" stops having an
 * answer you can see.
 */
const MAX_COMPARE = 6

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

  /**
   * Bring the cached findings up to date, for the sessions that need it.
   *
   * The rules are pure and deterministic, so a cache can never disagree with a
   * recomputation — it can only be *older*. Screens that read the cache rather
   * than recomputing (the sessions list, the summary strip) call this first, so
   * a session nobody has opened still reports its findings, and one that has
   * grown since reports the current set rather than a stale one.
   *
   * @param {string[]} [ids]
   * @returns {number} how many sessions were recomputed
   */
  function refreshFindings(ids) {
    const stale = staleFindingSessions(db, ids)
    for (const id of stale) {
      const summary = buildSessionSummary(db, id)
      if (summary) replaceFindings(db, id, runRules(summary))
    }
    return stale.length
  }

  app.get('/api/sessions', (c) => {
    const query = c.req.query()
    const limit = clamp(Number(query.limit ?? 50), 1, 500)
    refreshFindings()

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
        ...(query.sort ? { sort: query.sort } : {}),
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

  /**
   * The sessions screen's summary strip: where the money went, and what is
   * still outstanding.
   *
   * Recoverable and potential come back separately, as everywhere else. The
   * budget block is only present when the user configured one.
   */
  app.get('/api/summary', (c) => {
    refreshFindings()

    const summary = overallSummary(db)
    const budget = config.budget ?? {}
    const spend = spendTotals(db)

    return c.json({
      ...summary,
      budget: hasBudget(budget)
        ? { configured: true, budget, spend, progress: budgetProgress(spend, budget) }
        : { configured: false },
    })
  })

  /**
   * Compare sessions side by side.
   *
   * Session-level only. `docs/DESIGN.md` also promises a turn-level drill-in;
   * that promise moves to a later version rather than being dropped, because
   * the question people actually arrive with is "which of these two was worse,
   * and where" — and that is answered by categories, not by turns.
   *
   * Deltas are not computed here. Which column is the baseline is a decision
   * the reader makes on the screen, and a server that picked one would have to
   * be asked again every time they changed their mind.
   */
  app.get('/api/compare', (c) => {
    const ids = [
      ...new Set(
        c.req
          .queries('ids')
          ?.flatMap((value) => String(value).split(','))
          .map((value) => value.trim())
          .filter(Boolean) ?? [],
      ),
    ].slice(0, MAX_COMPARE)

    if (ids.length < 2) {
      return c.json({ error: 'compare needs at least two sessions' }, 400)
    }

    refreshFindings(ids)

    /** @type {any[]} */
    const columns = []
    /** @type {string[]} */
    const missing = []

    for (const id of ids) {
      const session = getSession(db, id)
      if (!session) {
        missing.push(id)
        continue
      }

      const summary = buildSessionSummary(db, id)
      const findings = markDismissed(
        summary ? runRules(summary) : [],
        id,
        listDismissals(db, id),
      )

      /** @type {Record<string, number>} */
      const categories = {}
      for (const row of /** @type {any[]} */ (getComposition(db, { sessionId: id }))) {
        categories[String(row.category)] = Number(row.tokens) || 0
      }

      columns.push({
        session: toCamel(session),
        categories,
        total: totalWaste(findings, { spendUsd: summary?.totalCostUsd }),
        // The three findings worth naming on a comparison. The full list is one
        // click away on each session's own optimize screen.
        topFindings: findings
          .filter((finding) => !finding.dismissedAt)
          .slice(0, 3)
          .map((finding) => ({
            rule: finding.rule,
            title: finding.title,
            severity: finding.severity,
            claim: finding.claim,
            wastedCostUsd: finding.wastedCostUsd,
          })),
      })
    }

    if (columns.length < 2) {
      return c.json({ error: 'at least two of those sessions could not be read' }, 404)
    }

    // Only the categories that appear somewhere. A row of zeros across every
    // column is noise in a table whose whole purpose is showing difference.
    const categories = CATEGORIES.filter((category) =>
      columns.some((column) => (column.categories[category] ?? 0) > 0),
    )

    return c.json({ columns, categories, ...(missing.length ? { missing } : {}) })
  })

  app.get('/api/filters', (c) => c.json(listFilterOptions(db)))

  /**
   * Search message content *and* the things a session is made of.
   *
   * Two kinds of answer to one question. A reader who types `playwright` means
   * "where is playwright costing me", and the honest answer is usually the MCP
   * server finding rather than a message that happens to contain the word — an
   * MCP server that is never called appears in no message at all.
   *
   * Each result carries its kind so the screen can label it. Nothing is merged
   * into a single ranking: a finding and a line of a log are not comparable,
   * and pretending they are would bury one under the other.
   */
  app.get('/api/search', (c) => {
    const query = c.req.query('q') ?? ''
    const limit = clamp(Number(c.req.query('limit') ?? 50), 1, 200)
    const sessionId = c.req.query('session')

    refreshFindings(sessionId ? [sessionId] : undefined)

    const results = searchBlocks(db, query, {
      limit,
      ...(sessionId ? { sessionId } : {}),
      ...(c.req.query('category') ? { category: c.req.query('category') } : {}),
    })

    const entities = searchEntities(db, query, {
      limit: Math.min(limit, 20),
      ...(sessionId ? { sessionId } : {}),
    })

    return c.json({
      query,
      results: toCamelAll(/** @type {any[]} */ (results)),
      entities: toCamelAll(/** @type {any[]} */ (entities)),
    })
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

    // Recomputed rather than read from the cache. The rules are pure, and the
    // overview showing a different count from optimize for the same session is
    // exactly the bug this route is fixing.
    const summary = buildSessionSummary(db, id)
    const findings = markDismissed(
      summary ? runRules(summary) : [],
      id,
      listDismissals(db, id),
    )

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
      findings,
      // Computed from every finding, not from the handful a screen chooses to
      // render, so the header and the list can never disagree.
      total: totalWaste(findings, {
        spendUsd: Number(session.equivalent_cost_usd) || 0,
      }),
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

    const findings = markDismissed(runRules(summary), id, listDismissals(db, id))
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
      total: totalWaste(findings, { spendUsd: summary.totalCostUsd }),
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

      const findings = markDismissed(runRules(summary), id, listDismissals(db, id))
      replaceFindings(db, id, findings)
      if (findings.length === 0) continue

      reports.push({
        session: toCamel(row),
        total: totalWaste(findings, { spendUsd: summary.totalCostUsd }),
        findings,
      })
    }

    reports.sort((a, b) => b.total.recoverableUsd - a.total.recoverableUsd)

    /** @param {(totals: any) => number} pick */
    const sum = (pick) => reports.reduce((total, report) => total + pick(report.total), 0)

    return c.json({
      scanned: sessions.length,
      // Two figures, never added together: money already spent that a change
      // gives back, and saving available from a change not yet made.
      total: {
        count: sum((t) => t.count),
        critical: sum((t) => t.critical),
        dismissed: sum((t) => t.dismissed),
        recoverableUsd: sum((t) => t.recoverableUsd),
        recoverableTokens: sum((t) => t.recoverableTokens),
        potentialUsd: sum((t) => t.potentialUsd),
        potentialTokens: sum((t) => t.potentialTokens),
        // Summed here rather than in the dashboard, so the figure the header
        // compares against comes from the same place as the ones it compares.
        spentUsd: reports.reduce(
          (total, report) => total + Number(report.session.equivalentCostUsd ?? 0),
          0,
        ),
      },
      reports,
    })
  })

  /**
   * Set a finding aside, or bring it back.
   *
   * Keyed on the rule and the title rather than a row id, because findings are
   * recomputed on every request and their ids do not survive.
   */
  app.post('/api/findings/:action', async (c) => {
    const action = c.req.param('action')
    if (action !== 'dismiss' && action !== 'restore') {
      return c.json({ error: 'expected dismiss or restore' }, 404)
    }

    /** @type {any} */
    let body
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'body must be json' }, 400)
    }

    const { sessionId, rule, title } = body ?? {}
    if (!sessionId || !rule || !title) {
      return c.json({ error: 'sessionId, rule and title are required' }, 400)
    }

    if (action === 'dismiss') dismissFinding(db, sessionId, rule, title)
    else restoreFinding(db, sessionId, rule, title)

    hub.publish({ type: 'session', data: { sessionId } })
    return c.json({ ok: true, action })
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
