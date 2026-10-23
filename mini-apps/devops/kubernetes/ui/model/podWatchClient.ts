// Client side of the live pod watch, over the SDK's realtime feed, shared by the sidebar hook
// (`useKubernetes`) and the pod tab so their frame demux / re-subscribe behavior can't drift.
// Frames arrive on the `w` frame tag (the mini app's `WsFrameContribution`); subscribe/unsubscribe
// ride the `devops:k8s.watch.subscribe`/`devops:k8s.watch.unsubscribe` WS commands. All sends are
// best-effort — a failed subscribe just leaves the poll fallback in charge.
import { createRealtimeFeed } from '@localixai/mini-app-sdk/ui/realtime-feed'
import type {
  KubePod,
  KubeWatchAction,
  KubeWatchFrame,
  KubeWatchStatus,
} from '../../backend/contracts'

export interface PodWatchHandlers {
  /** One reconciled delta for the watched (context, namespace). */
  onPod: (action: KubeWatchAction, pod: KubePod) => void
  /** Liveness change — also fired with 'down' when a WS reconnect drops the watch. */
  onStatus?: (status: KubeWatchStatus) => void
  /** Called after a WS reconnect re-subscribes (a new socket drops the server-side
   *  subscription) so the caller can REST-resync any deltas missed across the gap. */
  onReconnect?: () => void
}

interface PodWatchKey {
  context: string
  namespace: string
}

/**
 * One subscription per (context, namespace), however many surfaces follow it: the sidebar and a
 * pod tab watching one namespace each opened their own, and each parsed every frame. Liveness is
 * the informer's own status frames; the feed drops it the moment the socket does (the poll is the
 * only feed then) and keeps it down after a reconnect until the watch says `live` again, because a
 * server-side watch does not survive a new socket.
 */
const podWatchFeed = createRealtimeFeed<PodWatchKey, KubeWatchFrame>({
  tag: 'w',
  subscribe: (key) => ({
    t: 'devops:k8s.watch.subscribe',
    context: key.context || undefined,
    namespace: key.namespace,
  }),
  unsubscribe: (key) => ({
    t: 'devops:k8s.watch.unsubscribe',
    context: key.context || undefined,
    namespace: key.namespace,
  }),
  id: (key) => `${key.context}\n${key.namespace}`,
  decode: (json) => JSON.parse(json) as KubeWatchFrame,
  route: (frame) => `${frame.context}\n${frame.namespace}`,
  status: (frame) => (frame.kind === 'status' ? frame.status === 'live' : undefined),
})

/**
 * Subscribe to the live pod watch for a (context, namespace). Returns the unsubscribe, which
 * releases the server-side watch with its last follower. Frames for other contexts/namespaces
 * never reach the handlers.
 */
export function subscribePodWatch(
  context: string | undefined,
  namespace: string,
  handlers: PodWatchHandlers,
): () => void {
  const key = { context: context || '', namespace }
  const release = podWatchFeed.follow(key, {
    frame: (frame) => {
      if (frame.kind === 'pod') handlers.onPod(frame.action, frame.pod)
    },
    live: (live) => handlers.onStatus?.(live ? 'live' : 'down'),
    reconnect: () => handlers.onReconnect?.(),
  })
  // A surface joining a watch that is already live is told so: no new status frame will come.
  if (podWatchFeed.live(key)) handlers.onStatus?.('live')
  return release
}
