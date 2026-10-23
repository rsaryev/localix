import type { SpaceView } from '../shared/api'
import { spaceApi } from './api'
import { settle } from './settle'
import { spaceFeed, watchBoardFile } from './spaceStream'

interface Entry {
  view: SpaceView | null
  version: number
  pending: number
  queue: Promise<unknown>
  listeners: Set<(view: SpaceView, origin: 'read' | 'write') => void>
  reading: Promise<SpaceView> | null
  readingVersion: number
  readAt: number
  release: (() => void) | null
  connect: (() => void) | null
  watchers: number
  wantedRevision: string | null
  idleTimer: ReturnType<typeof setTimeout> | null
}

/** How often a board the realtime stream is not carrying re-reads itself. */
export const SPACE_POLL_MS = 10_000

const entries = new Map<string, Entry>()
function releaseIdle(sessionId: string, entry: Entry) {
  if (entry.listeners.size || entry.pending || entry.reading || entry.idleTimer) return
  // The add response can precede the destination mounting. Keep that short handoff warm, then
  // release an abandoned destination's full document instead of retaining it for the app's life.
  entry.idleTimer = setTimeout(() => {
    entry.idleTimer = null
    if (
      !entry.listeners.size &&
      !entry.pending &&
      !entry.reading &&
      entries.get(sessionId) === entry
    )
      entries.delete(sessionId)
  }, 30_000)
}
function publish(entry: Entry, view: SpaceView, origin: 'read' | 'write') {
  entry.connect?.()
  // Callbacks can mount another reader; publish to the subscriptions present at admission.
  const listeners = [...entry.listeners]
  for (const listener of listeners) {
    try {
      listener(view, origin)
    } catch {
      /* a reader cannot invalidate a completed save */
    }
  }
}
function entryFor(sessionId: string): Entry {
  let entry = entries.get(sessionId)
  if (!entry) {
    // Retain recent destinations for an add that opens a tab; mounted boards keep their entry.
    for (const [id, cached] of entries) {
      if (entries.size < 32) break
      if (!cached.pending && !cached.reading && !cached.listeners.size) {
        if (cached.idleTimer) clearTimeout(cached.idleTimer)
        entries.delete(id)
      }
    }
    entry = {
      view: null,
      version: 0,
      pending: 0,
      queue: Promise.resolve(),
      listeners: new Set(),
      reading: null,
      readingVersion: 0,
      readAt: 0,
      release: null,
      connect: null,
      watchers: 0,
      wantedRevision: null,
      idleTimer: null,
    }
    entries.set(sessionId, entry)
  }
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = null
  }
  return entry
}

export const savedSpaceView = (sessionId: string) => entries.get(sessionId)?.view ?? null
const spaceReadIsCurrent = (sessionId: string, version: number) => {
  const entry = entryFor(sessionId)
  return entry.pending === 0 && entry.version === version
}

export function subscribeSpaceUpdates(
  sessionId: string,
  listener: (view: SpaceView, origin: 'read' | 'write') => void,
) {
  const entry = entryFor(sessionId)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    releaseIdle(sessionId, entry)
  }
}

/** Share one read across every fragment and board; never regress a save with an older read. */
export function readSpace(sessionId: string, read: () => Promise<SpaceView>): Promise<SpaceView> {
  const entry = entryFor(sessionId)
  // A read invalidated by a write cannot also serve the subsequent read-back of that write.
  if (entry.reading && entry.readingVersion === entry.version) return entry.reading
  const version = entry.version
  entry.readingVersion = version
  const pending = read()
    .then((answer) => {
      if (!spaceReadIsCurrent(sessionId, version)) return entry.view ?? answer
      const next = settle(entry.view, answer)
      entry.readAt = Date.now()
      if (next !== entry.view) {
        entry.view = next
        publish(entry, next, 'read')
      }
      return next
    })
    .finally(() => {
      if (entry.reading === pending) entry.reading = null
      if (entry.wantedRevision && entry.view?.revision !== entry.wantedRevision && !entry.pending) {
        entry.wantedRevision = null
        void spaceApi.space(sessionId).catch(() => {})
      }
      releaseIdle(sessionId, entry)
    })
  entry.reading = pending
  return pending
}

