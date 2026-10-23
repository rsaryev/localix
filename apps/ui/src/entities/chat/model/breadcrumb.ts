import type { UiSession } from '@/shared/api/contracts'
import { buildSessionChain } from '@localixai/mini-app-sdk/ui/session-tree'

/**
 * The UNIFIED top-navigation breadcrumb model — one hierarchy chain replacing the
 * old project tab bar + session tab bar + session-path bar. It reads:
 *
 *   [ scope ] › [ session ] › [ subsession ] › … › [ current ]
 *
 * where the scope is the active project (or Global), the session is the root chat,
 * and each following segment is a sub-session (fork / thread / worker) down to the
 * active one. Each level's dropdown lists the SIBLINGS at that level:
 *   - scope       → other projects + Global (the ProjectSwitcher)
 *   - session     → other root chats in scope (the SessionSwitcher)
 *   - subsession  → sibling forks of that node's parent (inline fork menu)
 *
 * Pure + framework-free so the chain is unit-testable.
 */

export interface ScopeSegment {
  kind: 'scope'
  projectId: string | null
  label: string
}

export interface SessionSegment {
  kind: 'session'
  session: UiSession
}

export interface SubSessionSegment {
  kind: 'subsession'
  session: UiSession
  /** True for the last (active) segment — only it gets the fork / "+" affordance. */
  isCurrent: boolean
  /** The child id that continues the active path (highlighted in that node's menu). */
  activeChildId: string | null
}

export type BreadcrumbSegment = ScopeSegment | SessionSegment | SubSessionSegment

export interface BuildBreadcrumbArgs {
  activeSession: UiSession | null | undefined
  allSessions: UiSession[]
  projects: { id: string; name: string }[]
  activeProjectId: string | null
}

/**
 * Build the ordered breadcrumb segments for the active hierarchy. Always begins
 * with the scope segment; when a session is active it appends the root-chat
 * session segment, then one sub-session segment per ancestry step down to the
 * active session (the last is `isCurrent`). A root chat yields just
 * `scope › session` (no sub-session segments).
 */
export function buildBreadcrumb({
  activeSession,
  allSessions,
  projects,
  activeProjectId,
}: BuildBreadcrumbArgs): BreadcrumbSegment[] {
  const project = projects.find((p) => p.id === activeProjectId) ?? null
  const scope: ScopeSegment = {
    kind: 'scope',
    projectId: activeProjectId ?? null,
    label: project ? project.name : 'Global',
  }

  const chain = buildSessionChain(activeSession, allSessions)
  const segments: BreadcrumbSegment[] = [scope]
  if (chain.length === 0) return segments

  segments.push({ kind: 'session', session: chain[0] })
  for (let i = 1; i < chain.length; i++) {
    segments.push({
      kind: 'subsession',
      session: chain[i],
      isCurrent: i === chain.length - 1,
      activeChildId: chain[i + 1]?.id ?? null,
    })
  }
  return segments
}
