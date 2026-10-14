/**
 * Dismissable — the ONE "show this once, remember they dismissed it" primitive.
 *
 * A first-use hint (an editor tip, a composer tip) should teach a feature IN the
 * context where it applies, then never nag again. Every such surface shares this
 * store instead of inventing its own flag: `useDismissable(key)` gives the live
 * dismissed state + a `dismiss()` that persists it.
 *
 * State is an in-memory cache backed by localStorage (`localix.dismissed.<key>`)
 * — the cache is the read source, so it works (and is testable) even where
 * storage is unavailable (private mode, quota, a non-DOM test runner), while a
 * real browser still remembers the dismissal across reloads.
 */

import { useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'

const PREFIX = 'localix.dismissed.'

/** Known hint keys — kept here so the surfaces can't drift apart or collide. */
export const HINT = {
  /** Editor: select code + ⌘K ⌘I to rewrite it with AI (keyboard-only, easy to miss). */
  /** Composer: AI drafts your next message as ghost text. */
  composerSuggest: 'hint.composer-suggest',
  /** Boards: how scroll, pinch and drag move the camera. One key for every board — one scheme. */
  canvasGestures: 'hint.canvas-gestures',
} as const

/** Cache is the read source; localStorage only seeds/persists it. */
const cache = new Map<string, boolean>()
const listeners = new Set<() => void>()

function read(key: string): boolean {
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const value = loadString(PREFIX + key) === '1'
  cache.set(key, value)
  return value
}

function emit(): void {
  for (const l of listeners) l()
}

/** Whether this hint has been dismissed. */
export function isDismissed(key: string): boolean {
  return read(key)
}

/** Dismiss the hint for good (persisted). Idempotent. */
export function dismiss(key: string): void {
  if (read(key)) return
  cache.set(key, true)
  saveString(PREFIX + key, '1')
  emit()
}

/** Un-dismiss — so a "reset hints" affordance (or a test) can bring it back. */
export function resetDismissed(key: string): void {
  if (!read(key)) return
  cache.set(key, false)
  saveString(PREFIX + key, null)
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Live dismissed-state for a hint key. Re-renders every subscribed surface when
 * the hint is dismissed anywhere, so two views of the same hint can't disagree.
 */
export function useDismissable(key: string): { dismissed: boolean; dismiss: () => void } {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => true, // SSR/no-DOM: never flash a hint
  )
  return { dismissed, dismiss: () => dismiss(key) }
}
