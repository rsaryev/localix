import { createRealtimeFeed, useRealtimeFeed } from '@localixai/mini-app-sdk/ui/realtime-feed'
import { runAsBackgroundWork, useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import {
  DOCKER_EVENTS_FRAME_TAG,
  DOCKER_EVENTS_SUBSCRIBE,
  DOCKER_EVENTS_UNSUBSCRIBE,
  type DockerEventsFrame,
} from '../../backend/events-contract'

/**
 * The browser's side of the Docker events stream (`backend/events-contract.ts`).
 *
 * The sidebar and every open container tab follow the same host-wide stream, so it is one key of
 * the SDK's feed: one subscription, one frame listener. Liveness is the backend's own status
 * frames; the feed drops it the moment the socket drops (the poll is the only feed until the
 * stream is back) and on a reconnect, because a server-side stream does not survive a new socket.
 */
export interface DockerEventsFollower {
  event?: (frame: Extract<DockerEventsFrame, { kind: 'event' }>) => void
  live?: (live: boolean) => void
  resync?: () => void
}

/** The one key: the stream is host-wide. */
export const DOCKER_EVENTS = 'host'

export const dockerEventsFeed = createRealtimeFeed<string, DockerEventsFrame>({
  tag: DOCKER_EVENTS_FRAME_TAG,
  subscribe: () => ({ t: DOCKER_EVENTS_SUBSCRIBE }),
  unsubscribe: () => ({ t: DOCKER_EVENTS_UNSUBSCRIBE }),
  decode: (json) => JSON.parse(json) as DockerEventsFrame,
  status: (frame) => (frame.kind === 'status' ? frame.status === 'live' : undefined),
})

/**
 * A follower as the feed hears it. The feed reports only CHANGES of liveness, so every `live`
 * here is the stream coming back: the events while the child was down were never seen, and the
 * follower re-reads once.
 */
export function dockerEventsFollower(follower: DockerEventsFollower) {
  return {
    frame: (frame: DockerEventsFrame) => {
      if (frame.kind === 'event') follower.event?.(frame)
    },
    live: (live: boolean) => {
      follower.live?.(live)
      if (live) follower.resync?.()
    },
  }
}

/**
 * Follow the stream from a component; returns whether it is live. A warm-hidden work item follows
 * nothing, like its poll: the poll's own tick on becoming visible re-reads.
 */
export function useDockerEvents(enabled: boolean, follower: DockerEventsFollower): boolean {
  const visible = useWorkItemVisible()
  const following = enabled && visible
  return useRealtimeFeed(
    dockerEventsFeed,
    following ? DOCKER_EVENTS : null,
    dockerEventsFollower(follower),
  )
}

/**
 * Coalesce a burst of events into one re-read: `compose up` emits dozens in a second, and each
 * would otherwise be its own request. The strongest scope asked for in the window wins.
 */
export function createEventRefreshBatcher<Scope extends string>(
  run: (scope: Scope) => void,
  stronger: (a: Scope, b: Scope) => Scope,
  windowMs = 150,
): { push: (scope: Scope) => void; cancel: () => void } {
  let pending: Scope | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    push(scope) {
      pending = pending === null ? scope : stronger(pending, scope)
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        const next = pending
        pending = null
        // A daemon event's re-read is not the person's action.
        if (next !== null) runAsBackgroundWork(() => run(next))
      }, windowMs)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}
