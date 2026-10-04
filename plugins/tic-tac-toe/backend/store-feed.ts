import { sep } from 'node:path'
import type { WsFrameContribution } from '@localixai/plugin-sdk/backend'
import { STORE_FRAME_TAG, storeFeedCommands, type StoreFrame } from '../shared/store-feed'
import { onStoreWrite } from './store'

/** A batch of writes (an agent's list of moves) folds into one nudge within this window. */
export const STORE_FEED_WINDOW_MS = 50

/**
 * The live half of `openJsonStore`: an open view subscribes to one scope and is nudged after every
 * write under it (`shared/store-feed.ts`), so it re-reads when something changed — the agent's
 * tool included — instead of polling to find out.
 *
 * The scope's folder comes from `resolveDir` with the socket's own user, never a path from the
 * client: for a chat it is the host's session storage, whose ownership check rejects a chat the
 * user does not own, so no socket can follow another person's board.
 *
 * Right after it starts listening a stream sends one nudge. A write that landed between the view's
 * last read and the subscription — or while the socket was down, before a reconnect resubscribed —
 * reached no listener; the first nudge makes the view re-read past it.
 */
export function createStoreFeed(options: {
  /** The plugin's name, which its commands and frames carry. */
  plugin: string
  /** The folder a scope's stores live in: a chat's (`sessionId`) or the plugin's own (`null`). */
  resolveDir: (userId: string, sessionId: string | null) => Promise<string | null>
  windowMs?: number
}): { wsFrames: WsFrameContribution[]; onShutdown: () => void } {
  const windowMs = options.windowMs ?? STORE_FEED_WINDOW_MS
  const commands = storeFeedCommands(options.plugin)
  interface Handle {
    stopped: boolean
    timer: ReturnType<typeof setTimeout> | null
    release: () => void
  }
  const active = new Set<Handle>()
  const stop = (handle: Handle) => {
    handle.stopped = true
    if (handle.timer) clearTimeout(handle.timer)
    handle.timer = null
    handle.release()
    handle.release = () => {}
    active.delete(handle)
  }
  const sessionOf = (params: Record<string, unknown>) =>
    typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : null

  return {
    wsFrames: [
      {
        subscribeCommand: commands.subscribe,
        unsubscribeCommand: commands.unsubscribe,
        frameTag: STORE_FRAME_TAG,
        key: (params) => sessionOf(params) ?? '',
        start(params, send, { userId }) {
          const handle: Handle = { stopped: false, timer: null, release: () => {} }
          const sessionId = sessionOf(params)
          const frame: StoreFrame = { plugin: options.plugin, sessionId }
          const nudge = () => {
            if (handle.stopped || handle.timer) return
            handle.timer = setTimeout(() => {
              handle.timer = null
              if (!handle.stopped) send(JSON.stringify(frame))
            }, windowMs)
          }
          active.add(handle)
          void options
            .resolveDir(userId, sessionId)
            .then((dir) => {
              if (!dir || handle.stopped) return
              const prefix = dir.endsWith(sep) ? dir : `${dir}${sep}`
              handle.release = onStoreWrite((path) => {
                if (path.startsWith(prefix)) nudge()
              })
              nudge()
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
