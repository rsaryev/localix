/**
 * Whether the mods band above the composer turns its pages on its own (Settings → Preferences →
 * Mods band). A band has more than one page when a mod's drawing hides the mods after it; turning
 * slowly, and only while the person is not using the composer, lets every mod be seen without a
 * click. On by default, because a hidden mod is otherwise never seen; the band pauses on hover,
 * focus, typing and a running turn, and never moves with reduced motion.
 *
 * A browser-only preference module beside `railRecentsPref.ts`.
 */

import { useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

const STORAGE_KEY = 'localix.modBand.rotate'

let rotate = loadString(STORAGE_KEY) !== 'off'
const listeners = new Set<() => void>()

export function getModBandRotation(): boolean {
  return rotate
}

/** Turn rotation on or off, persist it, and notify subscribers. */
export function setModBandRotation(next: boolean): void {
  if (next === rotate) return
  rotate = next
  // The default is stored as an absent key, so a future change of default follows.
  saveString(STORAGE_KEY, next ? null : 'off')
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useModBandRotation(): boolean {
  return useSyncExternalStore(subscribe, getModBandRotation, getModBandRotation)
}
