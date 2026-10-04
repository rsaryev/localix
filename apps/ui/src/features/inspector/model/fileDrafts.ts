/**
 * Unsaved-buffer drafts, keyed by owning session + resolved file path — module
 * state that OUTLIVES a FileTab unmount. The editor grid renders only the ACTIVE
 * tab of a group, so switching tabs unmounts the editor component; without this
 * store the unsaved buffer died with it and the user's edits silently vanished.
 * Session ownership is load-bearing: two non-isolated sessions can resolve the
 * same absolute path but must not adopt each other's editor drafts. Now:
 *
 *  - while a buffer is DIRTY, `useFileEditor` mirrors it here on every change;
 *  - when it goes clean (saved / reloaded / discarded), the draft is cleared;
 *  - on mount, a fresh load ADOPTS a matching draft over the disk content (the
 *    disk snapshot stays the save baseline, so the buffer re-opens dirty and the
 *    normal save / conflict machinery applies).
 *
 * Never persisted — a page reload starts clean (matching the previous,
 * pre-draft behavior).
 */

const drafts = new Map<string, string>()

/** Collision-safe owner key shared by drafts and the editor's reload coordinator. */
export function fileEditorOwnerKey(sessionId: string, path: string): string {
  return JSON.stringify([sessionId, path])
}

/** Mirror a dirty buffer (called on every change while dirty — Map.set is cheap). */
export function setFileDraft(sessionId: string, path: string, content: string): void {
  if (sessionId && path) drafts.set(fileEditorOwnerKey(sessionId, path), content)
}

/** Drop a draft once its buffer is clean again (saved / adopted / discarded). */
export function clearFileDraft(sessionId: string, path: string): void {
  drafts.delete(fileEditorOwnerKey(sessionId, path))
}

/** The unsaved draft for a path, or undefined when the buffer was clean. */
export function getFileDraft(sessionId: string, path: string): string | undefined {
  return drafts.get(fileEditorOwnerKey(sessionId, path))
}
