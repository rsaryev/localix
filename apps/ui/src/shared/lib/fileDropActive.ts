// Shared "an OS file is being dragged over the window" active-state store,
// driving the `FileDropOverlay`. Fed by the HTML5 window guard
// (`fileDropGuard.ts`, installed on web AND desktop — the desktop shell keeps
// Tauri's native drag-drop disabled, so drops are plain DOM events there too).
//
// Driven by a HEARTBEAT (re-armed on every enter/over), NOT a dragenter/dragleave
// depth counter: the counter flickers because crossing a child fires an
// enter/leave storm and an <iframe>/editor swallows the pairs, so the overlay
// blinks. A re-armed short off-timer stays rock-solid: while a file hovers, the
// events keep firing so the timer never elapses; when the drag ends the events
// stop and the timer clears it.

const DRAG_OFF_MS = 200

let active = false
let offTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function notify(next: boolean): void {
  if (active === next) return
  active = next
  for (const l of listeners) l()
}

/** True while an OS-file drag hovers the window — for the drop-highlight overlay. */
export function getFileDropActive(): boolean {
  return active
}

/** Subscribe to drag-active changes (useSyncExternalStore). Returns an unsubscribe. */
export function subscribeFileDropActive(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Show the overlay and (re)arm the auto-off timer — call on every drag enter/over. */
export function keepFileDropActive(): void {
  if (offTimer) clearTimeout(offTimer)
  notify(true)
  offTimer = setTimeout(() => {
    offTimer = null
    notify(false)
  }, DRAG_OFF_MS)
}

/** Clear the overlay immediately (drag left the window / dropped / cancelled). */
export function resetFileDrop(): void {
  if (offTimer) {
    clearTimeout(offTimer)
    offTimer = null
  }
  notify(false)
}
