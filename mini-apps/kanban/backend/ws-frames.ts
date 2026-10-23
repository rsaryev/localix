import type { WsFrameContribution } from '@localixai/mini-app-sdk/backend'

import { BOARD_FRAME_TAG, BOARD_SUBSCRIBE, BOARD_UNSUBSCRIBE } from '../shared/resource'
import type { BoardService } from './service'

/**
 * The live board: a view subscribes for ONE chat's board and receives every change to it as
 * `b\n<BoardEvent>`, whoever made it — the person in another window, or the agent's tool.
 *
 * The socket's user comes from the host, never from the params: a subscribe names only the
 * session, and the host's ownership check (inside the session folder's resolution) refuses a chat
 * the socket's user does not own. That check is asynchronous and a `stop` may arrive before it
 * settles, so the handle remembers a stop and releases the subscription the moment it exists.
 */
export function createBoardWsFrames(boards: BoardService): WsFrameContribution[] {
  const sessionOf = (params: Record<string, unknown>) =>
    typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : null

  return [
    {
      subscribeCommand: BOARD_SUBSCRIBE,
      unsubscribeCommand: BOARD_UNSUBSCRIBE,
      frameTag: BOARD_FRAME_TAG,
      key: (params) => sessionOf(params) ?? 'invalid',
      start(params, send, { userId }) {
        const handle = { stopped: false, release: () => {} }
        const sessionId = sessionOf(params)
        if (!sessionId) return handle
        void boards
          .subscribe({ userId, sessionId }, (event) => send(JSON.stringify(event)))
          .then((release) => {
            if (handle.stopped) release()
            else handle.release = release
          })
          .catch(() => {
            /* not this user's chat, or it is gone: nothing to follow */
          })
        return handle
      },
      stop(handle) {
        const live = handle as { stopped: boolean; release: () => void }
        live.stopped = true
        live.release()
      },
    },
  ]
}
