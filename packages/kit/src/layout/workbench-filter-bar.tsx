import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

type WorkbenchFilterBarProps = Omit<ComponentPropsWithoutRef<'div'>, 'aria-label'> & {
  'aria-label': string
  /** Number of cells at full pane width; the final cell may hold a compact action cluster. */
  columns?: 2 | 4
  density?: 'default' | 'compact'
  tone?: 'content' | 'sidebar'
}

/** A pane-sized filter row whose wrapping follows its own width, including embedded sidebars. */
export function WorkbenchFilterBar({
  'aria-label': ariaLabel,
  columns = 2,
  density = 'default',
  tone = 'content',
  className,
  children,
  ...props
}: WorkbenchFilterBarProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="workbench-filter-bar"
      className={cn(
        'lx-workbench-filter-bar min-w-0 shrink-0 border-b',
        tone === 'sidebar' ? 'border-sidebar-border' : 'border-border-soft',
        density === 'compact' ? 'px-2 py-1' : 'px-3 py-2',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'lx-workbench-filter-grid',
          columns === 2 ? 'lx-workbench-filter-grid--two' : 'lx-workbench-filter-grid--four',
        )}
      >
        {children}
      </div>
    </div>
  )
}
