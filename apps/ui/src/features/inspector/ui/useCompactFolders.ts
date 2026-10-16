import { useCallback, useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'

// "Compact folders" folds a run of single-directory-child folders into one
// breadcrumb row. It is
// DEFAULT-ON and a per-user preference persisted in localStorage,
// toggled from the file-tree header overflow menu. A tiny external store keeps the
// tree in sync without threading the flag through global settings.
const KEY = 'localix.fileTree.compactFolders'
const listeners = new Set<() => void>()
let enabled = readInitial()

function readInitial(): boolean {
  return loadString(KEY) !== '0' // default ON unless explicitly disabled
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setEnabled(next: boolean) {
  if (next === enabled) return
  enabled = next
  saveString(KEY, next ? '1' : '0')
  for (const fn of listeners) fn()
}

/** `[enabled, toggle]` for compact folders, persisted across sessions. */
export function useCompactFolders(): [boolean, () => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => enabled,
    () => true,
  )
  const toggle = useCallback(() => setEnabled(!enabled), [])
  return [value, toggle]
}
