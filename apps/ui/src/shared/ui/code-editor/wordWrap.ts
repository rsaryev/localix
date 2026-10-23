// Global word-wrap preference for the code editor (Alt+Z). A single boolean shared across every mounted editor so toggling in one wraps
// them all, persisted to localStorage so it survives reloads. Pure browser-only module
// (no `features`/`shared/api`/store import) — belongs in the lowest FSD layer alongside
// the other editor preferences.
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

const STORAGE_KEY = 'localix.editor.wordWrap'

let enabled = readInitial()
const listeners = new Set<(value: boolean) => void>()

function readInitial(): boolean {
  return loadString(STORAGE_KEY) === '1'
}

/** Current word-wrap state. */
export function getWordWrap(): boolean {
  return enabled
}

/** Set word-wrap, persist it, and notify every mounted editor. No-op when unchanged. */
export function setWordWrap(value: boolean): void {
  if (value === enabled) return
  enabled = value
  saveString(STORAGE_KEY, value ? '1' : '0')
  for (const fn of listeners) fn(enabled)
}

/** Flip word-wrap; returns the new value. */
export function toggleWordWrap(): boolean {
  setWordWrap(!enabled)
  return enabled
}

/** Subscribe to word-wrap changes; returns an unsubscribe fn. */
export function subscribeWordWrap(fn: (value: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
