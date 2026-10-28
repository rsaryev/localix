import { useMemo, type ReactNode } from 'react'
import type { UiSession } from '@/shared/api/contracts'
import { activitySessionGroups } from '../model/sessionGrouping'

/**
 * The chat list: activity sections (Today, Yesterday, ...) over an already scoped, searched and
 * sorted list. The sidebar owns scope, search, selection and actions; this owns only how the
 * chats of that scope are arranged. It never reorders them.
 */
export function ActivitySessionList({
  sessions,
  renderSession,
}: {
  sessions: readonly UiSession[]
  renderSession: (session: UiSession) => ReactNode[]
}) {
  const groups = useMemo(() => activitySessionGroups(sessions), [sessions])

  return (
    <>
      {groups.map((group, index) => (
        <section key={group.id} aria-label={group.label}>
          <div
            className={`px-2 pb-1 text-2xs font-medium text-sidebar-foreground/45 ${index === 0 ? 'pt-1' : 'pt-2'}`}
          >
            {group.label}
          </div>
          <div className="flex flex-col">{group.sessions.flatMap(renderSession)}</div>
        </section>
      ))}
    </>
  )
}
