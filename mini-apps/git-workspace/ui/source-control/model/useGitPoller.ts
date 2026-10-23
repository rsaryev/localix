import { useCallback, useEffect, useRef } from 'react'
import { useMiniAppWorkspaceChanges } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { useVisiblePolling, useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { repoPresence } from './repoPresence'
import { useSourceControlStore } from './store'

// What drives a refresh. A poll on a timer was the only source of "something changed" outside a
// run, so a `git switch` in the terminal reached the branch pill up to 30 s late while every idle
// session still spent ~5 git processes per tick. The workspace watcher's signal (`.git` included)
// now says WHEN to read; the timer is only a backstop:
//
//  - live signal → a 2-minute backstop, for what the watcher cannot see: a linked worktree whose
//    git dir lives outside the project, a repository nested past the watcher's cap; watcher eviction now reports live=false;
//  - no signal (a remote session, a failed watcher, a host without one) → the old adaptive
//    cadence: brisk during a run, slow when idle;
//  - a pending first probe → brisk either way, so startup discovery recovers quickly.
const ACTIVE_POLL_INTERVAL_MS = 6000
const IDLE_POLL_INTERVAL_MS = 30000
const BACKSTOP_POLL_INTERVAL_MS = 120_000
/**
 * How long changes fold into one refresh, measured from the first. An agent run or a build writes
 * in bursts for many seconds; one `git status` per window caps that at 30 reads a minute instead
 * of one per burst, and a branch switch still shows within about two seconds.
 */
export const CHANGE_WINDOW_MS = 2000

export function gitPollIntervalMs(input: {
  live: boolean | null
  isRunning: boolean | undefined
  pending: boolean
}): number {
  if (input.pending) return ACTIVE_POLL_INTERVAL_MS
  if (input.live === true) return BACKSTOP_POLL_INTERVAL_MS
  return input.isRunning ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS
}

/**
 * The source-control refresher for ONE named session — mounted through `GitPoller` by each surface
 * that belongs to a chat (the chat's background surface, the Git tab), never for a guessed
 * "active" one. It refreshes on session or project change, when the chat's files change on disk,
 * on window focus, immediately when an agent run finishes, and on the backstop interval above.
 * The store de-dupes overlapping refreshes, so the pill / branch bar / inspector tab all read one
 * cache.
 */
export function useGitPoller(
  sessionId: string | null,
  isRunning: boolean | undefined,
  projectId?: string | null,
): void {
  const refresh = useSourceControlStore((s) => s.refresh)
  const refreshFresh = useSourceControlStore((s) => s.refreshFresh)
  // A negative probe is temporary: git init or a late working-directory binding
  // can create a repo without changing the session. Keep a slow discovery
  // interval and focus listeners; pending startup reads retry at the fast cadence.
  const presence = useSourceControlStore((s) =>
    repoPresence(sessionId ? s.bySession[sessionId]?.status : null),
  )
  const wasRunning = useRef(isRunning)
  const workItemVisible = useWorkItemVisible()

  // Project reassignment can change the directory without changing the session
  // id. Wait out an older read so it cannot count as the new project's probe.
  useEffect(() => {
    if (sessionId) void refreshFresh(sessionId)
  }, [sessionId, projectId, refreshFresh])

  // A change heard while the surface is hidden is not read then — a hidden tab must not spawn
  // git — but remembered, so the surface is current the moment it shows again rather than at the
  // next backstop tick, two minutes away.
  const missed = useRef(false)
  const visibleNow = useCallback(
    () => workItemVisible && (typeof document === 'undefined' || !document.hidden),
    [workItemVisible],
  )
  const live = useMiniAppWorkspaceChanges(
    sessionId,
    () => {
      if (!sessionId) return
      if (visibleNow()) void refresh(sessionId)
      else missed.current = true
    },
    { windowMs: CHANGE_WINDOW_MS },
  )
  useEffect(() => {
    if (!sessionId || !workItemVisible) return
    const catchUp = () => {
      if (!missed.current || !visibleNow()) return
      missed.current = false
      void refresh(sessionId)
    }
    catchUp()
    document.addEventListener('visibilitychange', catchUp)
    return () => document.removeEventListener('visibilitychange', catchUp)
  }, [sessionId, workItemVisible, visibleNow, refresh])

  const pollGit = useCallback(() => {
    return sessionId ? refresh(sessionId) : undefined
  }, [sessionId, refresh])
  useVisiblePolling({
    enabled: !!sessionId,
    intervalMs: gitPollIntervalMs({ live, isRunning, pending: presence === 'pending' }),
    onTick: pollGit,
    refreshOnFocus: true,
    resetKey: `${sessionId ?? ''}:${projectId ?? ''}`,
  })

  // A run just completed → the working tree likely changed; refresh now.
  useEffect(() => {
    if (wasRunning.current && !isRunning && sessionId) void refresh(sessionId)
    wasRunning.current = isRunning
  }, [isRunning, sessionId, refresh])
}
