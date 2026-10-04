/**
 * Base-keymap presets — one-click familiarity for
 * users coming from another editor. A preset is nothing more than a NAMED BATCH
 * of overrides written into `uiSettings.keybindings`: applying it replaces the
 * override map with the preset's `overrides`, and hand-editing any binding
 * afterwards makes the map stop matching every preset, so the picker reports
 * "Custom" (see `detectActivePreset`). No new keymap engine — this reuses the
 * exact override/resolve/persist path the per-command editor already uses.
 *
 * HONESTY RULE: a preset only remaps commands that ALREADY EXIST in the catalog
 * (`CMD`) and where the target editor's convention GENUINELY DIFFERS from ours.
 * Our catalog defaults already follow the common editor convention, so the `default` preset is
 * empty. `validateKeymapPresets` (exercised by the unit tests) asserts every
 * preset key is a real configurable command id and no preset has an internal
 * chord collision — so an invented command or a self-clashing preset fails CI.
 */

import { CMD, SHORTCUT_CATALOG, isConfigurable } from './catalog'
import { canonicalizeChord } from '@localixai/kit/keybindings'
import type { BindingOverrides, Chord } from '@localixai/kit/keybindings'

export interface KeymapPreset {
  /** Stable id — persisted in `uiSettings.keymapPreset`. */
  id: string
  /** Human label shown in the picker. */
  label: string
  /** One-line "where this comes from" hint. */
  description: string
  /** The batch of command-id → chord overrides this preset applies. */
  overrides: BindingOverrides
}

/** The sentinel picker value shown when the live overrides match no preset. */
export const CUSTOM_PRESET_ID = 'custom'

export const KEYMAP_PRESETS: KeymapPreset[] = [
  {
    id: 'default',
    label: 'Default',
    description: "Localix's built-in bindings.",
    overrides: {},
  },
  {
    id: 'jetbrains',
    label: 'JetBrains (IntelliJ)',
    description: 'Remaps the command palette, go to file, go to symbol and recent sessions.',
    overrides: {
      [CMD.commandPalette]: 'mod+shift+a', // Find Action / Search Everywhere
      [CMD.goToFile]: 'mod+shift+n', // Go to File
      [CMD.goToSymbol]: 'mod+f12', // File Structure
      [CMD.goToSymbolWorkspace]: 'mod+alt+o', // Navigate → Symbol
      [CMD.switchSession]: 'mod+e', // Recent Files
    },
  },
  {
    id: 'sublime',
    label: 'Sublime Text',
    description: 'Remaps go to symbol in the file and in the workspace.',
    overrides: {
      [CMD.goToSymbol]: 'mod+r', // Goto Symbol
      [CMD.goToSymbolWorkspace]: 'mod+shift+r', // Goto Symbol in Project
    },
  },
]

const PRESET_BY_ID = new Map(KEYMAP_PRESETS.map((p) => [p.id, p]))

/**
 * The override batch for a preset id (a defensive copy), or an empty map for an
 * unknown id. Pure — the write path calls this to produce the map it persists.
 */
export function presetOverrides(id: string): BindingOverrides {
  return { ...PRESET_BY_ID.get(id)?.overrides }
}

/** Canonicalize an override map for order-independent comparison. */
function normalize(overrides: BindingOverrides | undefined): Record<string, Chord> {
  const out: Record<string, Chord> = {}
  if (!overrides) return out
  for (const key of Object.keys(overrides)) {
    out[key] = canonicalizeChord(overrides[key])
  }
  return out
}

function sameOverrides(a: BindingOverrides | undefined, b: BindingOverrides | undefined): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  const ka = Object.keys(na)
  const kb = Object.keys(nb)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(nb, k) && na[k] === nb[k])
}

/**
 * Which preset the current override map corresponds to, or `CUSTOM_PRESET_ID`
 * when it matches none (e.g. after a hand-edit). Compared canonically and
 * order-independently, so `presetOverrides(id)` round-trips back to `id`. Pure.
 */
export function detectActivePreset(overrides: BindingOverrides | undefined): string {
  for (const preset of KEYMAP_PRESETS) {
    if (sameOverrides(overrides, preset.overrides)) return preset.id
  }
  return CUSTOM_PRESET_ID
}

/** Every configurable command id in the catalog (the set a preset may key on). */
const CONFIGURABLE_IDS = new Set(SHORTCUT_CATALOG.flatMap((c) => (isConfigurable(c) ? [c.id] : [])))

export interface PresetValidationIssue {
  presetId: string
  kind: 'unknown-command' | 'non-configurable' | 'chord-collision'
  detail: string
}

/**
 * Assert every preset is honest: each key is a real, configurable `CMD` id and
 * no two of a preset's keys resolve to the same canonical chord. Returns the
 * list of issues (empty = valid). Pure — the unit tests treat a non-empty
 * result as a failure so an invented command or a self-clash can't ship.
 */
export function validateKeymapPresets(
  presets: KeymapPreset[] = KEYMAP_PRESETS,
): PresetValidationIssue[] {
  const issues: PresetValidationIssue[] = []
  for (const preset of presets) {
    const byChord = new Map<string, string>() // canonical chord → first command id
    for (const commandId of Object.keys(preset.overrides)) {
      if (!CONFIGURABLE_IDS.has(commandId)) {
        issues.push({
          presetId: preset.id,
          kind: CMD_IDS.has(commandId) ? 'non-configurable' : 'unknown-command',
          detail: commandId,
        })
      }
      const chord = canonicalizeChord(preset.overrides[commandId])
      if (!chord) continue
      const prior = byChord.get(chord)
      if (prior) {
        issues.push({
          presetId: preset.id,
          kind: 'chord-collision',
          detail: `${prior} & ${commandId} → ${chord}`,
        })
      } else {
        byChord.set(chord, commandId)
      }
    }
  }
  return issues
}

/** Every command id known to the catalog (used to distinguish unknown vs non-configurable). */
const CMD_IDS = new Set(SHORTCUT_CATALOG.map((c) => c.id))
