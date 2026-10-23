import * as React from 'react'
import { Check } from 'lucide-react'

import { DropdownMenuItem } from '../overlays/dropdown-menu'
import { SELECTED_ROW } from '../lists/selected-row'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { BreadcrumbSelectItem } from './breadcrumb-select'

/**
 * The rows of a {@link BreadcrumbSelect} menu, memoized on `items`.
 *
 * The menu body was built on every render of the segment, open or not — a breadcrumb over a
 * project's sessions is ~200 rows, and its owner re-renders on every streamed frame of a run
 * (measured as the largest single UI cost left in a turn). Radix shows nothing while closed, so
 * the select hands this a list frozen at the moment it closed: the exit animation still has its
 * rows, and every later render is a memo hit instead of a rebuild.
 */
export const BreadcrumbSelectRows = React.memo(function BreadcrumbSelectRows({
  items,
  density,
}: {
  items: readonly BreadcrumbSelectItem[]
  density: 'default' | 'compact'
}) {
  return items.map((item) => (
    <DropdownMenuItem
      key={item.id}
      onSelect={item.onSelect}
      disabled={item.disabled}
      aria-current={item.active ? 'page' : undefined}
      title={[item.label, item.description, item.hint].filter(Boolean).join(' · ')}
      className={cn(
        'min-h-[var(--chrome-control-lg)] text-xs',
        density === 'compact' ? 'h-[var(--chrome-control-lg)] py-0' : item.description && 'py-1.5',
        item.active && SELECTED_ROW,
      )}
    >
      {item.icon ? (
        <span
          className={cn(
            'flex size-3.5 shrink-0 items-center justify-center overflow-hidden opacity-70',
            item.iconClassName,
          )}
        >
          {item.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {item.description && density !== 'compact' ? (
          <span className="mt-0.5 block truncate text-2xs text-text-faint">{item.description}</span>
        ) : null}
      </span>
      {item.hint ? (
        <span className="shrink-0 text-2xs tabular-nums text-text-faint">{item.hint}</span>
      ) : null}
      {item.active ? (
        <Check
          className="size-3.5 shrink-0 text-text-faint"
          strokeWidth={2.25}
          aria-hidden="true"
        />
      ) : null}
    </DropdownMenuItem>
  ))
})
