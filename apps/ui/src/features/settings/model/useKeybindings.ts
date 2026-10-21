import { useCallback, useEffect, useMemo } from 'react'
import {
  type Chord,
  type ResolvedBindings,
  detectActivePreset,
  presetOverrides,
  resolvePresetOverrides,
  resolveBindings,
  useKeybindingsStore,
} from '@/shared/lib/keybindings'
import { useSettingsStore } from '@/shared/lib/user-settings/settingsStore'

/**
 * Bridge between the persisted profile (`uiSettings.keybindings`) and the shared
 * reactive keybindings store that handler sites read. Mount ONCE near the app
 * root so every keystroke matcher sees the user's overrides even when the
 * settings page is closed. Settings owns persistence; the shared store owns the
 * live read-source — no other feature imports this one.
 */
export function useSyncKeybindings(): void {
  const overrides = useSettingsStore((s) => s.settings.uiSettings?.keybindings)
  const presetId = useSettingsStore((s) => s.settings.uiSettings?.keymapPreset)
  const setOverrides = useKeybindingsStore((s) => s.setOverrides)
  useEffect(() => {
    setOverrides(resolvePresetOverrides(overrides, presetId))
  }, [overrides, presetId, setOverrides])
}

export interface KeybindingsEditor {
  /** Effective chord per command id (catalog defaults merged with overrides). */
  resolved: ResolvedBindings
  /** Resolved chord for a command id (or null if unassigned). */
  chordOf: (commandId: string) => Chord
  /** Whether the command currently differs from its catalog default. */
  isOverridden: (commandId: string) => boolean
  /** Set (or clear, with `null`) a command's chord — persisted via the profile. */
  setBinding: (commandId: string, chord: Chord) => void
  /** Drop the override so the command falls back to its catalog default. */
  resetBinding: (commandId: string) => void
  /** Clear every override (all commands return to their defaults). */
  resetAll: () => void
  /** The base-keymap preset the current overrides match, or `'custom'`. */
  activePreset: string
  /** Apply a base-keymap preset: replace overrides with its batch + record the id. */
  applyPreset: (presetId: string) => void
}

/**
 * The settings-page editor API: reads the persisted overrides and exposes
 * mutators that write them back through the profile store (which also pushes
 * them into the shared read-store on the next render via `useSyncKeybindings`).
 */
export function useKeybindingsEditor(): KeybindingsEditor {
  const storedOverrides = useSettingsStore((s) => s.settings.uiSettings?.keybindings)
  const uiSettings = useSettingsStore((s) => s.settings.uiSettings)
  const update = useSettingsStore((s) => s.update)
  const overrides = useMemo(
    () => resolvePresetOverrides(storedOverrides, uiSettings?.keymapPreset),
    [storedOverrides, uiSettings?.keymapPreset],
  )

  const resolved = useMemo(() => resolveBindings(overrides), [overrides])

  const writeOverrides = useCallback(
    (next: Record<string, Chord>) => {
      update({
        uiSettings: { ...useSettingsStore.getState().settings.uiSettings, keybindings: next },
      })
    },
    [update],
  )

  const setBinding = useCallback(
    (commandId: string, chord: Chord) => {
      writeOverrides({ ...overrides, [commandId]: chord })
    },
    [overrides, writeOverrides],
  )

  const resetBinding = useCallback(
    (commandId: string) => {
      if (!overrides || !Object.prototype.hasOwnProperty.call(overrides, commandId)) return
      const next = { ...overrides }
      delete next[commandId]
      writeOverrides(next)
    },
    [overrides, writeOverrides],
  )

  const resetAll = useCallback(
    () =>
      update({
        uiSettings: {
          ...useSettingsStore.getState().settings.uiSettings,
          keybindings: {},
          keymapPreset: 'default',
        },
      }),
    [update],
  )

  const activePreset = useMemo(
    () => detectActivePreset(overrides, uiSettings?.keymapPreset),
    [overrides, uiSettings?.keymapPreset],
  )
  const applyPreset = useCallback(
    (presetId: string) => {
      update({
        uiSettings: {
          ...useSettingsStore.getState().settings.uiSettings,
          keybindings: presetOverrides(presetId),
          keymapPreset: presetId,
        },
      })
    },
    [update],
  )

  const chordOf = useCallback((commandId: string): Chord => resolved[commandId] ?? null, [resolved])
  const isOverridden = useCallback(
    (commandId: string) =>
      Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, commandId)),
    [overrides],
  )

  return {
    resolved,
    chordOf,
    isOverridden,
    setBinding,
    resetBinding,
    resetAll,
    activePreset,
    applyPreset,
  }
}
