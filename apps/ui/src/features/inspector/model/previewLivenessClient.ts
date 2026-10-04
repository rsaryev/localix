import { eventSocket } from '@/shared/api/eventSocket'

/**
 * Client half of server-owned preview liveness: the pane SUBSCRIBES to an endpoint instead
 * of interrogating it.
 *
 * What this replaces was a `no-cors` GET at the preview URL every three seconds from every
 * open tab — real traffic into the user's own app, answerable from the browser's cache, and
 * unable to see the fact the API already holds (the process serving it exited). The API
 * watches the endpoint once for the whole machine and pushes transitions; see
 * `features/liveness/preview-liveness.ts`.
 *
 * Refcounted per url so several panes on one preview share one server subscription, and
 * re-subscribed after a reconnect, because a new socket carries none of the old one's
 * streams. An endpoint the server refuses to watch (anything not loopback or private) is
 * answered with `watchable: false` — the caller keeps its own check for that case, which is
 * also what a server too old to know this command produces.
 */

/** Wire tag of the liveness frame stream (must match `PREVIEW_LIVENESS_FRAME_TAG`). */
const FRAME_TAG = 'v'
const SUBSCRIBE = 'preview.liveness.subscribe'
const UNSUBSCRIBE = 'preview.liveness.unsubscribe'

export interface PreviewLivenessUpdate {
  /** `null` while the server has no answer yet — never the same as "down". */
  alive: boolean | null
  /** False when this endpoint is not the server's to watch. */
  watchable: boolean
}

type Listener = (update: PreviewLivenessUpdate) => void

interface Entry {
  listeners: Set<Listener>
  /** Last update, replayed to a late subscriber so a second pane never waits for a change. */
  last: PreviewLivenessUpdate | null
}

const entries = new Map<string, Entry>()
let unsubscribeFrames: (() => void) | null = null
let unsubscribeReconnect: (() => void) | null = null

const deliver = (entry: Entry, update: PreviewLivenessUpdate) => {
  entry.last = update
  for (const listener of entry.listeners) listener(update)
}

function onFrame(json: string): void {
  let frame: { url?: unknown; watchable?: unknown; alive?: unknown }
  try {
    frame = JSON.parse(json) as typeof frame
  } catch {
    return
  }
  const entry = typeof frame.url === 'string' ? entries.get(frame.url) : undefined
  if (!entry) return
  deliver(entry, {
    alive: typeof frame.alive === 'boolean' ? frame.alive : null,
    watchable: frame.watchable !== false,
  })
}

function sendSubscribe(url: string): void {
  void eventSocket.request({ t: SUBSCRIBE, url }).catch(() => {
    // No such command (an older server) or a socket that went away mid-send: say the endpoint
    // is not being watched so the caller falls back rather than waiting on a stream that will
    // never arrive.
    const entry = entries.get(url)
    if (entry) deliver(entry, { alive: null, watchable: false })
  })
}

function retainTransport(): void {
  if (unsubscribeFrames) return
  unsubscribeFrames = eventSocket.onFrame(FRAME_TAG, onFrame)
  unsubscribeReconnect = eventSocket.onReconnect(() => {
    for (const url of entries.keys()) sendSubscribe(url)
  })
}

function releaseTransport(): void {
  if (entries.size > 0) return
  unsubscribeFrames?.()
  unsubscribeFrames = null
  unsubscribeReconnect?.()
  unsubscribeReconnect = null
}

/** Watch one preview url. The returned function releases this listener's share. */
export function watchPreviewLiveness(url: string, listener: Listener): () => void {
  let entry = entries.get(url)
  const first = entry === undefined
  if (!entry) {
    entry = { listeners: new Set(), last: null }
    entries.set(url, entry)
  }
  entry.listeners.add(listener)
  retainTransport()
  if (entry.last) listener(entry.last)
  if (first) sendSubscribe(url)

  let released = false
  return () => {
    // React runs cleanup twice under StrictMode; a second decrement would drop a
    // subscription another mounted pane still owns.
    if (released) return
    released = true
    const current = entries.get(url)
    if (!current) return
    current.listeners.delete(listener)
    if (current.listeners.size > 0) return
    entries.delete(url)
    void eventSocket.request({ t: UNSUBSCRIBE, url }).catch(() => {})
    releaseTransport()
  }
}

/** Test seam: drop every subscription and detach from the socket. */
export function resetPreviewLivenessForTests(): void {
  entries.clear()
  releaseTransport()
}
