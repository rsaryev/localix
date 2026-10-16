/**
 * Tiny fan-out bus for "files changed on disk under a session's workspace". The chat
 * firehose router (features/chat) publishes a `fs.changed` frame here; the file-tree
 * sidebar (features/inspector) subscribes and refreshes the affected directories.
 *
 * Lives in `shared` so the two sibling features couple only through this mediator
 * (chat → shared ← inspector), never directly. Unlike `inspectorBus` — a single-
 * handler request channel owned by the inspector grid — this is a multi-subscriber
 * fan-out, because more than one view may care about a tree change.
 */

export interface FsChange {
  sessionId: string
  /** Absolute directory paths whose contents changed. EMPTY = coarse "reload all". */
  paths: string[]
  changedPaths?: string[] | null
  live?: boolean
}

type Listener = (change: FsChange) => void

const listeners = new Set<Listener>()

/** Announce a workspace file-tree change for a session. */
export function publishFsChange(change: FsChange): void {
  for (const l of listeners) l(change)
}

/** Subscribe to file-tree changes; returns an unsubscribe fn. */
export function onFsChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
