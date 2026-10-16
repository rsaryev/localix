import { useMemo, useState, type ReactNode } from 'react'
import type { UiSession } from '@/shared/api/contracts'
import { branchView, toggleBranch } from '../model/branchDisclosure'
import { agentGroups, isConversationGroup } from '../model/sessionGroups'
import { AgentGroupHeader } from './AgentGroupHeader'
import { BranchMoreRow } from './BranchMoreRow'
import { activitySessionGroups, type SessionGroupingMode } from '../model/sessionGrouping'

/**
 * The roster projection: activity sections by default, with an agent-first
 * hierarchy available as an explicit grouping mode.
 *
 * Its own component because it answers a different question from the sidebar around it. The
 * sidebar owns scope, search, selection and the actions; this owns only how the chats of that
 * scope are arranged.
 */

/**
 * A group's chats hang under its heading, with a hairline down the left.
 *
 * Indent alone did not read as containment at this width — the chats sat at the same edge as
 * the heading's chevron and looked like siblings of it. The rail is the same device the
 * session tree already uses for a chat's own forks, so nesting looks like nesting wherever it
 * appears. The inset is the chevron's width and no more: a narrow sidebar cannot spend the
 * heading's full indent on every row and still leave room for a title.
 */
const GROUP_BODY = 'ml-[0.6875rem] flex flex-col gap-0.5 border-l border-sidebar-border/40 pl-2'

function ActivitySections({
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

export function SessionRoster({
  sessions,
  roster,
  groupingMode,
  renderSession,
  onNewChatWith,
}: {
  /** Already scoped, searched and sorted. This component never reorders them. */
  sessions: UiSession[]
  /** Handles of the agents a chat can be with, in the order they should settle when idle. */
  roster: readonly string[]
  /** Activity by default; agent mode adds an identity level above it. */
  groupingMode: SessionGroupingMode
  renderSession: (session: UiSession) => ReactNode[]
  onNewChatWith: (handle: string) => void
}) {
  // Two independent bits of view state, and they are not the same question. `collapsed` is
  // "hide this agent entirely"; `showAll` is "I want the rest of this one's chats". Folding
  // them into one would make expanding a long group also un-collapse every other.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const groups = useMemo(() => agentGroups(sessions, roster), [sessions, roster])

  if (groupingMode === 'activity') {
    return <ActivitySections sessions={sessions} renderSession={renderSession} />
  }

  return (
    <>
      {groups.map((group) => {
        // The same rule every other branch of this list answers to.
        const all = Boolean(showAll[group.handle])
        const view = branchView(group.sessions, {
          collapsed: collapsed[group.handle],
          showAll: all,
        })
        const isOpen = view.open
        const isConversation = isConversationGroup(group.handle)

        return (
          <div key={group.handle} className="flex flex-col">
            <AgentGroupHeader
              handle={group.handle}
              count={group.sessions.length}
              expanded={isOpen}
              onToggle={() => setCollapsed((current) => toggleBranch(current, group.handle))}
              onNewChat={isConversation ? undefined : () => onNewChatWith(group.handle)}
            />
            {isOpen && (
              <div className={GROUP_BODY}>
                {group.sessions.length === 0 &&
                  !isConversation && (
                    // The empty state IS the affordance: a line that says there is nothing here
                    // and starts the thing that would fix it. A placeholder plus a button
                    // somewhere else would be two pieces of chrome for one idea.
                    <button
                      type="button"
                      onClick={() => onNewChatWith(group.handle)}
                      className="focus-ring flex h-8 items-center rounded-lg px-2 text-xs text-sidebar-foreground/35 transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/70"
                    >
                      Start a chat
                    </button>
                  )}
                <ActivitySections sessions={view.shown} renderSession={renderSession} />
                {(view.hidden > 0 || all) && (
                  <BranchMoreRow
                    hidden={view.hidden}
                    showingAll={all}
                    onToggle={() => setShowAll((current) => toggleBranch(current, group.handle))}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
