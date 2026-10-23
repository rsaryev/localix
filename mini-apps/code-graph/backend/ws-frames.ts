import type { WorkspaceScopeHost, WsFrameContribution } from '@localixai/mini-app-sdk/backend'
import {
  GRAPH_FRAME_TAG,
  GRAPH_SUBSCRIBE,
  GRAPH_UNSUBSCRIBE,
  type GraphFrame,
} from '../shared/stream'
import { subscribeAgentView } from './agent-view'
import type { IndexPhase } from './indexing/project-index'
import { projectIndex } from './indexing/projects'

/**
 * The least time between two `indexing` frames to one tab. A parse reports every file, and each
 * frame costs the tab a snapshot read: about one a second keeps the bar moving for less than the
 * 1.5 s poll it replaces.
 */
const PROGRESS_FRAME_MS = 1000

export interface GraphWsFramesOptions {
  readonly progressFrameMs?: number
  /** Schedule `run` after `ms`; returns its cancel. Tests drive the pacing through this. */
  readonly setTimer?: (run: () => void, ms: number) => () => void
}

const realTimer = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

/**
 * The map's live stream (`shared/stream.ts`): an open tab subscribes for its chat and is pushed
 * the agent's requests, report requests, index revisions and paced indexing progress, instead of
 * polling for each.
 *
 * The project is resolved from the authenticated socket's user and the chat it names — host
 * authority, never a path from the client — the same way Project Space follows its board.
 */
export function createGraphWsFrames(
  dataDir: string,
  scope: Pick<WorkspaceScopeHost, 'resolveSessionRoot'>,
  options: GraphWsFramesOptions = {},
): { wsFrames: WsFrameContribution[]; onShutdown: () => void } {
  const progressFrameMs = options.progressFrameMs ?? PROGRESS_FRAME_MS
  const setTimer = options.setTimer ?? realTimer
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
              // Progress is paced: the first move goes at once, the latest of the rest when the
              // window closes. A finished refresh supersedes a move still waiting to go.
              let cancelPending: (() => void) | null = null
              let latest: IndexPhase | null = null
              const flush = () => {
                cancelPending = null
                if (!latest) return
                push({ sessionId, indexing: latest })
                latest = null
                cancelPending = setTimer(flush, progressFrameMs)
              }
              const offProgress = index.watchProgress((status) => {
                latest = status.phase ?? 'discovering'
                if (!cancelPending) flush()
              })
              const offIndex = index.subscribe((status) => {
                cancelPending?.()
                cancelPending = null
                latest = null
                push({ sessionId, revision: status.revision })
              })
              handle.release = () => {
                offAgent()
                offProgress()
                offIndex()
                cancelPending?.()
                cancelPending = null
              }
              // The tab's first read may have raced this subscription: a refresh that finished
              // in between announced nothing it heard. One revision frame closes that gap; a
              // refresh still running announces its own end.
              const now = index.snapshot()
              if (now.state !== 'indexing') push({ sessionId, revision: now.revision })
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
