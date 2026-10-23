// Auto-save preference for the code editor (save after an idle delay).
// A single boolean shared across every open file editor: when on, a dirty buffer
// is saved through the SAME optimistic-concurrency save() path after a short idle
// delay. Persisted to localStorage so it survives reloads. Pure browser-only
// module (no `features`/`shared/api`/store import) — lives in the lowest FSD
// layer beside the other editor prefs (wordWrap, renderWhitespace) so both
// the inspector editor and the Settings toggle read it without a cross-slice dep.

import { useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

const STORAGE_KEY = 'localix.editor.autoSave'

/** Idle delay before an unsaved buffer is auto-saved. */
export const AUTO_SAVE_DELAY_MS = 1000

let enabled = readInitial()
const listeners = new Set<() => void>()

function readInitial(): boolean {
  return loadString(STORAGE_KEY) === '1'
}

/** Current auto-save state. */
export function getAutoSave(): boolean {
  return enabled
}

/** Set auto-save, persist it, and notify subscribers. No-op when unchanged. */
export function setAutoSave(value: boolean): void {
  if (value === enabled) return
  enabled = value
  saveString(STORAGE_KEY, value ? '1' : '0')
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Reactively read auto-save (re-renders on change). */
export function useAutoSave(): boolean {
  return useSyncExternalStore(subscribe, getAutoSave, getAutoSave)
}

/** The editor-state inputs that gate whether a debounced auto-save may fire. */
export interface AutoSaveGate {
  /** The auto-save preference is on. */
  enabled: boolean
  /** The buffer has unsaved edits. */
  dirty: boolean
  /** A save is already in flight. */
  saving: boolean
  /** An external-change conflict banner is up (409 / dirty divergence). */
  hasConflict: boolean
  /** The last save failed with a non-conflict error. */
  hasError: boolean
}

/**
 * Pure gate: should the debounced auto-save issue a save right now? Enabled +
 * dirty + idle only. A conflict or a prior save error STOPS auto-save (so a 409
 * surfaces the reconcile banner and can't loop) until the user resolves it —
 * clearing the conflict/error re-opens the gate.
 */
export function shouldAutoSave(g: AutoSaveGate): boolean {
  return g.enabled && g.dirty && !g.saving && !g.hasConflict && !g.hasError
}
