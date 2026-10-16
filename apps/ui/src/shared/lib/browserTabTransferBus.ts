import { useSyncExternalStore } from 'react'

export type BrowserTabTransferDestination = 'window' | 'tab'
export interface BrowserTabDrag {
  sessionId: string
  pageId: string
}
interface BrowserTabTransferPort {
  available: () => boolean
  move: (page: BrowserTabDrag, destination: BrowserTabTransferDestination) => Promise<boolean>
  finishOutside: (
    page: BrowserTabDrag,
    event: DragEvent | null,
    cancelled: boolean,
  ) => Promise<void>
}

let port: BrowserTabTransferPort | null = null
let snapshot: { drag: BrowserTabDrag | null; pending: ReadonlySet<string>; available: boolean } = {
  drag: null,
  pending: new Set(),
  available: false,
}
const listeners = new Set<() => void>()
function publish(next: typeof snapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The Browser feature names a page; the workbench supplies native window movement. */
export const browserTabTransferBus = {
  subscribe,
  register(next: BrowserTabTransferPort): () => void {
    const previous = port
    port = next
    publish({ ...snapshot, available: next.available() })
    return () => {
      if (port !== next) return
      port = previous
      publish({ ...snapshot, drag: null, available: previous?.available() ?? false })
    }
  },
  start(page: BrowserTabDrag) {
    publish({ ...snapshot, drag: page })
  },
  end() {
    if (snapshot.drag) publish({ ...snapshot, drag: null })
  },
  pending: (pageId: string) => snapshot.pending.has(pageId),
  setPending(pageId: string, active: boolean) {
    const pending = new Set(snapshot.pending)
    if (active) pending.add(pageId)
    else pending.delete(pageId)
    publish({ ...snapshot, pending })
  },
  move: (page: BrowserTabDrag, destination: BrowserTabTransferDestination) =>
    port?.move(page, destination) ?? Promise.resolve(false),
  finishOutside: (page: BrowserTabDrag, event: DragEvent | null, cancelled: boolean) =>
    port?.finishOutside(page, event, cancelled) ?? Promise.resolve(),
  get: () => snapshot,
}

export function useBrowserTabTransferState() {
  return useSyncExternalStore(subscribe, browserTabTransferBus.get, browserTabTransferBus.get)
}
