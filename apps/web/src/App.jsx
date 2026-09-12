/**
 * The shell: a sidebar, a route, and a live-connection indicator.
 *
 * @module
 */

import { Activity, Coins, ListTree, Wrench } from 'lucide-react'
import { Wordmark } from './components/wordmark.jsx'
import { useServerEvents } from './lib/api.js'
import { match, navigate, pathOf, queryOf, useRoute } from './lib/router.js'
import { cn } from './lib/utils.js'
import { Compare } from './screens/compare.jsx'
import { Cost } from './screens/cost.jsx'
import { Messages } from './screens/messages.jsx'
import { Optimize } from './screens/optimize.jsx'
import { SessionOverview } from './screens/session-overview.jsx'
import { Sessions } from './screens/sessions.jsx'

const NAV = [
  { path: '/', label: 'Sessions', Icon: ListTree },
  { path: '/optimize', label: 'Optimize', Icon: Wrench },
  { path: '/cost', label: 'Cost', Icon: Coins },
]

export function App() {
  const route = useRoute()
  const { version, connected } = useServerEvents()

  return (
    <div className="flex h-full">
      <Sidebar path={pathOf(route)} connected={connected} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Route route={route} version={version} />
      </main>
    </div>
  )
}

/**
 * @param {{ route: string, version: number }} props
 */
export function Route({ route, version }) {
  const path = pathOf(route)

  const overview = match('/s/:id', path)
  if (overview) return <SessionOverview sessionId={overview.id} version={version} />

  const messages = match('/s/:id/messages', path)
  if (messages) return <Messages sessionId={messages.id} version={version} />

  const optimize = match('/s/:id/optimize', path)
  if (optimize) return <Optimize sessionId={optimize.id} version={version} />

  if (path === '/compare') {
    return <Compare ids={queryOf(route).getAll('ids')} version={version} />
  }
  if (path === '/optimize') return <Optimize version={version} />
  if (path === '/cost') return <Cost version={version} />
  return <Sessions version={version} />
}

/**
 * @param {{ path: string, connected: boolean }} props
 */
function Sidebar({ path, connected }) {
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
      <div className="px-3 py-3">
        <Wordmark />
      </div>

      <nav className="flex-1 space-y-px px-2">
        {NAV.map(({ path: to, label, Icon }) => {
          // Compare has no nav entry — it needs a selection, so it is reached
          // from the sessions list. It should still light the item it came
          // from, or the sidebar says you are nowhere.
          const active =
            to === '/'
              ? path === '/' || path.startsWith('/s/') || path === '/compare'
              : path === to
          return (
            <button
              key={to}
              type="button"
              onClick={() => navigate(to)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1 text-sm transition-colors',
                active
                  ? 'bg-[var(--color-gridline)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-gridline)]',
              )}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="flex items-center gap-1.5 px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
        <Activity
          aria-hidden="true"
          className={cn(
            'size-3',
            connected
              ? 'text-[var(--color-status-good)]'
              : 'text-[var(--color-text-muted)]',
          )}
        />
        {/* Says whether the page is live, so a stale number is never mistaken
            for a current one. */}
        {connected ? 'live' : 'not connected'}
      </div>
    </aside>
  )
}
