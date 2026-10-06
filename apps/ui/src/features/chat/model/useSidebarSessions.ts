import { useCallback, useDeferredValue, useMemo } from 'react'

import type { UiSession } from '@/shared/api/contracts'
import { sessionBelongsToScope } from './sessionListHelpers'
import {
  isThreadSession,
  matchesSidebarSession,
  sidebarSessionChildren,
} from './sidebarSessionTree'
export { isThreadSession, isWorkerSession } from './sidebarSessionTree'

export type SortMode = 'recent' | 'title'

export function sortSessionsList(sessions: UiSession[], sortMode: SortMode): UiSession[] {
  return [...sessions].sort((a, b) => {
    if (sortMode === 'title') {
      return (a.title?.trim() || 'Untitled Chat').localeCompare(b.title?.trim() || 'Untitled Chat')
    }
    if (a.isPinned !== b.isPinned) return Number(b.isPinned) - Number(a.isPinned)
    return b.updatedAt - a.updatedAt
  })
}

const isChat = (s: UiSession) => s.sessionKind !== 'subagent' && s.sessionKind !== 'job'

/**
 * Pure scope projection: the ROOT chats (no chat parent) belonging to the active
 * scope (`(projectId ?? null) === activeProjectId`), excluding threads and —
 * unless `showArchived` — archived chats. Shared by the hook and its tests.
 */
export function scopeRootSessions(
  allSessions: UiSession[],
  activeProjectId: string | null,
  showArchived: boolean,
): UiSession[] {
  const byId = new Map(allSessions.map((s) => [s.id, s]))
  return allSessions.filter((session) => {
    if (!isChat(session)) return false
    if (isThreadSession(session)) return false
    if (session.isArchived && !showArchived) return false
    if (!sessionBelongsToScope(session, activeProjectId)) return false
    if (!session.parentSessionId) return true
    const parent = byId.get(session.parentSessionId)
    return !parent
  })
}

export interface SidebarSessionsParams {
  allSessions: UiSession[]
  /** The active workspace scope: a project id, or `null` for Global (project-less). */
  activeProjectId: string | null
  search: string
  sortMode: SortMode
  /** When false (default), soft-archived root chats are hidden from the tree. */
  showArchived: boolean
}

export interface SidebarSessions {
  sessionsById: Map<string, UiSession>
  /** parentId → its direct fork children (chat sessions parented to another chat). */
  forksByParent: Map<string, UiSession[]>
  /** parentId → its direct thread children. */
  threadsByParent: Map<string, UiSession[]>
  /** parentId → its direct worker children, preserving nested delegations. */
  workersByParent: Map<string, UiSession[]>
  /** True if the session or any descendant matches the current search. */
  matchesDeep: (session: UiSession) => boolean
  normalizedSearch: string
  /** Root chats in the ACTIVE scope only, sorted + search-filtered. */
  scopeSessions: UiSession[]
  hasResults: boolean
}

/**
 * Derives the sidebar's sorted/searched session list for the ACTIVE SCOPE
 * (one project, or Global/project-less). A pure projection of its inputs (no
 * view state) — search deferral is owned here. There is no cross-project
 * aggregation: only the chats whose `projectId` matches the active scope are
 * returned; cross-scope discovery is the job of the global message search.
 */
export function useSidebarSessions({
  allSessions,
  activeProjectId,
  search,
  sortMode,
  showArchived,
}: SidebarSessionsParams): SidebarSessions {
  const deferredSearch = useDeferredValue(search)
  const normalizedSearch = deferredSearch.trim().toLowerCase()

  const sessionsById = useMemo(() => new Map(allSessions.map((s) => [s.id, s])), [allSessions])

  const children = useMemo(() => sidebarSessionChildren(allSessions), [allSessions])
  const { forksByParent, threadsByParent, workersByParent } = children

  // Top-level rows = chats with no chat parent, restricted to the ACTIVE SCOPE.
  // A fork (chat parented to another chat) nests under its parent instead; an
  // orphaned fork whose parent was deleted resurfaces here as a root so it's
  // never unreachable.
  const filteredSourceSessions = useMemo(
    () => scopeRootSessions(allSessions, activeProjectId, showArchived),
    [allSessions, activeProjectId, showArchived],
  )

  const matchesDeep = useCallback(
    (session: UiSession) => matchesSidebarSession(session, normalizedSearch, children),
    [normalizedSearch, children],
  )

  const scopeSessions = useMemo(() => {
    const visible = normalizedSearch
      ? filteredSourceSessions.filter(matchesDeep)
      : filteredSourceSessions
    return sortSessionsList(visible, sortMode)
  }, [filteredSourceSessions, normalizedSearch, matchesDeep, sortMode])

  const hasResults = scopeSessions.length > 0

  return {
    sessionsById,
    forksByParent,
    threadsByParent,
    workersByParent,
    matchesDeep,
    normalizedSearch,
    scopeSessions,
    hasResults,
  }
}
