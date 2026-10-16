/**
 * The app's keyboard bindings: catalog defaults ⊕ the user's overrides, and their conflicts.
 *
 * The settings feature is the sole WRITER: it feeds the persisted overrides in via
 * `setOverrides`. Every resolution is also written into `chord-store.ts`, the catalog-free
 * read-source the UI primitives use, so a primitive shows the live chord without importing the
 * catalog. The first write happens here at module evaluation, so the defaults are live before any
 * override loads.
 */

import { create } from 'zustand'
import { useChordStore } from '@localixai/kit/keybindings'
import { findConflicts, resolveBindings } from './resolve'
import type { BindingOverrides, ResolvedBindings } from '@localixai/kit/keybindings'

interface KeybindingsStore {
  overrides: BindingOverrides
  resolved: ResolvedBindings
  conflicts: Set<string>
  /** Replace the override set (called by the settings feature on profile load/edit). */
  setOverrides: (overrides: BindingOverrides | undefined) => void
}

const defaults = resolveBindings(undefined)
useChordStore.getState().setResolved(defaults)

export const useKeybindingsStore = create<KeybindingsStore>((set) => ({
  overrides: {},
  resolved: defaults,
  conflicts: new Set<string>(),
  setOverrides: (overrides) => {
    const resolved = resolveBindings(overrides)
    useChordStore.getState().setResolved(resolved)
    set({ overrides: overrides ?? {}, resolved, conflicts: findConflicts(resolved) })
  },
}))
