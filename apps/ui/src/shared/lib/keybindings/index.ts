/**
 * Keyboard-shortcut registry — the OS-neutral catalog, the chord engine, a pure
 * resolver (catalog defaults ⊕ user overrides), and a shared reactive read-store
 * so any layer can match a keystroke. React glue that PERSISTS overrides lives
 * in `features/settings/model/useKeybindings.ts`; this barrel is feature-free.
 */

export type {
  Chord,
  ShortcutCategory,
  ShortcutCommand,
  ResolvedBindings,
  BindingOverrides,
} from '@localixai/kit/keybindings'
export {
  chordFromEvent,
  chordToTokens,
  formatChordText,
  formatModifierText,
  withChordHint,
  matchesChord,
  canonicalizeChord,
  isPrimaryModifier,
} from '@localixai/kit/keybindings'
export type { KeyChordEvent, PrimaryModifierEvent } from '@localixai/kit/keybindings'
export type { ChordModifier } from '@localixai/kit/keybindings'
export { CMD, SHORTCUT_CATALOG, CATEGORY_META, CATEGORY_ORDER, isConfigurable } from './catalog'
export { resolveBindings, findConflicts, conflictingCommands } from './resolve'
export { useKeybindingsStore } from './store'
export {
  useChordHint,
  useChordStore,
  useCommandChord,
  useKeybindingMatcher,
} from '@localixai/kit/keybindings'
export {
  KEYMAP_PRESETS,
  CUSTOM_PRESET_ID,
  presetOverrides,
  resolvePresetOverrides,
  detectActivePreset,
  validateKeymapPresets,
} from './presets'
export type { KeymapPreset, PresetValidationIssue } from './presets'
