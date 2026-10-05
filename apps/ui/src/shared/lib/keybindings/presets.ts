/**
 * Base-keymap presets — one-click familiarity for
 * users coming from another editor. A preset is nothing more than a NAMED BATCH
 * of workspace overrides written into `uiSettings.keybindings`: applying it replaces the
 * override map with the preset's `overrides`, and hand-editing any binding
 * afterwards makes the map stop matching every preset, so the picker reports
 * "Custom" (see `detectActivePreset`). No new keymap engine — this reuses the
 * exact override/resolve/persist path the per-command editor already uses.
 *
 * HONESTY RULE: a preset only remaps commands that ALREADY EXIST in the catalog
 * (`CMD`) and where the target editor's convention GENUINELY DIFFERS from ours.
 * Our catalog defaults already follow the common editor convention, so the `default` preset is
 * empty. `validateKeymapPresets` (exercised by the unit tests) asserts every
 * preset key is a real configurable command id and no preset collides with inherited commands on any supported OS — so an invented command or a self-clashing preset fails CI.
 */

import { CMD, SHORTCUT_CATALOG, isConfigurable } from './catalog'
import { canonicalizeChord } from '@localixai/kit/keybindings'
import type { BindingOverrides, Chord } from '@localixai/kit/keybindings'

import { OS_FAMILY, type OsFamily } from '@localixai/kit/environment'
import { KEYMAP_PLATFORMS, KEYMAP_PRESETS, type KeymapPreset } from './presetDefinitions'
import { findConflicts, resolveBindings } from './resolve'

export { KEYMAP_PRESETS }
export type { KeymapPreset }

export const CUSTOM_PRESET_ID = 'custom'

const PRESET_BY_ID = new Map(KEYMAP_PRESETS.map((p) => [p.id, p]))

/**
 * The override batch for a preset id (a defensive copy), or an empty map for an
 * unknown id. Pure — the write path calls this to produce the map it persists.
 */
export function presetOverrides(id: string, platform: OsFamily = OS_FAMILY): BindingOverrides {
  const preset = PRESET_BY_ID.get(id)
  const target = platform === 'unknown' ? 'windows' : platform
  return { ...preset?.overrides, ...preset?.platformOverrides?.[target] }
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
 * order-independently, so `presetOverrides(id)` preserves the chosen editor id. Pure.
 */
const LEGACY_OVERRIDES: Record<string, BindingOverrides> = {
  jetbrains: {
    [CMD.commandPalette]: 'mod+shift+a',
    [CMD.goToFile]: 'mod+shift+n',
    [CMD.goToSymbol]: 'mod+f12',
    [CMD.goToSymbolWorkspace]: 'mod+alt+o',
    [CMD.switchSession]: 'mod+e',
  },
  sublime: { [CMD.goToSymbol]: 'mod+r', [CMD.goToSymbolWorkspace]: 'mod+shift+r' },
}

function matchesPreset(
  overrides: BindingOverrides | undefined,
  id: string,
  includeLegacy = false,
): boolean {
  if (!PRESET_BY_ID.has(id)) return false
  return (
    KEYMAP_PLATFORMS.some((platform) => sameOverrides(overrides, presetOverrides(id, platform))) ||
    (includeLegacy &&
      LEGACY_OVERRIDES[id] !== undefined &&
      sameOverrides(overrides, LEGACY_OVERRIDES[id]))
  )
}

/** Keep the selected editor's name when several editors share the same supported bindings. */
export function detectActivePreset(
  overrides: BindingOverrides | undefined,
  preferredId?: string,
  platform: OsFamily = OS_FAMILY,
): string {
  if (preferredId && matchesPreset(overrides, preferredId, true)) return preferredId
  for (const preset of KEYMAP_PRESETS) {
    if (
      sameOverrides(overrides, presetOverrides(preset.id, platform)) ||
      (LEGACY_OVERRIDES[preset.id] !== undefined &&
        sameOverrides(overrides, LEGACY_OVERRIDES[preset.id]))
    )
      return preset.id
  }
  return CUSTOM_PRESET_ID
}

/** Adapt a current untouched preset to this OS. Older batches and custom edits stay exact. */
export function resolvePresetOverrides(
  overrides: BindingOverrides | undefined,
  preferredId?: string,
  platform: OsFamily = OS_FAMILY,
): BindingOverrides {
  return preferredId && matchesPreset(overrides, preferredId)
    ? presetOverrides(preferredId, platform)
    : { ...overrides }
}

/** Every configurable command id in the catalog (the set a preset may key on). */
const CONFIGURABLE_IDS = new Set(SHORTCUT_CATALOG.flatMap((c) => (isConfigurable(c) ? [c.id] : [])))

export interface PresetValidationIssue {
  presetId: string
  kind: 'unknown-command' | 'non-configurable' | 'invalid-chord' | 'chord-collision'
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
    for (const platform of KEYMAP_PLATFORMS) {
      const overrides = { ...preset.overrides, ...preset.platformOverrides?.[platform] }
      const byChord = new Map<string, string>()
      for (const commandId of Object.keys(overrides)) {
        if (!CONFIGURABLE_IDS.has(commandId)) {
          issues.push({
            presetId: preset.id,
            kind: CMD_IDS.has(commandId) ? 'non-configurable' : 'unknown-command',
            detail: `${platform}: ${commandId}`,
          })
        }
        const chord = canonicalizeChord(overrides[commandId])
        if (overrides[commandId] != null && !chord) {
          issues.push({
            presetId: preset.id,
            kind: 'invalid-chord',
            detail: `${platform}: ${commandId}`,
          })
        }
        if (!chord) continue
        const prior = byChord.get(chord)
        if (prior) {
          issues.push({
            presetId: preset.id,
            kind: 'chord-collision',
            detail: `${platform}: ${prior} & ${commandId} → ${chord}`,
          })
        } else byChord.set(chord, commandId)
      }
      for (const commandId of findConflicts(resolveBindings(overrides))) {
        issues.push({
          presetId: preset.id,
          kind: 'chord-collision',
          detail: `${platform}: ${commandId} conflicts with the resolved catalog`,
        })
      }
    }
  }
  return issues
}

/** Every command id known to the catalog (used to distinguish unknown vs non-configurable). */
const CMD_IDS = new Set(SHORTCUT_CATALOG.map((c) => c.id))
