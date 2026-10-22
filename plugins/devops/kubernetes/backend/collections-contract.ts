/**
 * The deployment, service and node change stream on the realtime socket (frame tag `o`).
 *
 * The pod watch carried pods only, so a sidebar whose pods were live still re-listed every
 * collection every half minute to notice a scaled deployment or a new service. Informers over
 * those collections say when one changed instead; the frame names the collections and carries no
 * rows — the reader asks for them. The poll is left for while this stream is down.
 *
 * A leaf with no runtime imports, so the browser bundle can take the constants.
 */
export const COLLECTIONS_FRAME_TAG = 'o'
export const COLLECTIONS_SUBSCRIBE = 'devops:k8s.collections.subscribe'
export const COLLECTIONS_UNSUBSCRIBE = 'devops:k8s.collections.unsubscribe'

/** The collections watched beside the pods; pods have their own watch (frame tag `w`). */
export type WatchedCollection = 'deployments' | 'services' | 'nodes'
export const WATCHED_COLLECTIONS: readonly WatchedCollection[] = [
  'deployments',
  'services',
  'nodes',
]

/** One or more collections of a (context, namespace) changed since the last frame. */
export interface KubeCollectionsChangedFrame {
  kind: 'changed'
  context: string
  namespace: string
  collections: WatchedCollection[]
}

/** Every collection's watch is streaming (`live`), or one failed and the reader polls (`down`). */
export interface KubeCollectionsStatusFrame {
  kind: 'status'
  context: string
  namespace: string
  status: 'live' | 'down'
}

export type KubeCollectionsFrame = KubeCollectionsChangedFrame | KubeCollectionsStatusFrame
