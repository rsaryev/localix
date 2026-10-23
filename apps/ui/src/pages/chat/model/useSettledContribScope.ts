import { useEffect, useState } from 'react'
import { LAUNCH_RESTORE_WAIT_MS } from '@/entities/chat/model/launchRestore'

/**
 * The project scope the plugin contribution store should describe — the route's, EXCEPT across a
 * home route, which never stays: the launch restore or the home draft always redirects it to a
 * project (`useUrlStoreSync`).
 *
 * Treating the cold `/` as the global scope is what made the rail flicker at launch. The restored
 * frame (project P's plugins) was discarded by `prepareMiniAppContribScope(null)`, the global set
 * (fewer plugins) was fetched and published, then emptied again at the redirect, then P's set
 * arrived. Holding keeps the scope the store already has: on a cold launch that is the frame's
 * own project, so when the restore lands on P nothing is discarded and the first sync is P's.
 *
 * `undefined` means no scope has settled yet (a cold launch still on `/`): the caller neither
 * prepares a scope nor starts a sync. The hold is bounded: the restore waits at most
 * `LAUNCH_RESTORE_WAIT_MS` and the home draft is one request after it, so past twice that the
 * redirect is not coming (the draft failed) and the route's own scope is the honest answer.
 */
export const HOME_SCOPE_HOLD_MS = 2 * LAUNCH_RESTORE_WAIT_MS

export function useSettledContribScope(
  routeProjectId: string | null,
  onHomeRoute: boolean,
): string | null | undefined {
  const [lapsed, setLapsed] = useState(false)
  // A new home visit gets a fresh hold (render-phase reset, not an effect: no extra pass).
  if (!onHomeRoute && lapsed) setLapsed(false)
  useEffect(() => {
    if (!onHomeRoute) return
    const timer = setTimeout(() => setLapsed(true), HOME_SCOPE_HOLD_MS)
    return () => clearTimeout(timer)
  }, [onHomeRoute])
  const holding = onHomeRoute && !lapsed
  const [settled, setSettled] = useState<string | null | undefined>(
    holding ? undefined : routeProjectId,
  )
  if (!holding && settled !== routeProjectId) setSettled(routeProjectId)
  return holding ? settled : routeProjectId
}
