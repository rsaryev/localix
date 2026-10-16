import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from './classes'

export type ResultCountStatusProps = Omit<
  ComponentPropsWithoutRef<'span'>,
  'children' | 'role' | 'aria-live' | 'aria-atomic'
> & {
  count: number
  /** Accessible noun used by the default message. */
  singular?: string
  /** Irregular or domain-specific plural; defaults to `${singular}s`. */
  plural?: string
  /** Optional localization/domain formatter without changing the live-region contract. */
  formatCount?: (count: number) => ReactNode
}

/**
 * The shared announcement channel for filtered collections.
 *
 * It intentionally renders beside — never inside — a `role="listbox"`. A listbox may only own
 * options/groups, while the polite atomic status lets screen readers hear a narrowed result set
 * without losing focus in the search field.
 */
export function ResultCountStatus({
  count,
  singular = 'result',
  plural = `${singular}s`,
  formatCount,
  className,
  ...props
}: ResultCountStatusProps) {
  return (
    <span
      data-slot="result-count-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn('sr-only', className)}
      {...props}
    >
      {formatCount?.(count) ?? `${count} ${count === 1 ? singular : plural}`}
    </span>
  )
}
