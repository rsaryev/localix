import { createRealtimeFeed, useRealtimeFeed } from '@localixai/mini-app-sdk/ui/realtime-feed'
import { runAsBackgroundWork } from '@localixai/mini-app-sdk/ui/visibility'
import {
  COLLECTIONS_FRAME_TAG,
  COLLECTIONS_SUBSCRIBE,
  COLLECTIONS_UNSUBSCRIBE,
  type KubeCollectionsFrame,
} from '../../backend/collections-contract'

interface CollectionsKey {
  context: string
  namespace: string
}

/**
 * The browser's side of the deployment/service/node change stream
 * (`backend/collections-contract.ts`). Liveness is the informers' own status frames: the stream is
 * live only while the cluster's watches run, and a socket drop takes it down at once.
 */
export const collectionsFeed = createRealtimeFeed<CollectionsKey, KubeCollectionsFrame>({
  tag: COLLECTIONS_FRAME_TAG,
  subscribe: (key) => ({
    t: COLLECTIONS_SUBSCRIBE,
    context: key.context || undefined,
    namespace: key.namespace,
  }),
  unsubscribe: (key) => ({
    t: COLLECTIONS_UNSUBSCRIBE,
    context: key.context || undefined,
    namespace: key.namespace,
  }),
  id: (key) => `${key.context}\n${key.namespace}`,
  decode: (json) => JSON.parse(json) as KubeCollectionsFrame,
  route: (frame) => `${frame.context}\n${frame.namespace}`,
  status: (frame) => (frame.kind === 'status' ? frame.status === 'live' : undefined),
})

/**
 * Re-read the collections on every announced change and after every gap (a reconnect drops the
 * server-side watch and whatever changed meanwhile). The re-read is the stream's, not the
 * person's. Liveness is not acted on here: the caller's poll decides what it means, and a flip
 * re-runs that poll's first read.
 */
export function collectionsFollower(reread: () => void) {
  const background = () => runAsBackgroundWork(reread)
  return {
    frame: (frame: KubeCollectionsFrame) => {
      if (frame.kind === 'changed') background()
    },
    reconnect: background,
  }
}

/**
 * Follow the (context, namespace)'s collection changes; returns whether the stream is live. A
 * scope change starts not-live until the new watch says otherwise.
 */
export function useCollectionsFeed(
  enabled: boolean,
  context: string,
  namespace: string,
  reread: () => void,
): boolean {
  return useRealtimeFeed(
    collectionsFeed,
    enabled && namespace ? { context, namespace } : null,
    collectionsFollower(reread),
  )
}
