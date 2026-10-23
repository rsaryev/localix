import { useCallback, useMemo, useState } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'
import type { UiSession } from '@/shared/api/contracts'
import { useExternalHistory } from '@/features/external-agents/model/useExternalHistory'
import { nativeHistoryRows } from '@/features/external-agents/model/unifiedHistory'
import { sortSessionsList, type SortMode } from '@/entities/chat/model/useSidebarSessions'

/** Which history the sidebar lists: Localix chats, or native coding-agent CLI sessions. */
export type HistorySource = 'localix' | 'external'

export const HISTORY_SOURCE_KEY = 'localix.chatHistorySource'

function readStoredSource(): HistorySource {
  return loadString(HISTORY_SOURCE_KEY) === 'external' ? 'external' : 'localix'
}

/**
 * The sidebar's history tab, remembered per device.
 *
 * External history is scoped to the project's folder, so a project without one has no External
 * tab and always shows Localix chats. Native history is read only while its tab is open.
 */
export function useHistorySource({
  allSessions,
  scopeSessions,
  activeProject,
  search,
  normalizedSearch,
  sortMode,
}: {
  allSessions: readonly UiSession[]
  scopeSessions: UiSession[]
  activeProject: { id: string; workingDir: string } | undefined
  search: string
  normalizedSearch: string
  sortMode: SortMode
}) {
  const [stored, setStored] = useState<HistorySource>(readStoredSource)
  const externalAvailable = Boolean(activeProject?.workingDir)
  const source: HistorySource = externalAvailable ? stored : 'localix'
  const setSource = useCallback((next: HistorySource) => {
    setStored(next)
    saveString(HISTORY_SOURCE_KEY, next)
  }, [])
  const nativeHistory = useExternalHistory(search, externalAvailable && source === 'external', {
    cwd: activeProject?.workingDir,
    includeDescendants: true,
  })
  const nativeRows = useMemo(
    () => nativeHistoryRows(nativeHistory.sessions, allSessions, activeProject),
    [nativeHistory.sessions, allSessions, activeProject],
  )
  const visibleSessions = useMemo(
    () =>
      source === 'external'
        ? sortSessionsList(
            nativeRows.sessions.filter(
              (session) =>
                !normalizedSearch || session.title.toLowerCase().includes(normalizedSearch),
            ),
            sortMode,
          )
        : sortSessionsList(scopeSessions, sortMode),
    [source, scopeSessions, nativeRows.sessions, normalizedSearch, sortMode],
  )
  return { source, setSource, externalAvailable, nativeHistory, nativeRows, visibleSessions }
}
