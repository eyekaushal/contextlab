/**
 * Screen 1 — Sessions.
 *
 * The skeleton version: enough to prove the stack end to end. Search, filters
 * and the full column set arrive with this screen's own block.
 *
 * @module
 */

import { Health, healthOf } from '../components/health.jsx'
import { Empty, Failed, Loading } from '../components/states.jsx'
import { Card } from '../components/ui/card.jsx'
import { url, useApi } from '../lib/api.js'
import { tokens, usd, when } from '../lib/format.js'
import { navigate } from '../lib/router.js'

/**
 * @param {{ version?: number }} props
 */
export function Sessions({ version }) {
  const { data, error, loading } = useApi(url('/api/sessions', { limit: 50 }), {
    refreshKey: version,
  })

  if (error) return <Failed message={error} />
  if (loading && !data)
    return (
      <div className="p-6">
        <Loading />
      </div>
    )

  const sessions = data?.sessions ?? []
  if (sessions.length === 0) {
    return (
      <Empty
        title="No sessions captured yet."
        hint="Run an agent through the proxy and this fills in as it goes."
        command="contextlab claude"
      />
    )
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-lg font-semibold tracking-tight">Sessions</h1>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-2 font-medium">Tool</th>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 text-right font-medium">Turns</th>
              <th className="px-4 py-2 text-right font-medium">Peak context</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
              <th className="px-4 py-2 font-medium">Health</th>
              <th className="px-4 py-2 text-right font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((/** @type {any} */ session) => {
              const share = session.contextLimit
                ? session.peakContextTokens / session.contextLimit
                : 0
              return (
                <tr
                  key={session.id}
                  onClick={() => navigate(`/s/${encodeURIComponent(session.id)}`)}
                  className="cursor-pointer border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-gridline)]"
                >
                  <td className="px-4 py-2">{session.tool || '—'}</td>
                  <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                    {session.model || '—'}
                  </td>
                  <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                    {session.projectName || '—'}
                  </td>
                  <td className="tnum px-4 py-2 text-right">{session.turnCount}</td>
                  <td className="tnum px-4 py-2 text-right">
                    {tokens(session.peakContextTokens)}
                  </td>
                  <td className="tnum px-4 py-2 text-right">
                    {usd(session.equivalentCostUsd)}
                  </td>
                  <td className="px-4 py-2">
                    <Health
                      level={healthOf({
                        contextShare: share,
                        findings: session.findingCount ?? 0,
                      })}
                    />
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--color-text-muted)]">
                    {when(session.lastSeenAt)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
