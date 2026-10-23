import { useRef } from 'react'
import { SquarePen } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { CMD, useChordHint } from '@/shared/lib/keybindings'

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
export function TitlebarContent({
  app,
}: { app?: { name: string; projectId: string | null; onNewChat: () => void } } = {}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const titlebarWidth = useElementWidth(rowRef)
  const hint = useChordHint()

  // A standalone app (`shared/lib/standaloneApp.ts`): its own project is the root of the path, the
  // conversation crumb is the app's history, and New chat is the one way in to a new one there,
  // since the app has no rail or sidebar.
  if (app) {
    return (
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
        <UnifiedBreadcrumb app={app} />
        <IconButton
          size="sm"
          className="ml-auto shrink-0"
          aria-label="New chat"
          tooltip={hint('New chat', CMD.newChat)}
          tooltipSide="bottom"
          onClick={() => app.onNewChat()}
        >
          <SquarePen />
        </IconButton>
      </div>
    )
  }

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
