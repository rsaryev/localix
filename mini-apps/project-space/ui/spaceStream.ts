import { workspacePathsTouch } from '@localixai/mini-app-sdk/ui/file-resource-sync'
import { createRealtimeFeed } from '@localixai/mini-app-sdk/ui/realtime-feed'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import type { CameraFrame } from '../shared/camera'
import {
  BOARD_DIR,
  CAMERA_SUBSCRIBE,
  CAMERA_UNSUBSCRIBE,
  SPACE_FRAME_TAG,
  SPACE_SUBSCRIBE,
  SPACE_UNSUBSCRIBE,
} from '../shared/resource'

/** A workspace change at or under the board's folder — or a coarse one, which may include it. */
export function touchesBoard(paths: readonly string[] | null): boolean {
  return workspacePathsTouch(paths, BOARD_DIR)
}

/**
 * The half of the board's changes the stream cannot carry: an edit made to the board FILE — by
 * hand, by the agent's file tools, by a checkout — which no write through the backend announced.
 * The host's workspace watcher hears it; `live` says whether that watcher runs for this chat
 * (false for a remote one, or a failed watcher), so the reader keeps polling when it does not.
 */
export function watchBoardFile(
  sessionId: string,
  changed: () => void,
  live: (live: boolean) => void,
): () => void {
  try {
    return miniAppFiles.watchWorkspace(
      sessionId,
      ({ paths }) => {
        if (touchesBoard(paths)) changed()
      },
      { onLive: live },
    )
  } catch {
    live(false) // a host without the runtime: the poll is all there is
    return () => {}
  }
}

/**
 * The board's revision stream: one subscription per chat's board mirror, and no full-board frame
 * payload — a frame names the new revision and the mirror re-reads. Its `live` (the host took the
 * subscribe, and the socket has not dropped since) is what lets a reader stop polling: the board's
 * 10 s poll ran beside a live stream for as long as a board stayed open, re-reading a document
 * every change of which the stream already announced.
 */
export const spaceFeed = createRealtimeFeed<string, { sessionId: string; revision: string }>({
  tag: SPACE_FRAME_TAG,
  subscribe: (sessionId) => ({ t: SPACE_SUBSCRIBE, sessionId }),
  unsubscribe: (sessionId) => ({ t: SPACE_UNSUBSCRIBE, sessionId }),
  decode: (json) => {
    const event = JSON.parse(json) as { sessionId?: unknown; revision?: unknown }
    return typeof event.sessionId === 'string' && typeof event.revision === 'string'
      ? { sessionId: event.sessionId, revision: event.revision }
      : null
  },
  route: (event) => event.sessionId,
})

/**
 * The agent's camera moves for one chat's board (`backend/camera-hub.ts`), pushed on the board's
 * tag as they are sent. Its own subscription, so only a mounted board counts as listening.
 */
export const cameraFeed = createRealtimeFeed<string, CameraFrame>({
  tag: SPACE_FRAME_TAG,
  subscribe: (sessionId) => ({ t: CAMERA_SUBSCRIBE, sessionId }),
  unsubscribe: (sessionId) => ({ t: CAMERA_UNSUBSCRIBE, sessionId }),
  decode: (json) => {
    const event = JSON.parse(json) as {
      sessionId?: unknown
      camera?: Partial<CameraFrame['camera']>
    }
    const camera = event.camera
    return typeof event.sessionId === 'string' &&
      typeof camera?.seq === 'number' &&
      typeof camera.move?.kind === 'string'
      ? { sessionId: event.sessionId, camera: camera as CameraFrame['camera'] }
      : null
  },
  route: (event) => event.sessionId,
})
