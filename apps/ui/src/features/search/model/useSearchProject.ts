import { useMemo } from 'react'
import { useChatStore } from '@/features/chat/model/store'

export interface SearchProjectOption {
  id: string
  name: string
}

/**
 * The project a search looks in by default, by one rule for the palette and the Search tab
 * alike: the project of the chat the search acts for, else the active project — so the two never
 * search different projects for the same chat. A chat outside any project searches unscoped
 * chats. Also every project, for picking another.
 */
export function useSearchProject(sessionId: string | null): {
  projectId: string | null
  projects: SearchProjectOption[]
} {
  const projectId = useChatStore((s) => {
    const session = sessionId ? s.allSessions.find((row) => row.id === sessionId) : undefined
    return session ? (session.projectId ?? null) : (s.activeProjectId ?? null)
  })
  // The store's own array (a stable reference), shaped once per change: a selector that built new
  // objects on every read would never compare equal and re-render forever.
  const roster = useChatStore((s) => s.projects)
  const projects = useMemo(
    () => roster.map((project) => ({ id: project.id, name: project.name })),
    [roster],
  )
  return { projectId, projects }
}
