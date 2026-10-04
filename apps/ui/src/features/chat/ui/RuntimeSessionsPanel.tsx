import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpLeft, Square } from 'lucide-react'

import { Spinner } from '@localixai/kit/spinner'
import { IconButton } from '@localixai/kit/icon-button'
import { StatusDot } from '@localixai/kit/status-dot'
import { STATUS_TONE_DOT } from '@localixai/kit/status-dot'
import { CollapsibleStrip } from '@localixai/kit/collapsible-strip'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { backendClient } from '@/shared/api/client'
import { sessionRef, type UiSession } from '@/shared/api/contracts'
import { useChatStore } from '@/features/chat/model/store'
import { useSessionActivity } from '@localixai/plugin-sdk/ui/session-activity'
import { buildRuntimeSessionTree, type FlatNode } from './runtimeSessionTree'
import {
  kindStyle,
  runtimeCountsLabel,
  sessionTone,
  statusText,
  titleFor,
} from './runtimeSessionMeta'
import { TreeGuide } from './runtimeSessionRowParts'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowMeta,
  WorkbenchListRowTrigger,
} from '@localixai/kit/workbench-list-row'

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

interface RuntimeSessionRowProps {
  node: FlatNode
  isActive: boolean
  isStopping: boolean
  onSelect: (id: string) => void | Promise<void>
  onStop: (session: UiSession) => void
}

/**
 * ONE runtime session row. Subscribes to its OWN session's ticks BY ID, so an activity frame for
 * a sub-agent re-renders that row and nothing else — not the panel, not its siblings. Memoized on
 * the props above, all of which are stable across a tick.
 */
const RuntimeSessionRow = memo(function RuntimeSessionRow({
  node,
  isActive,
  isStopping,
  onSelect,
  onStop,
}: RuntimeSessionRowProps) {
  const { session } = node
  const runtime = useSessionActivity(session.id)
  const kind = kindStyle(session)
  const isRunning = session.runtimeStatus === 'running'
  const countsLabel = isRunning ? runtimeCountsLabel(runtime) : undefined
  const title = titleFor(session)
  return (
    <WorkbenchListRow
      role="listitem"
      density="dense"
      active={isActive}
      className={isRunning ? '' : 'opacity-70'}
    >
      <TreeGuide prefixCols={node.prefixCols} depth={node.depth} isLast={node.isLast} />
      <StatusDot className={STATUS_TONE_DOT[sessionTone(session)]} label={statusText(session)} />
      <WorkbenchListRowTrigger
        onClick={() => void onSelect(session.id)}
        aria-label={`Open ${title}`}
        aria-current={isActive ? 'page' : undefined}
        className="gap-1.5 px-0"
      >
        <span className="truncate text-xs font-medium text-inherit">{title}</span>
        <span className="min-w-0 flex-1 truncate text-2xs text-text-faint">
          {isRunning && runtime.activity ? runtime.activity : kind.label}
        </span>
      </WorkbenchListRowTrigger>
      {countsLabel && (
        <WorkbenchListRowMeta className="px-0 tabular-nums max-sm:hidden" title="Run activity">
          {countsLabel}
        </WorkbenchListRowMeta>
      )}
      {isRunning && (
        <WorkbenchListRowActions aria-label={`${title} actions`}>
          <IconButton
            size="md"
            tone="danger"
            disabled={isStopping}
            aria-label={`Stop ${title}`}
            tooltip={isStopping ? `Stopping ${title}…` : `Stop ${title}`}
            tooltipSide="top"
            onClick={() => onStop(session)}
            className="ring-1 ring-inset ring-control-border/55 hover:bg-status-error/12 hover:ring-status-error/25"
          >
            {isStopping ? (
              <Spinner size="xs" />
            ) : (
              <Square className="size-2.5" fill="currentColor" />
            )}
          </IconButton>
        </WorkbenchListRowActions>
      )}
    </WorkbenchListRow>
  )
})

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
  // Expanded order: a hierarchy (parent then its children), siblings newest-first.
  const tree = useMemo(() => buildRuntimeSessionTree(withStopped), [withStopped])

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
          onSelect={onSelect}
          onStop={stopRuntime}
        />
      ))}
    </CollapsibleStrip>
  )
}

export const RuntimeSessionsPanel = memo(RuntimeSessionsPanelComponent)
RuntimeSessionsPanel.displayName = 'RuntimeSessionsPanel'
