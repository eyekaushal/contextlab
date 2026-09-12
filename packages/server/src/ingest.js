/**
 * Capture file in, database row out.
 *
 * This is where every pure piece finally meets: parse the wire format, count
 * the tokens, correct them against what the provider actually billed, trace the
 * cost to named things, group the turn into a conversation, and store it.
 *
 * The order matters. Composition is estimated first so it exists at all, then
 * rescaled against the response — a turn whose response never arrived still
 * gets an honest estimate rather than nothing.
 *
 * @module
 */

import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  attributeComposition,
  composeRequest,
  computeCost,
  createSessionTracker,
  detectBillingMode,
  filePathFrom,
  findPrice,
  identifyTool,
  mergeSegments,
  parseCapture,
  rescaleToActual,
  resolveBillingMode,
  segmentSystemPrompt,
} from '@contextlab/core'
import { hashText, stableStringify } from '@contextlab/core/prescribe'
import { localDay, recordTurn } from '@contextlab/store'
import { currentPriceTable } from './pricing.js'

/** @typedef {import('better-sqlite3').Database} Db */

/**
 * @typedef {Object} IngestResult
 * @property {'stored' | 'duplicate' | 'skipped'} status
 * @property {string} [sessionId]
 * @property {string} [reason]
 * @property {number} [contextTokens]
 * @property {number} [costUsd]
 */

/**
 * Turn one capture into one stored turn.
 *
 * @param {Db} db
 * @param {Record<string, unknown>} capture
 * @param {{ tracker?: ReturnType<typeof createSessionTracker>,
 *           table?: import('@contextlab/core/pricing').PriceTable,
 *           billingMode?: string }} [options]
 * @returns {IngestResult}
 */
export function ingestCapture(db, capture, options = {}) {
  const parsed = parseCapture(capture)
  if (!parsed.request) {
    return { status: 'skipped', reason: `unparseable ${parsed.apiFormat} request` }
  }

  const request = /** @type {any} */ (capture.request ?? {})
  const response = /** @type {any} */ (capture.response ?? {})

  const tracker = options.tracker ?? createSessionTracker()
  const tool =
    parsed.tool || identifyTool(request.headers ?? {}, systemTextOf(parsed.request)) || ''

  const identity = tracker.identify(
    {
      parsed: parsed.request,
      headers: request.headers ?? {},
      body: request.body ?? {},
      responseBody: typeof response.body === 'object' ? response.body : undefined,
      sessionTag: parsed.sessionTag,
      tool,
    },
    parsed.capturedAt || Date.now(),
  )

  const table = options.table ?? currentPriceTable(db)
  const match = findPrice(parsed.model, { provider: parsed.provider, table })

  // Estimate, then correct. The provider's own count is authoritative, but a
  // turn with no usage still gets a usable estimate rather than a zero.
  const estimated = composeRequest(parsed.request, { model: parsed.model })
  const composition = parsed.usage.found
    ? rescaleToActual(estimated, parsed.usage.totalInputTokens)
    : estimated

  // Header names survive redaction, so a capture still says how the caller
  // authenticated without ever having stored the credential itself.
  const billingMode = resolveBillingMode(
    detectBillingMode(request.headers ?? {}, {
      provider: parsed.provider,
      path: request.path,
    }),
    { mode: options.billingMode },
  )

  const cost = computeCost(parsed.usage, match, {
    billingMode: /** @type {any} */ (billingMode),
  })

  const attribution = attributeComposition(composition, {
    inputPricePerMillion: match?.price.input ?? 0,
  })

  const capturedAt = parsed.capturedAt || Date.now()
  const workingDirectory = identity.workingDirectory ?? null

  return recordTurn(db, {
    session: {
      id: identity.sessionId,
      tool,
      provider: parsed.provider,
      apiFormat: parsed.apiFormat,
      model: parsed.model,
      transport: typeof capture.transport === 'string' ? capture.transport : undefined,
      ...(parsed.sessionTag ? { sessionTag: parsed.sessionTag } : {}),
      ...(workingDirectory ? { projectPath: workingDirectory } : {}),
      ...(workingDirectory ? { projectName: basename(workingDirectory) } : {}),
      ...(match?.price.context ? { contextLimit: match.price.context } : {}),
      ...(identity.fingerprint ? { fingerprint: identity.fingerprint } : {}),
      billingMode,
    },
    turn: {
      id: String(capture.id ?? hashText(JSON.stringify(capture).slice(0, 4096))),
      sessionId: identity.sessionId,
      capturedAt,
      capturedDay: localDay(capturedAt),
      tool,
      provider: parsed.provider,
      apiFormat: parsed.apiFormat,
      model: parsed.model,
      status: typeof response.status === 'number' ? response.status : undefined,
      streaming: response.streaming === true,
      stopReason: parsed.usage.stopReason,
      inputTokens: parsed.usage.inputTokens,
      outputTokens: parsed.usage.outputTokens,
      cacheReadTokens: parsed.usage.cacheReadTokens,
      cacheWriteTokens: parsed.usage.cacheWriteTokens,
      thinkingTokens: parsed.usage.thinkingTokens,
      contextTokens: composition.totalTokens,
      systemTokens: composition.systemTokens,
      toolsTokens: composition.toolsTokens,
      messagesTokens: composition.messagesTokens,
      costUsd: cost.actual,
      equivalentCostUsd: cost.equivalent,
      requestBytes: typeof request.bodyBytes === 'number' ? request.bodyBytes : undefined,
      responseBytes:
        typeof response.bodyBytes === 'number' ? response.bodyBytes : undefined,
    },
    blocks: blocksFor(composition),
    composition: composition.breakdown
      .filter((row) => row.tokens > 0)
      .map((row) => ({
        category: row.category,
        tokens: row.tokens,
        percent: row.percent,
      })),
    systemSegments: systemSegmentsFor(composition),
    attribution: attribution.entries.map((entry) => ({
      entityType: entry.entityType,
      entityName: entry.entityName,
      tokens: entry.tokens,
      costUsd: entry.costUsd,
      calls: entry.calls,
      definitionTokens: entry.definitionTokens,
      callTokens: entry.callTokens,
      resultTokens: entry.resultTokens,
    })),
  }).inserted
    ? {
        status: 'stored',
        sessionId: identity.sessionId,
        contextTokens: composition.totalTokens,
        costUsd: cost.equivalent,
      }
    : { status: 'duplicate', sessionId: identity.sessionId }
}

