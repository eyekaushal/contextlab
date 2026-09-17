/**
 * The charts on the sessions dashboard: four rings in one panel, the timeline
 * in another, both between the KPI cards and the table — the reference
 * dashboard's order, summary → shape → detail.
 *
 * @module
 */

import { PieChart, TrendingUp } from 'lucide-react'
import { Donut, SpendTimeline } from './charts.jsx'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.jsx'

/**
 * @param {{ data: any }} props
 */
export function ChartsRow({ data }) {
  if (!data) return null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle icon={PieChart}>Where it went</CardTitle>
          <span className="text-xs text-[var(--color-text-muted)]">all sessions</span>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <Donut
            title="Spend by tool"
            series={data.spendByTool}
            unit="usd"
            colour="name"
          />
          <Donut
            title="Spend by project"
            series={data.spendByProject}
            unit="usd"
            colour="name"
          />
          <Donut
            title="Findings by severity"
            series={data.findingsBySeverity}
            unit="count"
            colour="severity"
            empty="Nothing to fix."
          />
          <Donut
            title="What filled the window"
            series={data.windowByCategory}
            unit="tokens"
            colour="category"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={TrendingUp}>Timeline</CardTitle>
          <span className="text-xs text-[var(--color-text-muted)]">
            last {data.days} days · stacked by tool
          </span>
        </CardHeader>
        <CardContent>
          <SpendTimeline days={data.spendByDay ?? []} />
        </CardContent>
      </Card>
    </>
  )
}
