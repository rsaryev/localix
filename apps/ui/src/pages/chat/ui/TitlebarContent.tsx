import { useRef } from 'react'

import { UnifiedBreadcrumb } from '@/entities/chat/ui/UnifiedBreadcrumb'
import { BreadcrumbTrailingActions } from './BreadcrumbTrailingActions'
import { useElementWidth } from '@localixai/kit/lib'

/**
 * macOS-desktop titlebar chrome. Fills the drag strip next to the traffic lights
 * with the unified navigation breadcrumb (`[Global | project] › session ›
 * subsession …`) — the breadcrumb LIVES here on macOS desktop, replacing the
 * former plain session-title button (the chat header hides its copy; see
 * ChatSurface). Workspace utilities stay in the right-hand quick-access cluster,
 * away from the native window controls.
 *
 * It also owns the one MEASUREMENT this strip's adaptive halves run on. The row's width is the
 * only input neither half can distort: the breadcrumb's column is `minmax(0,1fr)` (it takes the
 * remainder) and the action cluster's is intrinsic (it takes what it asks for), so a cluster that
 * measured itself to decide how many glyphs to show would be reading back its own answer. Measured
 * once, here, and handed down.
 */
export function TitlebarContent() {
  const rowRef = useRef<HTMLDivElement>(null)
  const titlebarWidth = useElementWidth(rowRef)

  return (
    <div
      ref={rowRef}
      data-tauri-drag-region
      className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
    >
      <UnifiedBreadcrumb />
      {/* Workspace quick-access occupies the grid's intrinsic trailing column.
          The breadcrumb's minmax(0,1fr) column absorbs pressure and truncates before
          a deep session › subsession path can crowd these fixed-size actions. */}
      <BreadcrumbTrailingActions titlebarWidth={titlebarWidth} />
    </div>
  )
}
