/**
 * Health, as a colour plus an icon plus a word.
 *
 * docs/DESIGN.md is explicit that a status colour never travels alone. Colour
 * carries the signal fastest, but it is not available to every reader, so the
 * label is what actually states the result.
 *
 * @module
 */

import { AlertTriangle, CircleAlert, CircleCheck, OctagonAlert } from 'lucide-react'
import { Badge } from './ui/badge.jsx'

/** @type {Record<string, { tone: any, Icon: any, label: string }>} */
const LEVELS = {
  good: { tone: 'good', Icon: CircleCheck, label: 'Healthy' },
  warning: { tone: 'warning', Icon: AlertTriangle, label: 'Warning' },
  serious: { tone: 'serious', Icon: CircleAlert, label: 'Serious' },
  critical: { tone: 'critical', Icon: OctagonAlert, label: 'Critical' },
}

/**
 * How full is too full. Above 90% a session is one long tool result away from
 * being compacted mid-task.
 *
 * @param {{ contextShare?: number, criticalFindings?: number,
 *           findings?: number }} input
 * @returns {'good' | 'warning' | 'serious' | 'critical'}
 */
export function healthOf({ contextShare = 0, criticalFindings = 0, findings = 0 }) {
  if (contextShare >= 0.9 || criticalFindings >= 2) return 'critical'
  if (contextShare >= 0.8 || criticalFindings >= 1) return 'serious'
  if (findings > 0) return 'warning'
  return 'good'
}

/**
 * @param {{ level: string, label?: string, className?: string }} props
 */
export function Health({ level, label, className }) {
  const { tone, Icon, label: fallback } = LEVELS[level] ?? LEVELS.good
  return (
    <Badge tone={tone} className={className}>
      <Icon aria-hidden="true" className="size-3" />
      {label ?? fallback}
    </Badge>
  )
}

/**
 * @param {{ severity: string, className?: string }} props
 */
export function Severity({ severity, className }) {
  const level =
    severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'good'
  const label =
    severity === 'info' ? 'Info' : severity === 'warning' ? 'Warning' : 'Critical'
  const { tone, Icon } = LEVELS[level] ?? LEVELS.good
  return (
    <Badge tone={severity === 'info' ? 'neutral' : tone} className={className}>
      <Icon aria-hidden="true" className="size-3" />
      {label}
    </Badge>
  )
}
