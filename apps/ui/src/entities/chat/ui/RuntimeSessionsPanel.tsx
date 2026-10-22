import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpLeft } from 'lucide-react'

import { Spinner } from '@localixai/kit/spinner'
import { CollapsibleStrip } from '@localixai/kit/collapsible-strip'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { backendClient } from '@/shared/api/client'
import { sessionRef, type UiSession } from '@/shared/api/contracts'
import { useChatStore } from '@/entities/chat/model/store'
import { useSubagentRows } from '@/entities/chat/model/useSubagentRows'
import { useSessionActivity } from '@localixai/plugin-sdk/ui/session-activity'
import { buildRuntimeSessionTree } from './runtimeSessionTree'
import { kindStyle, titleFor } from './runtimeSessionMeta'
import { RuntimeSessionRow } from './runtimeSessionRowParts'

interface RuntimeSessionsPanelProps {
  scopeRootId: string | null
  activeSessionId: string | null
  /**
   * Open a runtime row. ONE unified routing helper for every kind of row — it
   * reveals the live PTY for a background bash job and otherwise navigates into
   * the session. This is deliberately the only click handler: an earlier "jobs
   * open a terminal" branch sent delegated run/review rows (whose
   * `sourceToolCallId` names their dispatcher, with no backing PTY) to a terminal
   * lookup that silently no-op'd, so those rows looked unclickable. Every row now
   * resolves through the same fallback.
   */
  onSelect: (id: string) => void | Promise<void>
}

/** Resolve the explicit one-level-up action shown while browsing a child session. */
export function parentSessionForActive(
  sessions: readonly UiSession[],
  activeSessionId: string | null,
): UiSession | undefined {
  if (!activeSessionId) return undefined
  const parentId = sessions.find((session) => session.id === activeSessionId)?.parentSessionId
  return parentId ? sessions.find((session) => session.id === parentId) : undefined
}

function parentTitleFor(session: UiSession): string {
  return session.title?.trim() || (session.seq ? sessionRef(session.seq) : 'Untitled session')
}

export function runtimeSessionsForScope(
  sessions: readonly UiSession[],
  scopeRootId: string | null,
): UiSession[] {
  return sessions.filter((session) => {
    if (session.sessionKind !== 'subagent' && session.sessionKind !== 'job') return false
    if (!scopeRootId) return session.runtimeStatus === 'running'
    return session.rootSessionId === scopeRootId || session.parentSessionId === scopeRootId
  })
}

/**
 * The collapsed strip's summary line. Its own component for ONE reason: it reads the head
 * session's live "doing now" label, and reading that in the panel body would re-render every row
 * on every tick of the head — the exact whole-list re-render the external tick store exists to
 * end (see model/sessionActivityStore.ts).
 */
function RuntimeHeadSummary({ session, running }: { session: UiSession; running: boolean }) {
  const { activity } = useSessionActivity(session.id)
  return <>{running && activity ? `${titleFor(session)} · ${activity}` : titleFor(session)}</>
}

