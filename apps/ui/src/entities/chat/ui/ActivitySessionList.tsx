import { useMemo, type ReactNode, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { UiSession } from '@/shared/api/contracts'
import { activitySessionGroups } from '../model/sessionGrouping'

function GroupLabel({ label, first }: { label: string; first: boolean }) {
  return (
    <div
      className={`px-2 pb-1 text-2xs font-medium text-sidebar-foreground/45 ${first ? 'pt-1' : 'pt-2'}`}
    >
      {label}
    </div>
  )
}

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
          <GroupLabel label={group.label} first={index === 0} />
          <div className="flex flex-col">{group.sessions.flatMap(renderSession)}</div>
        </section>
      ))}
    </>
  )
}

type Line =
  | { kind: 'label'; id: string; label: string; first: boolean }
  | { kind: 'session'; id: string; session: UiSession }

/**
 * The same sections for flat rows that run to thousands (a coding-agent CLI's history): only
 * the rows near the viewport of `scrollRef` are in the DOM, so opening and scrolling cost the
 * same at 2000 sessions as at 200.
 */
export function VirtualActivitySessionList({
  sessions,
  renderSession,
  scrollRef,
}: {
  sessions: readonly UiSession[]
  renderSession: (session: UiSession) => ReactNode
  scrollRef: RefObject<HTMLElement | null>
}) {
  const lines = useMemo(
    () =>
      activitySessionGroups(sessions).flatMap((group, index): Line[] => [
        { kind: 'label', id: `label:${group.id}`, label: group.label, first: index === 0 },
        ...group.sessions.map((session) => ({ kind: 'session' as const, id: session.id, session })),
      ]),
    [sessions],
  )
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual returns non-memoizable functions by design.
  const virtual = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (lines[index]?.kind === 'label' ? 24 : 32),
    getItemKey: (index) => lines[index]?.id ?? index,
    overscan: 8,
    initialRect: { width: 320, height: 640 },
  })
  return (
    <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
      {virtual.getVirtualItems().map((item) => {
        const line = lines[item.index]
        if (!line) return null
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtual.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {line.kind === 'label' ? (
              <GroupLabel label={line.label} first={line.first} />
            ) : (
              renderSession(line.session)
            )}
          </div>
        )
      })}
    </div>
  )
}
