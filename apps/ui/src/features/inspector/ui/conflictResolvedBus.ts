/**
 * Tiny pub/sub for "a file's disk-vs-edits conflict was resolved from its compare
 * tab — adopt this exact content into any open editor of that file".
 *
 * The conflict `compare` tab (disk ⟷ your edits) carries its own apply actions, but
 * it lives in a SEPARATE grid tab from the file's editor. When the user resolves
 * from the compare tab, a still-mounted editor of the same file must drop its
 * conflict banner and adopt the resolved content cleanly. This bus carries the
 * resolved snapshot to it. (In the usual single-editor-group flow the editor tab is
 * hidden/unmounted while the compare tab is shown, so it simply remounts fresh from
 * disk on refocus — the same result; this bus is the clean-refresh path for the
 * split/both-visible case.) Both publisher (ConflictCompareBar) and subscriber
 * (useFileEditor) live in this slice, so no cross-layer coupling.
 */

export interface ConflictResolution {
  /** Session that owns the editor/conflict tab. */
  sessionId: string
  /** Absolute path of the reconciled file (matches the editor's `editPath`). */
  editPath: string
  /** Editor snapshot the compare tab was opened against. */
  expectedBuffer: string
  /** The content the editor should now hold (the winning side). */
  content: string
  /** Its on-disk concurrency token (the hash the next save must echo). */
  hash: string
}

type Listener = (resolution: ConflictResolution) => void

const listeners = new Set<Listener>()

/** Ownership predicate used by editors before adopting a resolved snapshot. */
export function conflictResolutionMatches(
  sessionId: string | null,
  editPath: string,
  resolution: ConflictResolution,
): boolean {
  return resolution.sessionId === sessionId && resolution.editPath === editPath
}

/** Preserve edits made after the compare snapshot instead of overwriting them. */
export function shouldAdoptConflictResolution(
  currentBuffer: string,
  resolution: ConflictResolution,
): boolean {
  return currentBuffer === resolution.expectedBuffer
}

/** Announce that a file's conflict was resolved to `content` (@ `hash`) on disk. */
export function publishConflictResolved(resolution: ConflictResolution): void {
  for (const l of listeners) l(resolution)
}

/** Subscribe to conflict resolutions; returns an unsubscribe fn. */
export function onConflictResolved(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
