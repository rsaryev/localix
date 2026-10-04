import { useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'

/** Unified (single-column) vs split (side-by-side) diff rendering. */
export type DiffViewMode = 'unified' | 'split'

const STORAGE_KEY = 'localix.diffViewMode'

function readInitial(): DiffViewMode {
  return loadString(STORAGE_KEY) === 'split' ? 'split' : 'unified'
}

// Module-level store so every mounted DiffView (single-file tab + each section of
// a multi-file commit/range diff) shares ONE preference and re-renders together
// when the toggle flips — the choice is a global reading preference, persisted to
// localStorage so it survives reloads.
let mode: DiffViewMode = readInitial()
const listeners = new Set<() => void>()

export function setDiffViewMode(next: DiffViewMode): void {
  if (next === mode) return
  mode = next
  saveString(STORAGE_KEY, next)
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Read the shared diff view mode; the setter persists + fans out to all instances. */
export function useDiffViewMode(): [DiffViewMode, (next: DiffViewMode) => void] {
  const current = useSyncExternalStore(
    subscribe,
    () => mode,
    () => mode,
  )
  return [current, setDiffViewMode]
}
