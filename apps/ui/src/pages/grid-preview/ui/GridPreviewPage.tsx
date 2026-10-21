import { useEffect } from 'react'
import { GridView } from '@/widgets/editor-grid'
import { useGridStore, leaves } from '@/entities/workspace-grid/model'
import { useTheme } from '@/shared/theme/useTheme'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'

/**
 * Dev-only harness for the editor grid (Phase 3). Seeds a couple of WorkItems into
 * an empty grid and renders it standalone so the recursive layout, sash resize,
 * drag-to-split, and keep-alive portals can be exercised before the ChatPage flip.
 */
export function GridPreviewPage() {
  const { resolvedTheme } = useTheme()
  const isMobile = useIsMobile()
  const openItem = useGridStore((s) => s.openItem)

  useEffect(() => {
    const { root } = useGridStore.getState()
    const empty = leaves(root).every((l) => l.tabs.length === 0)
    if (!empty) return
    // App-level kinds only: a terminal belongs to a chat, and this harness has none — the grid
    // refuses a session kind opened without its chat.
    openItem({ kind: 'settings', id: 'settings', title: 'Settings' })
    openItem({ kind: 'stats', id: 'stats', title: 'Usage & Spend' })
  }, [openItem])

  return (
    <div className="flex h-dvh w-full flex-col bg-background">
      <WorkbenchToolbar
        as="header"
        density="compact"
        aria-label="Editor grid preview"
        className="text-2xs tracking-widest text-text-faint"
      >
        EDITOR GRID — DEV PREVIEW
      </WorkbenchToolbar>
      <GridView resolvedTheme={resolvedTheme} isMobile={isMobile} />
    </div>
  )
}
