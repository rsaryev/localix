import { createRealtimeFeed, useRealtimeFeed } from '@localixai/mini-app-sdk/ui/realtime-feed'
import { runAsBackgroundWork, useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import {
  PORT_FORWARDS_FRAME_TAG,
  PORT_FORWARDS_SUBSCRIBE,
  PORT_FORWARDS_UNSUBSCRIBE,
  type PortForwardsFrame,
} from '../../backend/forwards-contract'
import type { PortForward } from '../../backend/contracts'
import { kubernetesApi } from '../api/kubernetesApi'

/**
 * The browser's side of the port-forward change stream (`backend/forwards-contract.ts`).
 *
 * The forward list is host-wide, so the sidebar and every pod tab follow one key: one
 * subscription, one frame listener. Liveness is the host's answer to the subscribe — the registry
 * is in-process, so a subscribed stream has nothing else that could be down.
 */
export const PORT_FORWARDS = 'forwards'

export const portForwardsFeed = createRealtimeFeed<string, PortForwardsFrame>({
  tag: PORT_FORWARDS_FRAME_TAG,
  subscribe: () => ({ t: PORT_FORWARDS_SUBSCRIBE }),
  unsubscribe: () => ({ t: PORT_FORWARDS_UNSUBSCRIBE }),
  decode: (json) => JSON.parse(json) as PortForwardsFrame,
})

/**
 * A follower that re-reads on every change, and on every gap: a reconnect, or the stream coming
 * up after the reader last looked, may have missed a change. The re-read is the stream's, not the
 * person's, even when it lands just after their click.
 */
export function portForwardsFollower(reread: () => void) {
  const background = () => runAsBackgroundWork(reread)
  return {
    frame: (frame: PortForwardsFrame) => {
      if (frame.kind === 'changed') background()
    },
    live: (live: boolean) => {
      if (live) background()
    },
    reconnect: background,
  }
}

/**
 * Follow the stream from a component; returns whether it is live. A warm-hidden work item follows
 * nothing, like its poll.
 */
export function usePortForwardsFeed(enabled: boolean, reread: () => void): boolean {
  const visible = useWorkItemVisible()
  return useRealtimeFeed(
    portForwardsFeed,
    enabled && visible ? PORT_FORWARDS : null,
    portForwardsFollower(reread),
  )
}

/**
 * The sidebar's forward list, re-read on each announced change. Its slow secondary refresh still
 * reads the list with the other collections; this is what makes a forward a pod tab started, or
 * one the cluster closed, show without waiting for that refresh.
 */
export function useLivePortForwards(
  enabled: boolean,
  apply: (forwards: PortForward[]) => void,
): boolean {
  return usePortForwardsFeed(enabled, () => {
    void kubernetesApi.listPortForwards().then(apply, () => {
      // The list keeps its last good snapshot; the secondary refresh reads it again.
    })
  })
}