function RuntimeSessionsPanelComponent({
  scopeRootId,
  activeSessionId,
  onSelect,
}: RuntimeSessionsPanelProps) {
  const sessions = useChatStore(
    useShallow((state) => runtimeSessionsForScope(state.allSessions, scopeRootId)),
  )
  const parentSession = useChatStore((state) =>
    parentSessionForActive(state.allSessions, activeSessionId),
  )
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [stoppedIds, setStoppedIds] = useState<Set<string>>(() => new Set())
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const toggleBranch = useCallback((id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // Read inside the stable `stopRuntime` callback so "a stop is already in flight" does not have
  // to be a dependency (which would re-identify the callback and re-render every memoized row).
  const stoppingIdRef = useRef(stoppingId)
  stoppingIdRef.current = stoppingId

  // Invalidate the local "stopped" override once a session is reported running
  // again — a stopped session can be restarted (e.g. a backend wake/continuation)
  // and must not render as stopped forever. Done as an "adjust state during
  // render" sync against the latest sessions rather than in an effect.
  if (stoppedIds.size > 0) {
    let pruned: Set<string> | null = null
    for (const session of sessions) {
      if (session.runtimeStatus === 'running' && stoppedIds.has(session.id)) {
        pruned ??= new Set(stoppedIds)
        pruned.delete(session.id)
      }
    }
    if (pruned) setStoppedIds(pruned)
  }

  // Apply the local stopped override once, up front; both the collapsed summary
  // and the expanded tree derive from this. Memoized — this panel is on the hot
  // streaming path.
  const withStopped = useMemo(
    () =>
      sessions.map((session) =>
        stoppedIds.has(session.id) ? { ...session, runtimeStatus: 'stopped' as const } : session,
      ),
    [sessions, stoppedIds],
  )

  // Collapsed-summary head: the first-spawned session (createdAt ascending,
  // tie-broken by id). createdAt is immutable so the head never jumps as sessions
  // tick — never by updatedAt/last-message.
  const head = useMemo(
    () => [...withStopped].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0],
    [withStopped],
  )
  // A plugin's `subagentStatusLine` redraws subagent rows; an empty body hides that row.
  const rowBodies = useSubagentRows(
    scopeRootId,
    withStopped.some((session) => session.sessionKind === 'subagent'),
  )
  // Expanded order: a hierarchy (parent then its children), siblings newest-first.
  const tree = useMemo(
    () =>
      buildRuntimeSessionTree(
        withStopped.filter((session) => rowBodies.get(session.id) !== ''),
        collapsedIds,
      ),
    [withStopped, collapsedIds, rowBodies],
  )

  // Stable across ticks so the memoized rows are not invalidated by a re-render of this panel.
  const stopRuntime = useCallback(
    (session: UiSession) => {
      if (stoppingIdRef.current) return
      setStoppingId(session.id)
      void backendClient
        .stop(session.id)
        .then((stopped) => {
          if (stopped) setStoppedIds((current) => new Set(current).add(session.id))
        })
        .finally(() => setStoppingId(null))
    },
    [stoppingIdRef],
  )

  // The empty-state bail-out sits BELOW every hook, and must stay there. It used to sit above
  // this `useCallback`, which is fine only while the condition never changes — and the one
  // moment it always changes is a SPAWN: the panel renders empty (early return, hooks stop
  // short), the first sub-agent appears, the return no longer fires, and React sees more hooks
  // than last time and throws. An early return is only safe once nothing hook-shaped follows it.
  if (withStopped.length === 0 && !parentSession) return null

  const HeadIcon = head ? kindStyle(head).icon : ArrowUpLeft
  const headRunning = head?.runtimeStatus === 'running'
  const parentTitle = parentSession ? parentTitleFor(parentSession) : undefined
  // What the list actually holds. The parent used to be counted because it was a row in it.
  const visibleSessionCount = withStopped.length
  return (
    <CollapsibleStrip
      label={{ expand: 'Show agent sessions', collapse: 'Hide agent sessions' }}
      icon={headRunning ? <Spinner size="xs" /> : <HeadIcon className="size-3.5" />}
      // GOING BACK UP IS ONE CLICK, from the collapsed bar. The way out of a sub-session was a
      // row inside the list, so leaving a child meant opening a list of its siblings to find
      // the one row that is not one of them — a glyph's worth of space spent on decoration
      // while the gesture it sits next to took two steps. When there is no parent the glyph
      // stays a glyph.
      {...(parentSession
        ? {
            leading: (
              <ActionTooltip side="top" label={`Back to ${parentTitle}`}>
                <button
                  type="button"
                  onClick={() => void onSelect(parentSession.id)}
                  aria-label={`Back to parent session: ${parentTitle}`}
                  className="focus-ring inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm text-text-faint outline-none transition-colors hover:bg-surface-active hover:text-text-strong"
                >
                  <ArrowUpLeft className="size-3.5" />
                </button>
              </ActionTooltip>
            ),
          }
        : {})}
      count={visibleSessionCount}
      title="Agent sessions"
      listLabel="Agent sessions"
      // Collapsed: name the first session + what it's DOING now (status lives in
      // the per-row dot, so no redundant "· done" word here).
      summary={
        head ? (
          <RuntimeHeadSummary session={head} running={headRunning} />
        ) : (
          `Parent · ${parentTitle}`
        )
      }
    >
      {/* The parent is NOT a row here any more. It was one, at the top of a list of this
          session's siblings — the one entry that is not one of them — so leaving a child meant
          opening a list to find the thing that was not in it. It is the bar's own control now,
          and this list is what its name says: the sessions of this branch. */}
      {tree.map((node) => (
        <RuntimeSessionRow
          key={node.session.id}
          node={node}
          isActive={node.session.id === activeSessionId}
          isStopping={stoppingId === node.session.id}
          collapsed={collapsedIds.has(node.session.id)}
          onToggle={toggleBranch}
          onSelect={onSelect}
          onStop={stopRuntime}
          body={rowBodies.get(node.session.id)}
        />
      ))}
    </CollapsibleStrip>
  )
}

export const RuntimeSessionsPanel = memo(RuntimeSessionsPanelComponent)
RuntimeSessionsPanel.displayName = 'RuntimeSessionsPanel'
