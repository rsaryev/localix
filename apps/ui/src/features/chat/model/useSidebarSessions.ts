import { useCallback, useDeferredValue, useMemo } from 'react'

import type { UiSession } from '@/shared/api/contracts'
import { sessionBelongsToScope } from './sessionListHelpers'

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
/** A thread = a `system` session (a plugin's activity log) or a message-anchored side-chat.
 *  These aggregate under a single "Threads" node instead of cluttering the tree. */
export const isThreadSession = (s: UiSession) =>
  s.sessionKind === 'system' || (s.sourceToolCallId?.startsWith('message-thread:') ?? false)
/** A worker = a delegated task and automation runs. Aggregated
 *  under a single "Workers" node under the chat that owns them. */
export const isWorkerSession = (s: UiSession) =>
  s.sessionKind === 'job' || s.sessionKind === 'subagent'

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
    return !parent || !isChat(parent)
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
  /** parentId → its thread children (task/message threads), aggregated under one node. */
  threadsByParent: Map<string, UiSession[]>
  /** rootChatId → its worker children (delegated task and automation runs), aggregated. */
  workersByParent: Map<string, UiSession[]>
  /** True if the session — or any descendant fork — matches the current search. */
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

  const { forksByParent, threadsByParent, workersByParent } = useMemo(() => {
    const forks = new Map<string, UiSession[]>()
    const threads = new Map<string, UiSession[]>()
    const workers = new Map<string, UiSession[]>()
    const push = (map: Map<string, UiSession[]>, key: string, s: UiSession) => {
      const list = map.get(key) ?? []
      list.push(s)
      map.set(key, list)
    }
    for (const s of allSessions) {
      if (isWorkerSession(s)) {
        // Attach a worker to the nearest owning CHAT (its parent if that's a chat,
        // else the root chat) so all of a chat's runs collect under one node.
        const parent = s.parentSessionId ? sessionsById.get(s.parentSessionId) : undefined
        const host =
          parent && isChat(parent)
            ? parent
            : s.rootSessionId
              ? sessionsById.get(s.rootSessionId)
              : undefined
        if (host && isChat(host)) push(workers, host.id, s)
        continue
      }
      if (!s.parentSessionId) continue
      const parent = sessionsById.get(s.parentSessionId)
      if (!parent || !isChat(parent)) continue
      // Threads aggregate under one disclosure; only real forks tree out inline.
      push(isThreadSession(s) ? threads : forks, s.parentSessionId, s)
    }
    return { forksByParent: forks, threadsByParent: threads, workersByParent: workers }
  }, [allSessions, sessionsById])

  // Top-level rows = chats with no chat parent, restricted to the ACTIVE SCOPE.
  // A fork (chat parented to another chat) nests under its parent instead; an
  // orphaned fork whose parent was deleted resurfaces here as a root so it's
  // never unreachable.
  const filteredSourceSessions = useMemo(
    () => scopeRootSessions(allSessions, activeProjectId, showArchived),
    [allSessions, activeProjectId, showArchived],
  )

  // A session matches search if its title — or any descendant fork's title —
  // matches, so a parent stays visible (and is force-expanded) to reveal the hit.
  // Iterative (stack) traversal so the callback never references itself.
  const matchesDeep = useCallback(
    (session: UiSession): boolean => {
      const stack: UiSession[] = [session]
      const seen = new Set<string>()
      while (stack.length > 0) {
        const current = stack.pop() as UiSession
        if (seen.has(current.id)) continue
        seen.add(current.id)
        if ((current.title || '').toLowerCase().includes(normalizedSearch)) return true
        stack.push(...(forksByParent.get(current.id) ?? []))
      }
      return false
    },
    [normalizedSearch, forksByParent],
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