/**
 * @param {import('@contextlab/core').Composition} composition
 * @returns {any[]}
 */
function blocksFor(composition) {
  /** @type {any[]} */
  const blocks = []

  // A tool result names only the id of the call it answers, so the call has to
  // be remembered as we pass it. Without this the stored result has no tool
  // name and every finding about it says "a tool call".
  /** @type {Map<string, { name: string, filePath: string | null }>} */
  const callsById = new Map()

  composition.messages.forEach((message, messageIndex) => {
    for (const block of message.blocks) {
      if (block.type === 'tool_use' && block.id) {
        callsById.set(block.id, {
          name: block.name ?? '',
          filePath: filePathFrom(block.input),
        })
      }

      // For a call, the arguments are the content. Storing them means two
      // different `Bash` commands hash differently — otherwise every call to a
      // tool collapses into one row and a retry loop is indistinguishable from
      // ordinary use. It also puts commands and file paths into the search index.
      const text =
        block.type === 'tool_use'
          ? stableStringify(block.input)
          : (block.content ?? block.text ?? '')

      const call = block.toolUseId ? callsById.get(block.toolUseId) : undefined
      const toolName = block.name || call?.name || ''
      const filePath =
        block.type === 'tool_use' ? filePathFrom(block.input) : call?.filePath

      blocks.push({
        // Content is deduplicated per session by this hash, which is what makes
        // "re-sent 34 times" a count rather than a scan.
        hash: hashText(`${block.type}\0${toolName}\0${text}`),
        category: block.category,
        messageIndex,
        role: message.role,
        blockType: block.type,
        tokens: block.tokens,
        tokensEstimated: block.tokensEstimated ?? block.tokens,
        chars: block.chars,
        isImage: block.type === 'image',
        text,
        preview: text.slice(0, 200),
        ...(toolName ? { toolName } : {}),
        ...(filePath ? { filePath } : {}),
        ...(block.toolUseId ? { toolUseId: block.toolUseId } : {}),
      })
    }
  })

  return blocks
}

/**
 * @param {import('@contextlab/core').Composition} composition
 * @returns {any[]}
 */
function systemSegmentsFor(composition) {
  /** @type {any[]} */
  const rows = []

  for (const segment of composition.system) {
    const merged = mergeSegments(segmentSystemPrompt(segment.text))
    const totalChars = merged.reduce((sum, piece) => sum + piece.chars, 0)
    for (const piece of merged) {
      rows.push({
        kind: piece.kind,
        label: piece.label,
        tokens:
          totalChars > 0 ? Math.round((piece.chars / totalChars) * segment.tokens) : 0,
        hash: hashText(piece.label),
      })
    }
  }
  return rows
}

/**
 * @param {import('@contextlab/core').ParsedRequest} parsed
 * @returns {string}
 */
function systemTextOf(parsed) {
  return parsed.system.map((segment) => segment.text).join('\n')
}

/**
 * @param {string} path
 * @returns {string}
 */
function basename(path) {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

/**
 * @typedef {Object} DirectoryResult
 * @property {number} stored
 * @property {number} duplicates
 * @property {number} skipped
 * @property {number} failed
 * @property {string[]} sessionIds
 */

/**
 * Ingest every capture file in a directory.
 *
 * Files are deleted only once stored, so a crash mid-run leaves work to redo
 * rather than data lost. Re-ingesting is a no-op on the turn id anyway.
 *
 * @param {Db} db
 * @param {string} dir
 * @param {{ tracker?: ReturnType<typeof createSessionTracker>, keep?: boolean,
 *           onFile?: (name: string, result: IngestResult) => void }} [options]
 * @returns {DirectoryResult}
 */
export function ingestDirectory(db, dir, options = {}) {
  /** @type {DirectoryResult} */
  const totals = { stored: 0, duplicates: 0, skipped: 0, failed: 0, sessionIds: [] }

  /** @type {string[]} */
  let names
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
  } catch {
    return totals
  }

  const tracker = options.tracker ?? createSessionTracker()
  const table = currentPriceTable(db)
  const sessions = new Set()

  for (const name of names) {
    const path = join(dir, name)
    try {
      const capture = JSON.parse(readFileSync(path, 'utf8'))
      const result = ingestCapture(db, capture, { tracker, table })

      if (result.status === 'stored') totals.stored += 1
      else if (result.status === 'duplicate') totals.duplicates += 1
      else totals.skipped += 1

      if (result.sessionId) sessions.add(result.sessionId)
      options.onFile?.(name, result)

      if (!options.keep && result.status !== 'skipped') rmSync(path, { force: true })
    } catch (error) {
      // A malformed capture is worth reporting but must not stop the rest.
      totals.failed += 1
      options.onFile?.(name, { status: 'skipped', reason: String(error) })
    }
  }

  totals.sessionIds = [...sessions]
  return totals
}
