import { useMemo } from 'react'
import type { UiSession } from '@/shared/api/contracts'
import type { BreadcrumbSelectItem } from '@localixai/kit/breadcrumb-select'
import { scopeRootSessions } from './useSidebarSessions'

interface BreadcrumbNavDeps {
  allSessions: UiSession[]
  activeProjectId: string | null
  /** The root chat's id, including when a descendant is open. */
  activeSessionId: string | null
  goToSession: (id: string) => void
}

/** The session crumb offers every root chat in the selected project, across all agents. */
export function sessionCrumbItems({
  allSessions,
  activeProjectId,
  activeSessionId,
  goToSession,
}: BreadcrumbNavDeps): BreadcrumbSelectItem[] {
  return scopeRootSessions(allSessions, activeProjectId, false).map((session) => ({
    id: session.id,
    label: session.title || 'Untitled Chat',
    active: session.id === activeSessionId,
    onSelect: () => goToSession(session.id),
  }))
}

export function useBreadcrumbNav({
  allSessions,
  activeProjectId,
  activeSessionId,
  goToSession,
}: BreadcrumbNavDeps) {
  const sessionItems = useMemo(
    () => sessionCrumbItems({ allSessions, activeProjectId, activeSessionId, goToSession }),
    [allSessions, activeProjectId, activeSessionId, goToSession],
  )
  return { sessionItems }
}
