import type {
  WorkspaceScopeHost,
  WsFrameContribution,
  WsFrameStreamContext,
} from '@localixai/mini-app-sdk/backend'
import type { CameraFrame } from '../shared/camera'
import {
  CAMERA_SUBSCRIBE,
  CAMERA_UNSUBSCRIBE,
  SPACE_FRAME_TAG,
  SPACE_SUBSCRIBE,
  SPACE_UNSUBSCRIBE,
} from '../shared/resource'
import { cameraHub } from './camera-hub'
import { spaceStore } from './space-store'

/**
 * The board's two streams, on one tag: the authorized chat's project revisions (so edits from
 * other chats and the agent arrive too), and the agent's camera moves for that chat's open tab.
 * The camera is its own subscription because only a mounted board takes moves: `listening` on
 * the hub must count boards, not every surface that follows the board's revisions.
 */
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
  /** Attach only once the socket's user is known to work in the chat it names. */
  const authorized =
    (attach: (root: string, sessionId: string, send: (data: string) => void) => () => void) =>
    (params: Record<string, unknown>, send: (data: string) => void, ctx: WsFrameStreamContext) => {
      const handle: Handle = { stopped: false, release: () => {} }
      const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null
      if (!sessionId) return handle
      active.add(handle)
      void scope
        .resolveSessionRoot(ctx.userId, sessionId)
        .then((root) => {
          if (!root || handle.stopped) return
          handle.release = attach(root, sessionId, send)
        })
        .catch(() => {})
      return handle
    }
  const key = (params: Record<string, unknown>) =>
    typeof params.sessionId === 'string' ? params.sessionId : 'invalid'
  return {
    wsFrames: [
      {
        subscribeCommand: SPACE_SUBSCRIBE,
        unsubscribeCommand: SPACE_UNSUBSCRIBE,
        frameTag: SPACE_FRAME_TAG,
        key,
        start: authorized((root, sessionId, send) =>
          spaceStore.subscribe(root, (revision) => send(JSON.stringify({ sessionId, revision }))),
        ),
        stop(handle) {
          stop(handle as Handle)
        },
      },
      {
        subscribeCommand: CAMERA_SUBSCRIBE,
        unsubscribeCommand: CAMERA_UNSUBSCRIBE,
        frameTag: SPACE_FRAME_TAG,
        key,
        start: authorized((_root, sessionId, send) =>
          cameraHub.follow(sessionId, (camera) =>
            send(JSON.stringify({ sessionId, camera } satisfies CameraFrame)),
          ),
        ),
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
