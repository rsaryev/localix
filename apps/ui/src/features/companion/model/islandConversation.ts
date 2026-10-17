import { ApiError } from '@/shared/api/failure'

/**
 * Which conversation the island shows, decided without ever getting stuck on a stale id.
 *
 * The island remembers its conversation across launches (view state plus a local fallback). That
 * conversation, or the folder it lived in, can be deleted from the workspace while the island is
 * folded. A remembered id the server no longer has is not an error the person can fix: it is
 * dropped silently and the island lands on a valid conversation instead.
 */
export const isMissingSession = (error: unknown) =>
  error instanceof ApiError && error.code === 'session_not_found'

export const isMissingProject = (error: unknown) =>
  error instanceof ApiError && error.code === 'project_not_found'

export interface IslandConversationPorts<S> {
  /** The session already loaded in this webview, if any. */
  find: (id: string) => S | null | undefined
  fetch: (id: string) => Promise<S>
  /** Find-or-create the conversation a landing shows (server-side empty-draft reuse). */
  land: (projectId: string | null) => Promise<S | null | undefined>
  /** Forget the remembered id everywhere it is stored. */
  forget: (id: string) => void
}

/** Restore the remembered conversation, or land on a valid one when it no longer exists. */
export async function restoreOrLand<S>(
  id: string | null,
  ports: IslandConversationPorts<S>,
): Promise<{ session: S | null | undefined; restored: boolean }> {
  if (id) {
    const cached = ports.find(id)
    if (cached) return { session: cached, restored: true }
    try {
      return { session: await ports.fetch(id), restored: true }
    } catch (error) {
      if (!isMissingSession(error)) throw error
      ports.forget(id)
    }
  }
  return { session: await landIn(null, ports.land), restored: false }
}

/**
 * Start in a folder; a folder that was removed meanwhile falls back to the default project, the
 * same silent recovery the workspace applies to a dead project route.
 */
export async function landIn<S>(
  projectId: string | null,
  create: (projectId: string | null) => Promise<S>,
): Promise<S> {
  try {
    return await create(projectId)
  } catch (error) {
    if (projectId === null || !isMissingProject(error)) throw error
    return create(null)
  }
}

/** The conversation lives in a folder the workspace removed; known only once projects loaded. */
export function inDeadProject(
  projects: readonly { id: string }[] | null,
  projectId: string | null | undefined,
): boolean {
  if (!projectId || !projects) return false
  return !projects.some((project) => project.id === projectId)
}
