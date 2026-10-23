import type { ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** Shared sticky chrome; providers own only their responsive column grids and labels. */
export function ResourceListHeader({
  gridClassName,
  children,
}: {
  gridClassName: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        gridClassName,
        // No backdrop-blur: at a 95% fill there is nothing left to blur, and the resample cost
        // lands on every scroll frame of the list underneath.
        'lx-occluder sticky top-0 z-(--z-sticky) border-b border-border-soft px-3 py-1 text-2xs font-medium text-text-faint',
      )}
    >
      {children}
    </div>
  )
}
