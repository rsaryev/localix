// Global OS-file drop guard — installed on BOTH web and desktop (app/main.tsx).
// The desktop shell keeps Tauri's native drag-drop handler DISABLED (it would
// swallow every webview drop, including in-page HTML5 DnD — see lib.rs), so
// drops arrive here as normal HTML5 events on both platforms. Routing of an
// unclaimed drop lives in `fileDropRouter.ts`: desktop recovers the REAL paths
// from the drag pasteboard and opens files editable in place; web opens a
// read-only media viewer.
//
// Dropping a file (PDF, video, …) onto the window makes the webview/browser
// navigate to `file://…/foo.pdf` by DEFAULT — a bare native file view that
// replaces the WHOLE app. The composer reads dropped files in its own handler
// (attach-to-chat); every other drop should OPEN the file in its in-app viewer.
//
// Why CAPTURE phase (this is the fix for "the UI disappears / a native browser
// view takes over"): a bubble-phase window listener is unreliable because
//  - editors (Monaco / xterm) `stopPropagation` on drag events, so
//    a drop over them never bubbles up to the window → nothing preventDefaults →
//    the browser navigates;
//  - the same for any widget that stops propagation.
// Listening on `window` in the CAPTURE phase runs the guard FIRST — before any
// child can swallow the event — so `preventDefault()` reliably kills the
// navigation everywhere in the top document, and drag detection is consistent
// instead of "sometimes it fires, sometimes not".
// (Drops that land INSIDE a same-origin <iframe> — the Preview / PDF viewer —
// are dispatched to that iframe's own document and can't be caught from the
// parent; that's contained to the iframe, not the whole-app navigation above.)
//
// Routing (open-in-viewer vs let-the-composer-attach) is decided by the drop
// TARGET, not `defaultPrevented`: once the guard preventDefaults in capture to
// stop the navigation, `defaultPrevented` is always true and can no longer
// signal "a zone claimed this drop". So instead we SKIP routing when the drop
// lands inside an attach zone — the composer (`[data-focus-part="chat"]`) or any
// element that opts out with `data-osfile-attach`.
//
// Only OS-file drags are touched (`types` includes 'Files'). Every internal drag
// (tabs, file-tree rows, message bindings) rides a custom MIME and carries no
// files, so tab docking and @-ref linking are completely untouched.

import { routeDroppedFiles } from './fileDropRouter'
import { keepFileDropActive, resetFileDrop } from './fileDropActive'

// Re-export the shared overlay store so existing importers of the guard keep
// working (FileDropOverlay). The active-state lives in `fileDropActive.ts`.
export { getFileDropActive, subscribeFileDropActive } from './fileDropActive'

/** Whether a drag event carries OS files (vs an internal app drag). */
function hasOsFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types
  // DataTransfer.types is a DOMStringList/array-like — includes() may be missing.
  return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1
}

/**
 * True when a drop lands inside a zone that consumes the files itself, so the
 * router must NOT also open them: the composer (attach-to-chat), or anything
 * that opts out with `data-osfile-attach`.
 */
function isAttachZone(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-focus-part="chat"], [data-osfile-attach]') !== null
  )
}

// ── Drag-active state (drives the drop highlight overlay) ─────────────────────
// The active-state store lives in `fileDropActive.ts` (shared with the desktop
// Tauri drag module). The WEB guard drives it off the `dragover` heartbeat, NOT
// a dragenter/dragleave depth counter: the counter flickers badly because
// crossing a child fires an enter/leave storm and an <iframe>/editor swallows
// the pairs. `dragover` fires CONTINUOUSLY (~every frame) while a file hovers,
// so `keepFileDropActive` re-arms a short off-timer that only elapses once the
// drag ends. Rock-solid, no flicker.
const keepActive = keepFileDropActive
const resetDrag = resetFileDrop

/** Install the window-level OS-file drop guard + router. Call once at startup (WEB). */
export function installFileDropGuard(): void {
  if (typeof window === 'undefined') return

  // All listeners are CAPTURE (3rd arg `true`) so the guard runs before any
  // child element can stopPropagation the event.
  window.addEventListener(
    'dragenter',
    (e) => {
      if (hasOsFiles(e)) keepActive()
    },
    true,
  )

  window.addEventListener(
    'dragleave',
    (e) => {
      // Only a clean exit of the WINDOW (no element entered next) clears now;
      // otherwise the dragover heartbeat keeps the overlay alive (crossing a
      // child fires a stray leave we must ignore).
      if (hasOsFiles(e) && e.relatedTarget === null) resetDrag()
    },
    true,
  )

  // dragover MUST be prevented for a drop to fire at all — unconditionally for
  // OS-file drags, in capture, so an editor/iframe can't suppress it and leave
  // the browser to navigate. Internal drags carry no files, so their cursor
  // semantics (copy rows / move tabs) are untouched. It also drives the overlay:
  // continuous while a file hovers, so `keepActive` shows a flicker-free highlight.
  window.addEventListener(
    'dragover',
    (e) => {
      if (!hasOsFiles(e)) return
      e.preventDefault()
      keepActive()
    },
    true,
  )

  window.addEventListener(
    'drop',
    (e) => {
      if (!hasOsFiles(e)) return
      // Clear the highlight even when a zone claims the drop, so the overlay
      // never sticks after an attach.
      resetDrag()
      // Kill the browser's navigate-to-a-bare-file-view default — always, first.
      e.preventDefault()
      // A drop inside an attach zone (the composer) is read by that zone's own
      // handler; don't also open it in a viewer.
      if (isAttachZone(e.target)) return
      // A stray drop anywhere else → open the files in their in-app viewers.
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : []
      void routeDroppedFiles(files)
    },
    true,
  )

  // A drag cancelled with Esc (or ending off-window) never fires drop/leave here.
  window.addEventListener('dragend', resetDrag, true)
}
