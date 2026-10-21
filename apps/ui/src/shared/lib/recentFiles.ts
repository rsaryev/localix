// Open a file as a grid tab and keep the per-chat recent-files list for the quick-open palette.
// It lives below the features so the terminal, the inspector and plugins open files the same way.
import { create } from 'zustand'
import { inspector, type OpenFileRequest } from '@/shared/lib/inspectorBus'
import { pushMru } from '@/shared/lib/mru'

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
