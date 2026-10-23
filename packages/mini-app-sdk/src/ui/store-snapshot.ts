import { useEffect, useRef } from 'react'
import { useRealtimeFeed } from './realtime-feed'
import { storeFeed } from './store-resource'
import { useWorkItemVisible } from './visibility'
import { usePolledSnapshot, type PolledSnapshot } from './route-snapshot'

/** A healthy native store feed needs no periodic read. */
export const STORE_BACKSTOP_POLL_MS = null
export { storeFeed } from './store-resource'

/**
 * `usePolledSnapshot` for a route that reads what `openJsonStore` keeps: re-read the moment the
 * backend's store feed says the scope changed (`backend/store-feed.ts`), and poll at `intervalMs`
 * only while the feed is NOT live — before it answers, in a host without realtime, or while the
 * socket is down — without a periodic read when healthy. A reconnect re-reads once: nudges sent while the
 * socket was down are gone.
 *
 * A view that only polled saw the agent's change one poll late and paid for every poll in between;
 * a view that only listened would miss a change for good whenever a nudge was lost.
 */
export function useStoreSnapshot<T>(
  options: Parameters<typeof usePolledSnapshot<T>>[0] & {
    plugin: string
    /** The chat whose stores the route reads, or `null` for the plugin's own folder. */
    sessionId: string | null
    backstopMs?: number | null
  },
): PolledSnapshot<T> & { live: boolean } {
  const { plugin, sessionId, backstopMs = STORE_BACKSTOP_POLL_MS, ...poll } = options
  // Followed only while the surface is shown: a hidden tab's nudges would each cost a read
  // nobody sees, and showing it again polls at once.
  const visible = useWorkItemVisible()
  const following = (poll.active ?? true) && visible
  // The poll's cadence depends on `live`, so the feed is followed first and reaches the poll's
  // re-read through a ref.
  const refresh = useRef(() => {})
  const live = useRealtimeFeed(storeFeed, following ? { plugin, sessionId } : null, {
    frame: () => {
      if (document.visibilityState !== 'hidden') refresh.current()
    },
    reconnect: () => refresh.current(),
  })
  const polled = usePolledSnapshot({ ...poll, intervalMs: live ? backstopMs : poll.intervalMs })
  useEffect(() => {
    refresh.current = polled.refresh
  })
  return { ...polled, live }
}
