import { useCallback } from 'react'
import { useNavigate, useParams } from 'react-router'
import { isSectionId, resolveNavScope, scopePath, type SectionId } from '@/shared/routing/routes'

/**
 * The URL is the single source of truth for navigation. This hook reads the
 * matched route (via react-router's `useParams`) and exposes typed navigators
 * that build hierarchical scope→session URLs through the central `routes.ts`
 * builders. It never mutates the store directly — the store is synced from the
 * URL in ChatPage.
 *
 * Addressing is hierarchical: the project scope is a path segment
 * (`/project/:projectId/...`), so a URL identifies WHERE a chat lives. A null
 * `projectId` is not a scope — it is the index (`/`), which resolves to a real
 * project before anything is addressable.
 *
 * Settings/Stats/mini app views are inspector panels (no URL); they're opened via
 * the inspector store, not this hook.
 */
export interface RoutedNavigation {
  sessionId: string | null
  sectionId: SectionId | null
  projectId: string | null
  goToSession: (id: string, opts?: { project?: string }) => void
  openSection: (id: SectionId | null) => void
  /** Switch the active scope: drops the session so it resolves to the scope's default. */
  switchProject: (id: string) => void
  /** Replace the current entry (used for the index/normalization redirect). */
  goReplace: (path: string) => void
}

export function useRoutedNavigation(): RoutedNavigation {
  const params = useParams()
  const navigate = useNavigate()

  const sessionId = params.sessionId ?? null
  const sectionId = isSectionId(params.section) ? params.section : null
  // Scope from the PATH: /project/:projectId → that id; the index → null.
  const projectId = params.projectId ?? null

  // Commit user navigation URGENTLY. Wrapping this in `startTransition` marked
  // the URL update as low-priority and interruptible, so the steady stream of
  // urgent store updates from active/background sessions (message.delta etc.)
  // kept restarting the transition render — react-router never committed the
  // new `:sessionId`, the URL→store sync in ChatPage never fired, and the view
  // stayed on the previous (sub-)session until a reload forced an urgent commit.
  const go = useCallback((path: string) => void navigate(path), [navigate])
  const goReplace = useCallback(
    (path: string) => void navigate(path, { replace: true }),
    [navigate],
  )

  /**
   * A navigation that needs a scope, from a URL that may not have one yet.
   *
   * Only the index lacks one, and it is one redirect away from a real project. Sending it to
   * `/` re-enters that redirect rather than building an address for a scope that cannot hold a
   * session.
   */
  const inScope = useCallback(
    (scope: string | null, id?: string | null, section?: SectionId | null) =>
      go(scope ? scopePath(scope, id, section) : '/'),
    [go],
  )

  const goToSession = useCallback(
    (id: string, opts?: { project?: string }) =>
      // Preserve the open right-sidebar section (files/jobs) across a session switch. The
      // scope comes from the caller (which knows the session's project) or falls back to
      // the current scope.
      inScope(resolveNavScope(opts?.project, projectId), id, sectionId),
    [inScope, projectId, sectionId],
  )

  const openSection = useCallback(
    (id: SectionId | null) => inScope(projectId, sessionId, id),
    [inScope, projectId, sessionId],
  )

  const switchProject = useCallback((id: string) => go(scopePath(id)), [go])

  return {
    sessionId,
    sectionId,
    projectId,
    goToSession,
    openSection,
    switchProject,
    goReplace,
  }
}
