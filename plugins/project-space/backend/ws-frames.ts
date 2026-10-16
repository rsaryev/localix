import type { WorkspaceScopeHost, WsFrameContribution } from '@localixai/plugin-sdk/backend'
import { SPACE_FRAME_TAG, SPACE_SUBSCRIBE, SPACE_UNSUBSCRIBE } from '../shared/resource'
import { spaceStore } from './space-store'

/** Follow the authorized chat's project, so edits from other chats and the agent arrive too. */
export function createSpaceWsFrames(scope: Pick<WorkspaceScopeHost, 'resolveSessionRoot'>): {
  wsFrames: WsFrameContribution[]
  onShutdown: () => void
} {
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
        subscribeCommand: SPACE_SUBSCRIBE,
        unsubscribeCommand: SPACE_UNSUBSCRIBE,
        frameTag: SPACE_FRAME_TAG,
        key: (params) => (typeof params.sessionId === 'string' ? params.sessionId : 'invalid'),
        start(params, send, { userId }) {
          const handle = { stopped: false, release: () => {} }
          const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null
          if (!sessionId) return handle
          active.add(handle)
          void scope
            .resolveSessionRoot(userId, sessionId)
            .then((root) => {
              if (!root || handle.stopped) return
              handle.release = spaceStore.subscribe(root, (revision) =>
                send(JSON.stringify({ sessionId, revision })),
              )
            })
            .catch(() => {})
          return handle
        },
        stop(handle) {
          stop(handle as Handle)
        },
      },
    ],
    // Registry removal only blocks new subscribes. Release existing sockets on hot disable too.
    onShutdown: () => {
      for (const handle of active) stop(handle)
    },
  }
}
