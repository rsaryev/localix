import { join, sep } from 'node:path'
import type { MiniAppPathWatch } from './context'
import type { WsFrameContribution } from './ws-frame-registry'
import { STORE_FRAME_TAG, storeFeedCommands, type StoreFrame } from '../store-changes'

export const STORE_FEED_WINDOW_MS = 50

/**
 * One authenticated invalidation feed for JSON stores. Domain stores announce after commit;
 * the host's native watcher covers file tools, external editors and atomic replacements.
 * Liveness proves source coverage, rather than merely acknowledging the subscribe command.
 * Deliberately not durable (unlike `host.changes`): a view reads again on reconnect, so a
 * history would cost a database row per write and buy nothing.
 */
export function createStoreChangeFeed(options: {
  miniApp: string
  resolveDir: (userId: string, sessionId: string | null) => Promise<string | null>
  subscribeWrites: (listener: (path: string) => void) => () => void
  watchPath?: MiniAppPathWatch
  /** Refresh domain caches before a filesystem-triggered read. */
  onExternalChange?: (userId: string) => void
  acceptPath?: (userId: string, path: string) => boolean
  windowMs?: number
}): { wsFrames: WsFrameContribution[]; onShutdown: () => void } {
  const commands = storeFeedCommands(options.miniApp)
  const active = new Set<{
    stopped: boolean
    timer: ReturnType<typeof setTimeout> | null
    releases: Array<() => void>
  }>()
  type Handle = {
    stopped: boolean
    timer: ReturnType<typeof setTimeout> | null
    releases: Array<() => void>
  }
  const stop = (handle: Handle) => {
    handle.stopped = true
    if (handle.timer) clearTimeout(handle.timer)
    for (const release of handle.releases) release()
    handle.releases = []
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
          const handle: Handle = { stopped: false, timer: null, releases: [] }
          const sessionId = sessionOf(params)
          const frame: StoreFrame = { miniApp: options.miniApp, sessionId }
          const health = (live: boolean) => {
            if (!handle.stopped) send(JSON.stringify({ ...frame, live }))
          }
          const nudge = () => {
            if (handle.stopped || handle.timer) return
            handle.timer = setTimeout(() => {
              handle.timer = null
              if (!handle.stopped) send(JSON.stringify(frame))
            }, options.windowMs ?? STORE_FEED_WINDOW_MS)
          }
          active.add(handle)
          void options
            .resolveDir(userId, sessionId)
            .then((dir) => {
              if (!dir || handle.stopped) {
                health(false)
                return
              }
              const prefix = dir.endsWith(sep) ? dir : `${dir}${sep}`
              handle.releases.push(
                options.subscribeWrites((path) => {
                  if (
                    path.startsWith(prefix) &&
                    (!options.acceptPath || options.acceptPath(userId, path))
                  )
                    nudge()
                }),
              )
              let failed = !options.watchPath
              if (options.watchPath) {
                handle.releases.push(
                  options.watchPath(
                    dir,
                    true,
                    (name) => {
                      if (
                        name &&
                        options.acceptPath &&
                        !options.acceptPath(userId, join(dir, name))
                      )
                        return
                      try {
                        options.onExternalChange?.(userId)
                      } catch {
                        health(false)
                      }
                      nudge()
                    },
                    () => {
                      failed = true
                      health(false)
                      nudge()
                    },
                  ),
                )
              }
              health(!failed)
              // Close the snapshot-to-subscription gap, and reconcile after reconnect.
              nudge()
            })
            .catch(() => health(false))
          return handle
        },
        stop: (handle) => stop(handle as Handle),
      },
    ],
    onShutdown: () => {
      for (const handle of active) stop(handle)
    },
  }
}
