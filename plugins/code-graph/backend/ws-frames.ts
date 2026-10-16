import type { WorkspaceScopeHost, WsFrameContribution } from '@localixai/plugin-sdk/backend'
import {
  GRAPH_FRAME_TAG,
  GRAPH_SUBSCRIBE,
  GRAPH_UNSUBSCRIBE,
  type GraphFrame,
} from '../shared/stream'
import { subscribeAgentView } from './agent-view'
import { projectIndex } from './indexing/projects'

/**
 * The map's live stream (`shared/stream.ts`): an open tab subscribes for its chat and is pushed
 * the agent's requests, report requests and index revisions, instead of polling for each.
 *
 * The project is resolved from the authenticated socket's user and the chat it names — host
 * authority, never a path from the client — the same way Project Space follows its board.
 */
export function createGraphWsFrames(
  dataDir: string,
  scope: Pick<WorkspaceScopeHost, 'resolveSessionRoot'>,
): { wsFrames: WsFrameContribution[]; onShutdown: () => void } {
  interface Handle {
    stopped: boolean
    release: () => void
  }
  const active = new Set<Handle>()
  const stop = (handle: Handle) => {
    handle.stopped = true
    handle.release()
    handle.release = () => {}
    active.delete(handle)
  }
  return {
    wsFrames: [
      {
        subscribeCommand: GRAPH_SUBSCRIBE,
        unsubscribeCommand: GRAPH_UNSUBSCRIBE,
        frameTag: GRAPH_FRAME_TAG,
        key: (params) => (typeof params.sessionId === 'string' ? params.sessionId : 'invalid'),
        start(params, send, { userId }) {
          const handle: Handle = { stopped: false, release: () => {} }
          const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null
          if (!sessionId) return handle
          active.add(handle)
          const push = (frame: GraphFrame) => send(JSON.stringify(frame))
          void scope
            .resolveSessionRoot(userId, sessionId)
            .then((root) => {
              if (!root || handle.stopped) return
              const index = projectIndex(dataDir, root)
              const offAgent = subscribeAgentView(index.root, sessionId, (event) =>
                push(
                  event.kind === 'agent'
                    ? { sessionId, agent: event.agent }
                    : { sessionId, report: event.ask },
                ),
              )
              const offIndex = index.subscribe((status) =>
                push({ sessionId, revision: status.revision }),
              )
              handle.release = () => {
                offAgent()
                offIndex()
              }
            })
            .catch(() => {})
          return handle
        },
        stop(handle) {
          stop(handle as Handle)
        },
      },
    ],
    // Registry removal only blocks new subscribes; release the live ones on a hot disable too.
    onShutdown: () => {
      for (const handle of active) stop(handle)
    },
  }
}
