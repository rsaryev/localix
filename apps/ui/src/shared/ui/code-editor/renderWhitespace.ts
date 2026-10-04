// Global whitespace-rendering preference for the code editor.
// A single boolean shared across every mounted
// editor so toggling in one renders middots/arrows for spaces & tabs in them all,
// persisted to localStorage so it survives reloads. Pure browser-only module (no
// `features`/`shared/api`/store import) — belongs in the lowest FSD layer alongside the
// other editor preferences, mirroring `wordWrap.ts`.
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'

const STORAGE_KEY = 'localix.editor.renderWhitespace'

let enabled = readInitial()
const listeners = new Set<(value: boolean) => void>()

function readInitial(): boolean {
  return loadString(STORAGE_KEY) === '1'
}

/** Current whitespace-rendering state. */
export function getRenderWhitespace(): boolean {
  return enabled
}

/** Set whitespace rendering, persist it, and notify every mounted editor. No-op when unchanged. */
export function setRenderWhitespace(value: boolean): void {
  if (value === enabled) return
  enabled = value
  saveString(STORAGE_KEY, value ? '1' : '0')
  for (const fn of listeners) fn(enabled)
}

/** Flip whitespace rendering; returns the new value. */
export function toggleRenderWhitespace(): boolean {
  setRenderWhitespace(!enabled)
  return enabled
}

/** Subscribe to whitespace-rendering changes; returns an unsubscribe fn. */
export function subscribeRenderWhitespace(fn: (value: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
