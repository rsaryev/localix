import type { KubePod } from './contract-types'

// ---------------------------------------------------------------------------
// Live pod list/watch
// ---------------------------------------------------------------------------
// An official-client informer streams these frames to subscribed clients over the
// realtime WS mux (the `w\n<json>` frame kind). A `pod` frame carries one add,
// modify, or delete that the UI reconciles by name; a `status` frame flips the
// sidebar's live/polling indicator.

/** A Kubernetes watch action, narrowed to the pod deltas the UI reconciles. */
export type KubeWatchAction = 'ADDED' | 'MODIFIED' | 'DELETED'

/** Whether a (context, namespace) watch is streaming live, or has degraded (the
 *  client polls until it recovers). */
export type KubeWatchStatus = 'live' | 'down'

/** One pod add/modify/delete pushed from a live watch. */
export interface KubeWatchPodFrame {
  kind: 'pod'
  context: string
  namespace: string
  action: KubeWatchAction
  pod: KubePod
}

/** A watch's liveness flipped (connected/recovered → `live`; failed → `down`). */
export interface KubeWatchStatusFrame {
  kind: 'status'
  context: string
  namespace: string
  status: KubeWatchStatus
}

/** The discriminated payload of a `w\n<json>` realtime frame. */
export type KubeWatchFrame = KubeWatchPodFrame | KubeWatchStatusFrame
