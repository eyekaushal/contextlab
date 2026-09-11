/**
 * @module
 */

import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names, letting a later Tailwind class win over an earlier one of
 * the same kind. This is what makes a component's `className` prop able to
 * override its own defaults rather than fighting them.
 *
 * @param {...any} inputs
 * @returns {string}
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
