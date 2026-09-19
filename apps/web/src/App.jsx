/**
 * The shell: a top bar, a route, and a live-connection indicator.
 *
 * The bar is the Gotham reference's: the mark on the left, one entry per view
 * with its icon above its label, and the global controls on the right. It
 * replaced a sidebar, which spent 192px of every screen on four words.
 *
 * @module
 */

import { Activity, Coins, GitCompare, LayoutList, Search, Wrench } from 'lucide-react'
import { useState } from 'react'
import { ExportMenu } from './components/export-menu.jsx'
import { Tooltip } from './components/ui/tooltip.jsx'
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

/**
 * Compare needs a selection, so its entry opens the sessions list with
 * selection mode on rather than an empty compare page.
 */
const NAV = [
  {
    path: '/',
    label: 'Sessions',
    Icon: LayoutList,
    hint: 'Every session, and where the money went',
  },
  { path: '/optimize', label: 'Optimize', Icon: Wrench, hint: 'What to change first' },
  {
    path: '/?select=1',
    label: 'Compare',
    Icon: GitCompare,
    hint: 'Pick two or more sessions to compare',
  },
  {
    path: '/cost',
    label: 'Cost',
    Icon: Coins,
    hint: 'Spend over time and against a budget',
  },
]

export function App() {
  const route = useRoute()
  const { version, connected } = useServerEvents()

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar route={route} connected={connected} />
      <main className="min-w-0 flex-1">
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
  const query = queryOf(route)

  const overview = match('/s/:id', path)
  if (overview) return <SessionOverview sessionId={overview.id} version={version} />

  const messages = match('/s/:id/messages', path)
  if (messages) return <Messages sessionId={messages.id} version={version} />

  const optimize = match('/s/:id/optimize', path)
  if (optimize) return <Optimize sessionId={optimize.id} version={version} />

  if (path === '/compare') return <Compare ids={query.getAll('ids')} version={version} />
  if (path === '/optimize') return <Optimize version={version} />
  if (path === '/cost') return <Cost version={version} />
  return (
    <Sessions
      version={version}
      initialQuery={query.get('q') ?? ''}
      selecting={query.get('select') === '1'}
    />
  )
}

/**
 * Which nav entry a route belongs to.
 *
 * A session's own screens belong to Sessions; a comparison belongs to Compare,
 * whether it was reached by the nav entry or by ticking rows.
 *
 * @param {string} route
 * @returns {string}
 */
export function activeNav(route) {
  const path = pathOf(route)
  if (path === '/compare' || queryOf(route).get('select') === '1') return '/?select=1'
  if (path === '/optimize' || path === '/cost') return path
  return '/'
}

/**
 * @param {{ route: string, connected: boolean }} props
 */
function TopBar({ route, connected }) {
  const active = activeNav(route)

  return (
    <div className="sticky top-0 z-40 flex h-12 min-w-0 shrink-0 items-stretch border-b border-[var(--color-border-subtle)] bg-[var(--color-raised)]">
      <div className="flex items-center px-4">
        <Wordmark compact />
      </div>

      <nav className="ml-2 flex items-stretch gap-2" aria-label="Screens">
        {NAV.map(({ path: to, label, Icon, hint }) => (
          <Tooltip key={to} text={hint} side="bottom">
            <button
              type="button"
              onClick={() => navigate(to)}
              aria-current={active === to ? 'page' : undefined}
              className={cn(
                'flex h-full w-20 flex-col items-center justify-center gap-0.5 border-b-2 text-xs font-semibold transition-colors',
                active === to
                  ? 'border-[var(--color-cat-system-prompt)] text-[var(--color-text-primary)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </button>
          </Tooltip>
        ))}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-2 px-3">
        <GlobalSearch />
        <ExportMenu />
        <Tooltip
          text={
            connected
              ? 'Live — new turns appear as they arrive'
              : 'Not connected to the server'
          }
          side="bottom"
        >
          <span className="flex items-center gap-1.5 px-1 text-xs text-[var(--color-text-muted)]">
            <Activity
              aria-hidden="true"
              className={cn(
                'size-3.5',
                connected
                  ? 'text-[var(--color-status-good)]'
                  : 'text-[var(--color-text-muted)]',
              )}
            />
            {/* Says whether the page is live, so a stale number is never
                mistaken for a current one. */}
            {connected ? 'live' : 'offline'}
          </span>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * Search from anywhere. It lands on the sessions list with the term applied,
 * which is where every search result lives anyway.
 */
function GlobalSearch() {
  const [value, setValue] = useState('')

  return (
    <form
      className="relative min-w-0 flex-1"
      onSubmit={(event) => {
        event.preventDefault()
        const term = value.trim()
        navigate(term ? `/?q=${encodeURIComponent(term)}` : '/')
      }}
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-text-muted)]"
      />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search messages, findings, files…"
        aria-label="Search everything"
        className="h-8 w-full min-w-28 max-w-64 rounded border border-[var(--color-border-subtle)] bg-[var(--color-page)] pl-7 pr-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-cat-system-prompt)] focus:outline-none"
      />
    </form>
  )
}
