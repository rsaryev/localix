import { useEffect, type RefObject } from 'react'
import type { DirEntry } from '@/shared/api/contracts'
import { eventSocket } from '@/shared/api/eventSocket'
import { onFsChange } from '@/shared/lib/fsChangeBus'
import { createDirRefreshQueue } from '../lib/dirRefreshQueue'

/**
 * Keeps the loaded part of the tree equal to disk without a Refresh button.
 *
 * Three ways it would otherwise go stale, and the answer to each:
 *
 * - A change on disk (agent write, a terminal, a build, an external editor) arrives as an
 *   `fs.changed` frame naming the changed directories — or none, the COARSE "reload everything
 *   you have open". Only directories already loaded are re-read; collapsed/never-opened ones load
 *   fresh on their next expand.
 * - `fs.changed` is a live-only frame, so a change made while the socket was down is never
 *   replayed — and a server restart also took its watcher with it. On reconnect every loaded
 *   directory is re-read; each read re-arms the server's watcher (`listDirectory` arms it).
 * - The frame is delivered only for sessions the connection declares it is rendering, and the
 *   tree is such a surface whether or not a chat pane for the same session is mounted.
 *
 * All re-reads go through the refresh queue rather than a loop: a coarse frame over a deeply
 * expanded tree would otherwise issue one `listDirectory` per loaded folder at once, and coarse
 * frames are emitted precisely during heavy churn, when the machine is already busy. The queue
 * coalesces a burst of frames and caps the reads in flight.
 */
export function useLiveTreeRefresh(
  sessionId: string | null,
  childrenRef: RefObject<Record<string, DirEntry[]>>,
  reloadDir: (dir: string, options?: { quiet?: boolean }) => Promise<boolean>,
  /** The queue's coalesce window; a test passes 0 rather than wait it out. */
  refreshDelayMs?: number,
) {
  useEffect(() => {
    if (!sessionId) return
    // Quiet: a failed watch-driven refresh is churn, not news — see `reloadDir`.
    const queue = createDirRefreshQueue((dir) => reloadDir(dir, { quiet: true }), {
      delayMs: refreshDelayMs,
    })
    const reloadLoaded = () => queue.request(Object.keys(childrenRef.current))
    const offChange = onFsChange(({ sessionId: changed, paths }) => {
      if (changed !== sessionId) return
      if (!paths.length) return reloadLoaded()
      const loaded = childrenRef.current
      queue.request(paths.filter((p) => p in loaded))
    })
    const offReconnect = eventSocket.onReconnect(reloadLoaded)
    const unwatch = eventSocket.watchSession(sessionId)
    return () => {
      offChange()
      offReconnect()
      unwatch()
      queue.reset()
    }
  }, [sessionId, childrenRef, reloadDir, refreshDelayMs])
}
