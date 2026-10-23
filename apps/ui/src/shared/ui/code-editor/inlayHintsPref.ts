// Global inlay-hints preference for the code editor.
// A single boolean shared across every mounted editor so toggling in one shows/hides the
// faint inferred-type & parameter-name annotations in them all, persisted to localStorage
// so it survives reloads. Defaults ON (parity with the always-on original behaviour) — the
// toggle exists only to silence them when they read as noise. Pure browser-only module (no
// `features`/`shared/api`/store import) — belongs in the lowest FSD layer alongside the
// other editor preferences, mirroring `wordWrap.ts` / `renderWhitespace.ts`.
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

const STORAGE_KEY = 'localix.editor.inlayHints'

let enabled = readInitial()
const listeners = new Set<(value: boolean) => void>()

function readInitial(): boolean {
  // Absent key → ON (the original always-on behaviour); only an explicit '0' disables.
  return loadString(STORAGE_KEY) !== '0'
}

/** Current inlay-hints state. */
export function getInlayHintsEnabled(): boolean {
  return enabled
}

/** Set inlay hints, persist it, and notify every mounted editor. No-op when unchanged. */
export function setInlayHintsEnabled(value: boolean): void {
  if (value === enabled) return
  enabled = value
  saveString(STORAGE_KEY, value ? '1' : '0')
  for (const fn of listeners) fn(enabled)
}

/** Flip inlay hints; returns the new value. */
export function toggleInlayHintsEnabled(): boolean {
  setInlayHintsEnabled(!enabled)
  return enabled
}

/** Subscribe to inlay-hints changes; returns an unsubscribe fn. */
export function subscribeInlayHintsEnabled(fn: (value: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
