// Pure composer-dropzone drag state — kept out of the hook so the flaky bits
// (kind routing + dragenter/dragleave depth pairing) are unit-testable.
import {
  messageBindingDragKind,
  OS_FILES_DRAG_KIND,
  WORKSPACE_TAB_DRAG_MIME,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'

export interface DragAcceptOptions {
  /** The host accepts context-binding drops (files, sessions, tool calls, …). */
  messageBinding: boolean
  /** OS file attachments are allowed (model has file input). */
  attach: boolean
}

/**
 * What kind of drag the composer would accept for this type list — an
 * message-binding kind (`file`/`session`/`terminal`/`call`/…), the OS-files
 * pseudo-kind, or `null` (not our drag; don't preventDefault, don't overlay).
 */
export function acceptedDragKind(types: readonly string[], opts: DragAcceptOptions): string | null {
  if (types.includes(WORKSPACE_TAB_DRAG_MIME)) return null
  const binding = messageBindingDragKind(types)
  if (binding && opts.messageBinding) return binding
  if (opts.attach && types.includes('Files')) return OS_FILES_DRAG_KIND
  return null
}

export interface DragDepth {
  /** dragenter — returns the new depth. */
  enter(): number
  /** dragleave — returns the remaining depth (0 = pointer fully left). */
  leave(): number
  /** drop / cancel / external clear. */
  reset(): void
  readonly value: number
}

/**
 * dragenter/dragleave pair counter. The composer subtree fires an
 * enter/leave STORM as the pointer crosses children (and `dragleave` on the
 * container often reports a CHILD as `target`, so `currentTarget === target`
 * checks miss and the overlay sticks). Counting pairs is the only robust
 * "did the pointer actually leave the dropzone" signal: enter on a child
 * fires BEFORE leave on its parent, so the depth never touches 0 until the
 * pointer exits the whole subtree. Never goes negative — an unmatched leave
 * (e.g. after an external reset) must not underflow into "still dragging".
 */
export function createDragDepth(): DragDepth {
  let depth = 0
  return {
    enter: () => ++depth,
    leave: () => (depth = Math.max(0, depth - 1)),
    reset: () => {
      depth = 0
    },
    get value() {
      return depth
    },
  }
}
