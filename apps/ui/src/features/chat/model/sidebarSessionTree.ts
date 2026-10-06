import type { UiSession } from '@/shared/api/contracts'

export const isThreadSession = (session: UiSession) =>
  session.sessionKind === 'system' ||
  (session.sourceToolCallId?.startsWith('message-thread:') ?? false)

export const isWorkerSession = (session: UiSession) =>
  session.sessionKind === 'job' || session.sessionKind === 'subagent'

export interface SidebarSessionChildren {
  forksByParent: Map<string, UiSession[]>
  threadsByParent: Map<string, UiSession[]>
  workersByParent: Map<string, UiSession[]>
}

/** Keep the actual parent; use the owning root only when a worker's parent is unavailable. */
export function sidebarSessionChildren(sessions: UiSession[]): SidebarSessionChildren {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const index: SidebarSessionChildren = {
    forksByParent: new Map(),
    threadsByParent: new Map(),
    workersByParent: new Map(),
  }
  for (const session of sessions) {
    const parent =
      (session.parentSessionId ? byId.get(session.parentSessionId) : undefined) ??
      (isWorkerSession(session) && session.rootSessionId
        ? byId.get(session.rootSessionId)
        : undefined)
    if (!parent || parent.id === session.id) continue
    const map = isWorkerSession(session)
      ? index.workersByParent
      : isThreadSession(session)
        ? index.threadsByParent
        : index.forksByParent
    const siblings = map.get(parent.id) ?? []
    siblings.push(session)
    map.set(parent.id, siblings)
  }
  return index
}

export function sidebarChildren(id: string, index: SidebarSessionChildren): UiSession[] {
  return [
    ...(index.forksByParent.get(id) ?? []),
    ...(index.threadsByParent.get(id) ?? []),
    ...(index.workersByParent.get(id) ?? []),
  ]
}

/** Search every kind of descendant, retaining its ancestors in the filtered roster. */
export function matchesSidebarSession(
  session: UiSession,
  query: string,
  index: SidebarSessionChildren,
): boolean {
  const stack = [session]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.id)) continue
    seen.add(current.id)
    if ((current.title ?? '').toLowerCase().includes(query)) return true
    stack.push(...sidebarChildren(current.id, index))
  }
  return false
}

/** Rendered ancestry includes the fallback root of an orphaned worker. */
export function sidebarSessionPath(id: string | null, index: SidebarSessionChildren): string[] {
  const parents = new Map<string, string>()
  for (const map of [index.forksByParent, index.threadsByParent, index.workersByParent]) {
    for (const [parentId, children] of map) {
      for (const child of children) parents.set(child.id, parentId)
    }
  }
  const path: string[] = []
  const seen = new Set<string>()
  let current = id
  while (current && !seen.has(current)) {
    seen.add(current)
    path.push(current)
    current = parents.get(current) ?? null
  }
  return path.reverse()
}
