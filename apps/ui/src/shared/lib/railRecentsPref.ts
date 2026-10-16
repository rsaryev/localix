/**
 * How the navigation rail presents its RECENT plugin views (see
 * widgets/workspace-shell/model/railRecents for the MRU model itself).
 *
 * A recent slot is transient by nature, so three icons sitting in the rail at rest
 * read as noise. This preference chooses between keeping them collapsed behind one
 * disclosure button (the default), showing them all, or not showing them at all.
 * The MRU list keeps being recorded either way, so turning the dock back on
 * restores the slots instead of starting from an empty history.
 *
 * Pure browser-only preference module (no `features`/`shared/api`/store import) —
 * lives in the lowest FSD layer beside storage.ts, mirroring spendAlert.ts.
 */

import { useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'

const STORAGE_KEY = 'localix.rail.recentsMode'

/**
 * - `hover` — one disclosure button; the icons appear on hover/focus/click.
 * - `expanded` — every recent slot always visible in the rail.
 * - `off` — no recent slots at all (the MRU list is still recorded).
 */
export type RailRecentsMode = 'hover' | 'expanded' | 'off'

export const RAIL_RECENTS_MODES: readonly RailRecentsMode[] = ['hover', 'expanded', 'off']

/** Quiet by default: collapsed until asked for. */
export const DEFAULT_RAIL_RECENTS_MODE: RailRecentsMode = 'hover'

/** Narrow an unknown persisted value; anything foreign falls back to the default. */
export function parseRailRecentsMode(raw: string | null): RailRecentsMode {
  return RAIL_RECENTS_MODES.includes(raw as RailRecentsMode)
    ? (raw as RailRecentsMode)
    : DEFAULT_RAIL_RECENTS_MODE
}

let mode = parseRailRecentsMode(loadString(STORAGE_KEY))
const listeners = new Set<() => void>()

/** The current rail-recents presentation mode. */
export function getRailRecentsMode(): RailRecentsMode {
  return mode
}

/** Set the mode, persist it, and notify subscribers. */
export function setRailRecentsMode(next: RailRecentsMode): void {
  if (next === mode) return
  mode = next
  // The default is stored as an absent key, so a future change of default follows.
  saveString(STORAGE_KEY, next === DEFAULT_RAIL_RECENTS_MODE ? null : next)
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Reactively read the mode (re-renders on change). */
export function useRailRecentsMode(): RailRecentsMode {
  return useSyncExternalStore(subscribe, getRailRecentsMode, getRailRecentsMode)
}
