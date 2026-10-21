import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useChatStore } from '@/entities/chat/model/store'
import { useActiveSessionSummary, useSessionRoster } from '@/entities/chat/model/useSessionRoster'
import { buildBreadcrumb } from '@/entities/chat/model/breadcrumb'

/**
 * How many crumbs the navigation trail is drawing — the one fact the titlebar's OTHER half needs.
 *
 * The contributed status strip and the breadcrumb share one row, and the strip has to know how
 * much of it to leave alone. It cannot ask the trail how wide it is: the trail's column is
 * `minmax(0,1fr)`, so its width is whatever the strip did not take, and sizing on that would be
 * reading back its own answer one frame late. Depth is upstream of both — it comes from the
 * session tree, not from the layout — which is what makes it a legitimate input.
 *
 * Every ancestor remains in the scrollable path. Its full depth lets the strip reserve a
 * readable navigation area before allocating space to contributed status items.
 */
export function useBreadcrumbDepth(): number {
  const { activeProjectId, projects } = useChatStore(
    useShallow((s) => ({
      activeProjectId: s.activeProjectId,
      projects: s.projects,
    })),
  )
  const allSessions = useSessionRoster()
  const activeSession = useActiveSessionSummary()

  return useMemo(() => {
    const segments = buildBreadcrumb({ activeSession, allSessions, projects, activeProjectId })
    return segments.length
  }, [activeSession, allSessions, projects, activeProjectId])
}
