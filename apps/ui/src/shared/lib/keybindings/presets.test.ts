import { describe, expect, it } from 'bun:test'
import { CMD, SHORTCUT_CATALOG, isConfigurable } from './catalog'
import {
  CUSTOM_PRESET_ID,
  KEYMAP_PRESETS,
  detectActivePreset,
  presetOverrides,
  validateKeymapPresets,
} from './presets'

const configurableIds = new Set(SHORTCUT_CATALOG.filter((c) => isConfigurable(c)).map((c) => c.id))

describe('keymap presets', () => {
  it('every preset key is a real, configurable CMD id', () => {
    for (const preset of KEYMAP_PRESETS) {
      for (const id of Object.keys(preset.overrides)) {
        expect(configurableIds.has(id)).toBe(true)
      }
    }
  })

  it('validateKeymapPresets reports no issues for the shipped presets', () => {
    expect(validateKeymapPresets()).toEqual([])
  })

  it('flags an invented command id', () => {
    const issues = validateKeymapPresets([
      { id: 'bogus', label: 'x', description: '', overrides: { 'nav.does-not-exist': 'mod+q' } },
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ presetId: 'bogus', kind: 'unknown-command' })
  })

  it('flags an intra-preset chord collision', () => {
    const issues = validateKeymapPresets([
      {
        id: 'clashy',
        label: 'x',
        description: '',
        overrides: { [CMD.goToFile]: 'mod+r', [CMD.goToSymbol]: 'mod+r' },
      },
    ])
    expect(issues.some((i) => i.kind === 'chord-collision')).toBe(true)
  })

  it('presetOverrides("default") is empty', () => {
    expect(presetOverrides('default')).toEqual({})
  })

  it('presetOverrides returns a defensive copy', () => {
    const a = presetOverrides('jetbrains')
    a[CMD.goToFile] = 'mod+zzz'
    expect(presetOverrides('jetbrains')[CMD.goToFile]).toBe('mod+shift+n')
  })

  it('presetOverrides("unknown") is empty', () => {
    expect(presetOverrides('nope')).toEqual({})
  })

  it('detects the default preset from an empty / absent override map', () => {
    expect(detectActivePreset({})).toBe('default')
    expect(detectActivePreset(undefined)).toBe('default')
  })

  it('applying a preset then detecting round-trips', () => {
    for (const preset of KEYMAP_PRESETS) {
      expect(detectActivePreset(presetOverrides(preset.id))).toBe(preset.id)
    }
  })

  it('detection is order- and token-order-independent (canonical)', () => {
    // reversed insertion order + non-canonical modifier order still matches
    expect(
      detectActivePreset({ [CMD.goToSymbolWorkspace]: 'shift+mod+r', [CMD.goToSymbol]: 'mod+r' }),
    ).toBe('sublime')
  })

  it('a hand-edit on top of a preset flips detection to Custom', () => {
    const edited = { ...presetOverrides('jetbrains'), [CMD.toggleSidebar]: 'mod+alt+b' }
    expect(detectActivePreset(edited)).toBe(CUSTOM_PRESET_ID)
  })

  it('an arbitrary override map with no preset match is Custom', () => {
    expect(detectActivePreset({ [CMD.goToFile]: 'mod+9' })).toBe(CUSTOM_PRESET_ID)
  })
})
