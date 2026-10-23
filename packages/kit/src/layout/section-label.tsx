import type { ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * The small uppercase section heading used above grouped content (filter groups,
 * detail-dialog sections, stats sections…). One source of truth for the
 * `text-2xs uppercase tracking-wider text-text-faint` look — pass `weight`
 * for the slightly heavier variant, and `className` for spacing/layout.
 */
export function SectionLabel({
  children,
  as: Tag = 'div',
  size = '2xs',
  weight = 'medium',
  className,
}: {
  children: ReactNode
  /** Element to render — `span` for inline label columns inside a flex row. */
  as?: 'div' | 'span'
  size?: '2xs' | 'xs'
  weight?: 'medium' | 'semibold'
  className?: string
}) {
  return (
    <Tag
      className={cn(
        'uppercase tracking-wider text-text-faint',
        size === 'xs' ? 'text-xs' : 'text-2xs',
        weight === 'semibold' ? 'font-semibold' : 'font-medium',
        className,
      )}
    >
      {children}
    </Tag>
  )
}
