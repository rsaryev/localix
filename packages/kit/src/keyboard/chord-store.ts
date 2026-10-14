/**
 * The live chord of every command, as the one read-source a PRIMITIVE may use.
 *
 * Why it is split from `store.ts`: resolving bindings needs the app's command catalog and the
 * user's overrides, and a primitive that imported that resolver carried the catalog with it — so a
 * tab strip, a menu row or a status item could not leave the app without taking every app command
 * along. The primitives only ever read `resolved[commandId]`; this store holds exactly that, and
 * the app's `store.ts` is its one writer (catalog defaults ⊕ overrides, on load and on rebind).
 * An unbound or not-yet-written command reads as no chord, which every reader already renders as
 * "no hint".
 */

import { useCallback } from 'react'
import { create } from 'zustand'
import { matchesChord, withChordHint, type KeyChordEvent } from './chord'
import type { Chord, ResolvedBindings } from './types'

interface ChordStore {
  resolved: ResolvedBindings
  /** Replace every resolved chord; the app's keybinding store is the only caller. */
  setResolved: (resolved: ResolvedBindings) => void
}

export const useChordStore = create<ChordStore>((set) => ({
  resolved: {},
  setResolved: (resolved) => set({ resolved }),
}))

/** The live chord bound to `commandId`, or null when it has none. */
export function useCommandChord(commandId: string): Chord | null {
  return useChordStore((s) => s.resolved[commandId] ?? null)
}

/**
 * Hook for handler sites: returns a stable `matches(event, commandId)` that
 * tests a keystroke against the command's resolved chord. Re-subscribes when a
 * rebind lands, so live handlers always honor the latest binding.
 */
export function useKeybindingMatcher(): (e: KeyChordEvent, commandId: string) => boolean {
  const resolved = useChordStore((s) => s.resolved)
  return useCallback(
    (e: KeyChordEvent, commandId: string) => matchesChord(e, resolved[commandId] ?? null),
    [resolved],
  )
}

/**
 * Hook for tooltip sites: returns a stable `hint(title, commandId)` that appends
 * the command's LIVE resolved chord to a `title=` string (e.g. "Terminal (⌘`)").
 * An absent `commandId` or unbound command returns the title unchanged. Like the
 * matcher, it re-derives when a rebind lands so tooltips stay accurate.
 */
export function useChordHint(): (title: string, commandId?: string) => string {
  const resolved = useChordStore((s) => s.resolved)
  return useCallback(
    (title: string, commandId?: string) =>
      commandId ? withChordHint(title, resolved[commandId] ?? null) : title,
    [resolved],
  )
}
