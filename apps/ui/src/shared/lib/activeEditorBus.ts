/**
 * Tracks the save action of the most-recently-focused file editor so the native
 * File ▸ Save (Cmd+S) menu item can save it. The grid can hold
 * several editors at once (split groups), so "Save" targets whichever editor you
 * last focused.
 *
 * A `features/inspector` FileTab registers its `save` here on focus and clears it
 * on unmount; the `pages/chat` menu dispatcher calls {@link saveActiveEditor}.
 * Coordination through `shared` keeps the dependency arrow one-way, mirroring
 * {@link explorerBus}. This is purely additive over the editor's autosave.
 */

import { useCallback, useEffect, useRef } from 'react'

type SaveFn = () => void

let activeSave: SaveFn | null = null

/** Mark `save` as the active editor's save action (called on editor focus). */
export function setActiveEditorSave(save: SaveFn): void {
  activeSave = save
}

/**
 * Clear the active save if it's still `save` — call on unmount so a closed editor
 * never leaves a stale saver behind (a no-op if another editor took focus since).
 */
export function clearActiveEditorSave(save: SaveFn): void {
  if (activeSave === save) activeSave = null
}

/** Save the most-recently-focused editor, if any. No-op when no editor is active. */
export function saveActiveEditor(): void {
  activeSave?.()
}

/** Buffer changes replace `save`; native Save must retain focus and call the latest version. */
export function useActiveEditorSave(save: SaveFn): () => void {
  const latest = useRef(save)
  latest.current = save
  const focusedSave = useCallback(() => latest.current(), [])
  useEffect(() => () => clearActiveEditorSave(focusedSave), [focusedSave])
  return useCallback(() => setActiveEditorSave(focusedSave), [focusedSave])
}
