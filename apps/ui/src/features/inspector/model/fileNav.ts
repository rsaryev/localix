// File navigation for the editor grid. Replaces the old inspector-store
// `openFile` + `recentFiles` + active-tab tracking: files now open as grid
// WorkItems (via the inspector bus → useGridInspectorBus), a tiny local store
// keeps the recent-files MRU for the quick-open palette, and the active file is
// derived from the grid's focused group.
import { create } from 'zustand'
import { inspector, type OpenFileRequest } from '@/shared/lib/inspectorBus'
import { pushMru } from '@/shared/lib/mru'
import { useGridStore, focusedFilePath } from '@/features/workspace-grid/model'

const MAX_RECENT = 12
const EMPTY_RECENTS: string[] = []

interface RecentFilesStore {
  recentByScope: Record<string, string[]>
  push: (scope: string, path: string) => void
}

const useRecentFilesStore = create<RecentFilesStore>((set) => ({
  recentByScope: {},
  push: (scope, path) =>
    set((s) => ({
      recentByScope: {
        ...s.recentByScope,
        [scope]: pushMru(s.recentByScope[scope] ?? EMPTY_RECENTS, path, MAX_RECENT),
      },
    })),
}))

/** Open a file in the editor grid and record it in ITS chat's recent-files MRU. Recording it under
 *  the grid's focused scope put a file opened for a background chat in the wrong chat's list. */
export function openFileInGrid(request: OpenFileRequest): void {
  inspector.openFile(request)
  useRecentFilesStore.getState().push(request.sessionId, request.path)
}

/** Recently opened files in this session, most-recent first (quick-open palette). */
export function useRecentFiles(sessionId: string | null): string[] {
  return useRecentFilesStore((s) =>
    sessionId ? (s.recentByScope[sessionId] ?? EMPTY_RECENTS) : EMPTY_RECENTS,
  )
}

/** Path of the file shown in the FOCUSED grid group (file or diff), for the file
 *  tree / symbol palette active-row highlight. Scope-aware: never reports a
 *  background session's file after a switch (see `focusedFilePath`). */
export function useActiveFilePath(): string | null {
  return useGridStore(focusedFilePath)
}
