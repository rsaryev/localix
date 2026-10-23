import type { WsFrameContribution } from '@localixai/mini-app-sdk/backend'

import { HISTORY_FRAME_TAG, HISTORY_SUBSCRIBE, HISTORY_UNSUBSCRIBE } from '../shared/history-stream'
import type { HistoryWatch } from './live/history-watch'

/**
 * The roster's live stream (`shared/history-stream.ts`): an open panel subscribes and is pushed a
 * notice when an agent's history moved, instead of re-enumerating every root on a timer to find out.
 *
 * Machine-wide like the roster itself, so one key per socket; the watch is shared by every socket
 * and armed only while one is subscribed.
 */
export function createHistoryWsFrames(history: () => HistoryWatch): {
  wsFrames: WsFrameContribution[]
  onShutdown: () => void
} {
  const active = new Set<{ release: () => void }>()
  const stop = (handle: { release: () => void }) => {
    handle.release()
    handle.release = () => {}
    active.delete(handle)
  }
  return {
    wsFrames: [
      {
        subscribeCommand: HISTORY_SUBSCRIBE,
        unsubscribeCommand: HISTORY_UNSUBSCRIBE,
        frameTag: HISTORY_FRAME_TAG,
        key: () => 'history',
        start(_params, send) {
          const handle = { release: () => {} }
          handle.release = history().subscribe((frame) => send(JSON.stringify(frame)))
          active.add(handle)
          return handle
        },
        stop(handle) {
          stop(handle as { release: () => void })
        },
      },
    ],
    // Registry removal only blocks new subscribes; release the live ones on a hot disable too.
    onShutdown: () => {
      for (const handle of active) stop(handle)
    },
  }
}