/** Only active readers watch. Hundreds of fragment predicates share this one lifecycle. */
export function watchSpaceUpdates(sessionId: string, onChange: () => void) {
  const entry = entryFor(sessionId)
  const listener = () => onChange()
  entry.listeners.add(listener)
  entry.watchers++
  if (!entry.release && typeof document !== 'undefined') {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') void spaceApi.space(sessionId).catch(() => {})
    }
    const visible = () => {
      if (document.visibilityState !== 'hidden') refresh()
    }
    // The poll covers only what nothing else is carrying. Beside a live stream it re-read the
    // whole document every 10 s to learn what the stream had already said. Two signals together
    // leave it nothing: the stream for every write through the backend (a reconnect re-reads and
    // resubscribes), the workspace watcher for an edit to the board file itself. While either is
    // not live — before the backend advertised the stream, the socket down, a remote chat — it
    // polls.
    let timer: ReturnType<typeof setInterval> | null = null
    const live = { stream: false, file: false }
    const poll = () => {
      const on = !(live.stream && live.file)
      if (on && !timer) timer = setInterval(refresh, SPACE_POLL_MS)
      else if (!on && timer) {
        clearInterval(timer)
        timer = null
      }
    }
    const offFile = watchBoardFile(sessionId, refresh, (next) => {
      live.file = next
      poll()
    })
    let offStream: (() => void) | null = null
    // During a mini app update its UI can precede its backend. An unsupported WS command raises
    // a host notification, so wait for a successful HTTP response advertising the stream.
    entry.connect = () => {
      if (entry.view?.liveUpdates !== true) {
        offStream?.()
        offStream = null
        live.stream = false
        poll()
      } else if (!offStream) {
        offStream = spaceFeed.follow(sessionId, {
          frame: ({ revision }) => {
            if (entry.view?.revision === revision) return
            entry.wantedRevision = revision
            if (!entry.pending) refresh()
          },
          reconnect: refresh,
          live: (next) => {
            live.stream = next
            poll()
          },
        })
      }
    }
    poll()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', refresh)
    entry.release = () => {
      entry.connect = null
      offFile()
      live.stream = live.file = true // released: nothing left to poll for
      poll()
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('focus', refresh)
      offStream?.()
    }
    entry.connect()
    if (!entry.view || Date.now() - entry.readAt > SPACE_POLL_MS) refresh()
  }
  return () => {
    entry.listeners.delete(listener)
    entry.watchers--
    if (!entry.watchers) {
      entry.release?.()
      entry.release = null
    }
    releaseIdle(sessionId, entry)
  }
}

/**
 * A poll can return after a newer save and erase it on screen. Invalidate reads when a write
 * starts, serialize writes (including undo), and share the saved answer before opening its tab.
 * This follows the board mirror's write-through pattern in the kanban mini app.
 */
export function writeSpace<T extends SpaceView>(sessionId: string, write: () => Promise<T>) {
  const entry = entryFor(sessionId)
  entry.version++
  entry.pending++
  const next = entry.queue.then(async () => {
    try {
      const view = await write()
      entry.view = view
      entry.readAt = Date.now()
      entry.version++
      publish(entry, view, 'write')
      return view
    } catch (failure) {
      // A lost response may still have saved. Reconciliation must read after the uncertain write,
      // rather than join a poll that observed the document before the server committed it.
      entry.version++
      throw failure
    } finally {
      entry.pending--
      if (!entry.pending && entry.wantedRevision) {
        const revision = entry.wantedRevision
        entry.wantedRevision = null
        if (entry.view?.revision !== revision) void spaceApi.space(sessionId).catch(() => {})
      }
      releaseIdle(sessionId, entry)
    }
  })
  entry.queue = next.catch(() => undefined)
  return next
}
