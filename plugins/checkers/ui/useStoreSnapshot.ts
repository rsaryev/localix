import { useEffect, useRef } from 'react'
import { createRealtimeFeed, useRealtimeFeed } from '@localixai/plugin-sdk/ui/realtime-feed'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import {
  STORE_FRAME_TAG,
  storeFeedCommands,
  storeFrameSchema,
  type StoreFrame,
} from '../shared/store-feed'
import { usePolledSnapshot, type PolledSnapshot } from './usePolledSnapshot'

/**
 * While the feed is live, how often the view still looks: a nudge lost to a backend restart is
 * caught within this, not never.
 */
export const STORE_BACKSTOP_POLL_MS = 30_000

/** One scope of a plugin's stores: the plugin, and the chat (`null` for its own folder). */
type StoreScope = Pick<StoreFrame, 'plugin' | 'sessionId'>

const scopeId = (scope: StoreScope) => `${scope.plugin}\n${scope.sessionId ?? ''}`

/**
 * The store feed's nudges, over the SDK's realtime feed: ONE subscription per scope however many
 * views follow it (the first to leave must not end the stream for the rest), live once the host
 * took the subscribe and down the moment the socket drops, and a resubscribe after a reconnect.
 */
export const storeFeed = createRealtimeFeed<StoreScope, StoreFrame>({
  tag: STORE_FRAME_TAG,
  subscribe: (scope) => ({
    t: storeFeedCommands(scope.plugin).subscribe,
    sessionId: scope.sessionId,
  }),
  unsubscribe: (scope) => ({
    t: storeFeedCommands(scope.plugin).unsubscribe,
    sessionId: scope.sessionId,
  }),
  id: scopeId,
  decode: (json) => storeFrameSchema.parse(JSON.parse(json)),
  route: scopeId,
})

/**
 * `usePolledSnapshot` for a route that reads what `openJsonStore` keeps: re-read the moment the
 * backend's store feed says the scope changed (`backend/store-feed.ts`), and poll at `intervalMs`
 * only while the feed is NOT live — before it answers, in a host without realtime, or while the
 * socket is down — else at the slow backstop. A reconnect re-reads once: nudges sent while the
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
    backstopMs?: number
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
