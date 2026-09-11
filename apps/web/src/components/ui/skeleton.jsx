/**
 * @module
 */

import { cn } from '../../lib/utils.js'

/** @param {any} props */
export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn('animate-pulse rounded bg-[var(--color-gridline)]', className)}
      {...props}
    />
  )
}
