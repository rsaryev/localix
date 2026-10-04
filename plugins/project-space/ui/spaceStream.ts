import { createRealtimeFeed } from '@localixai/plugin-sdk/ui/realtime-feed'
import { pluginFiles } from '@localixai/plugin-sdk/ui/runtime'
import { BOARD_DIR, SPACE_FRAME_TAG, SPACE_SUBSCRIBE, SPACE_UNSUBSCRIBE } from '../shared/resource'

/** A workspace change at or under the board's folder — or a coarse one, which may include it. */
export function touchesBoard(paths: readonly string[] | null): boolean {
  if (paths === null) return true
  const marker = `/${BOARD_DIR}`
  return paths.some((path) => {
    const posix = path.replaceAll('\\', '/')
    const at = posix.indexOf(marker)
    const next = at < 0 ? '' : posix[at + marker.length]
    return at >= 0 && (next === undefined || next === '/')
  })
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
    return pluginFiles.watchWorkspace(
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
