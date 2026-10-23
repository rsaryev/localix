import {
  createRealtimeFeed,
  useRealtimeFeed,
  type RealtimeFeedFollower,
} from '@localixai/mini-app-sdk/ui/realtime-feed'
import type { AgentView } from '../shared/view'
import {
  GRAPH_FRAME_TAG,
  GRAPH_SUBSCRIBE,
  GRAPH_UNSUBSCRIBE,
  graphFrameSchema,
  type GraphFrame,
} from '../shared/stream'

/**
 * The tab's side of the map's live stream (`shared/stream.ts`).
 *
 * Several hooks of one tab follow the same chat — the requests, the camera, the snapshot — so the
 * SDK's feed carries ONE subscription per chat however many follow it, and a reconnect
 * re-subscribes and tells each listener, because frames sent while the socket was down are gone.
 */
export interface GraphStreamListener {
  agent?: (view: AgentView) => void
  report?: () => void
  revision?: () => void
  /** A refresh moved (paced by the backend); the done frame is `revision`. */
  progress?: () => void
  reconnect?: () => void
}

export const graphFeed = createRealtimeFeed<string, GraphFrame>({
  tag: GRAPH_FRAME_TAG,
  subscribe: (sessionId) => ({ t: GRAPH_SUBSCRIBE, sessionId }),
  unsubscribe: (sessionId) => ({ t: GRAPH_UNSUBSCRIBE, sessionId }),
  decode: (json) => graphFrameSchema.parse(JSON.parse(json)),
  route: (frame) => frame.sessionId,
})

/** A listener's handlers as one feed follower: a frame goes to the handler of its kind. */
export function graphFollower(listener: GraphStreamListener): RealtimeFeedFollower<GraphFrame> {
  return {
    frame: (frame) => {
      if ('agent' in frame) listener.agent?.(frame.agent)
      else if ('report' in frame) listener.report?.()
      else if ('indexing' in frame) listener.progress?.()
      else listener.revision?.()
    },
    reconnect: () => listener.reconnect?.(),
  }
}

/** Follow one chat's stream from a component: handlers may change identity on every render. */
export function useGraphStream(
  sessionId: string | null,
  enabled: boolean,
  handlers: GraphStreamListener,
): boolean {
  return useRealtimeFeed(graphFeed, enabled ? sessionId : null, graphFollower(handlers))
}
