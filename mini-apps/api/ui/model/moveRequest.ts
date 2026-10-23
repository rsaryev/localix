/**
 * Moving a request between folders — the drag the tree implies.
 *
 * The tree has shown folders since the collection became a directory, but the only way to move a
 * request was to rename it and type the new path by hand. Dragging is not only convenience: the
 * folder IS part of the name here, so "rename" and "move"
 * are the same operation and only one of them is discoverable.
 *
 * A ROW ALREADY HAS A DRAG. It carries a chat binding, so dropping a request into the composer
 * references it — and that must keep working. HTML5 drag data is a set of MIME types, not one
 * payload, so the row advertises both and each destination reads the one it understands. The
 * composer never sees a move; the tree never sees a binding.
 *
 * Pure module: the DOM handlers live in the tree, the rename call in the caller. What is here is
 * the part worth testing without either.
 */

import { isAtOrUnder } from '@localixai/path-containment/ancestry'

/** The transport for a request move. Distinct from the chat binding on the same drag. */
export const REQUEST_MOVE_MIME = 'application/x-localix-api-request-move'

/** The name of the request being dragged, or null when this drag is not one of ours. */
export function readMovedRequest(dataTransfer: Pick<DataTransfer, 'getData'>): string | null {
  const name = dataTransfer.getData(REQUEST_MOVE_MIME)
  return name ? name : null
}

/**
 * Where `name` lands when dropped on `folder` (`''` is the collection root), or null when the
 * move is a no-op or impossible.
 *
 * Null, not a throw, and not the unchanged name: the caller uses it to decide whether to light up
 * a drop target at all, and a folder that accepts a drag it will ignore is a worse lie than one
 * that refuses it.
 */
export function moveTarget(name: string, folder: string): string | null {
  const leaf = name.slice(name.lastIndexOf('/') + 1)
  const from = name.slice(0, Math.max(0, name.lastIndexOf('/')))
  if (from === folder) return null // already there
  // A folder cannot be dropped INTO ITSELF or into its own descendant. The tree drags leaves
  // today, so this cannot happen yet — but it is the invariant that stops a future folder drag
  // from detaching a subtree into a path underneath the node being moved.
  if (isAtOrUnder(`/${name}`, `/${folder}`)) return null
  return folder === '' ? leaf : `${folder}/${leaf}`
}
