import type { ReactNode } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

/**
 * Paired kit Fields share label, help, control and error tracks. A wrapping description or
 * validation error cannot move one control away from its neighbour. The grid responds to its
 * own width, including the padding of a settings section inside a split pane.
 */
export function SettingsFieldGrid({
  children,
  wideLeading = false,
  columnsAt = 'xl',
}: {
  children: ReactNode
  wideLeading?: boolean
  /** Verbose editor fields stay stacked until the section has room for readable help. */
  columnsAt?: 'xl' | '2xl'
}) {
  return (
    <div className="@container/fields min-w-0">
      <div
        className={cn(
          'grid min-w-0 grid-cols-1 gap-4',
          '[&>[data-slot=field]]:min-w-0',
          columnsAt === 'xl'
            ? '@xl/fields:gap-y-1.5 @xl/fields:[&>[data-slot=field]]:row-span-4 @xl/fields:[&>[data-slot=field]]:grid @xl/fields:[&>[data-slot=field]]:grid-rows-subgrid @xl/fields:[&>[data-slot=field]>[data-slot=field-label]]:row-start-1 @xl/fields:[&>[data-slot=field]>[data-slot=field-description]]:row-start-2 @xl/fields:[&>[data-slot=field]>:not([data-slot^=field-])]:row-start-3 @xl/fields:[&>[data-slot=field]>[data-slot=field-error]]:row-start-4'
            : '@2xl/fields:gap-y-1.5 @2xl/fields:[&>[data-slot=field]]:row-span-4 @2xl/fields:[&>[data-slot=field]]:grid @2xl/fields:[&>[data-slot=field]]:grid-rows-subgrid @2xl/fields:[&>[data-slot=field]>[data-slot=field-label]]:row-start-1 @2xl/fields:[&>[data-slot=field]>[data-slot=field-description]]:row-start-2 @2xl/fields:[&>[data-slot=field]>:not([data-slot^=field-])]:row-start-3 @2xl/fields:[&>[data-slot=field]>[data-slot=field-error]]:row-start-4',
          columnsAt === 'xl'
            ? wideLeading
              ? '@xl/fields:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
              : '@xl/fields:grid-cols-2'
            : wideLeading
              ? '@2xl/fields:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
              : '@2xl/fields:grid-cols-2',
        )}
      >
        {children}
      </div>
    </div>
  )
}
