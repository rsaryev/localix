import type { ModScene } from '../contracts'
import type { VmClock } from '../isolation/mod-vm'
import { disposeOf, keyOf, type Live } from './live-hosts'

/**
 * How long a conversation's mods host is kept (`session-host.ts`). One unused for `idleMs` goes,
 * `session.end` heard as a resume, unless it is in use — its turn runs, or work the screen started
 * in it does (`holding`) — or a pane of its mods is open. Past `maxHosts`, the conversations'
 * hosts used least recently go, but one in use. The workspace's host is not a conversation's: it
 * neither idles nor counts toward the limit.
 */

export interface HostKeepingDeps {
  /** The hosts by key, the most recently used last. */
  live: Map<string, Live>
  clock: VmClock
  idleMs: number
  maxHosts: number
  /** The conversation's running turn, while it runs. */
  turnOf?: (scene: ModScene) => unknown
}

export function createHostKeeping(deps: HostKeepingDeps) {
  const { live } = deps
  /** Work running in a host outside a turn, by host key. */
  const holds = new Map<string, number>()
  /** What waits for a key's work to end (`released`). */
  const waiting = new Map<string, Array<() => void>>()
  const busy = (key: string, entry: Live) => holds.has(key) || !!deps.turnOf?.(entry.scene)

  /** `entry` was used: its idle time starts again. */
  function touch(key: string, entry: Live) {
    entry.idle?.()
    if (!entry.scene.sessionId) return
    entry.idle = deps.clock.setTimer(() => {
      if (live.get(key) !== entry) return
      if (busy(key, entry) || entry.ready?.kit.ui.panes.list().length) return touch(key, entry)
      live.delete(key)
      void disposeOf(entry, 'resume')
    }, deps.idleMs)
  }

  async function evict() {
    const chats = [...live].filter(([, entry]) => entry.scene.sessionId)
    let over = chats.length - deps.maxHosts
    for (const [key, entry] of chats) {
      if (over <= 0) return
      if (busy(key, entry)) continue
      over -= 1
      live.delete(key)
      await disposeOf(entry)
    }
  }

  /** `work` runs in the scene's host, which is kept while it runs, as a turn keeps it. */
  async function holding<T>(scene: ModScene, work: () => Promise<T>): Promise<T> {
    const key = keyOf(scene)
    holds.set(key, (holds.get(key) ?? 0) + 1)
    try {
      return await work()
    } finally {
      const left = holds.get(key)! - 1
      if (left === 0) {
        holds.delete(key)
        for (const release of waiting.get(key) ?? []) release()
        waiting.delete(key)
      } else holds.set(key, left)
      const kept = live.get(key)
      if (kept) touch(key, kept)
    }
  }

  /** Settles once no work holds `key`'s host: at once when none does. */
  function released(key: string): Promise<void> {
    if (!holds.has(key)) return Promise.resolve()
    return new Promise((resolve) => waiting.set(key, [...(waiting.get(key) ?? []), resolve]))
  }

  return { touch, evict, holding, released }
}
