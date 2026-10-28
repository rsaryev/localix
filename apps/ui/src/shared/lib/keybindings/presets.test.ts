import { describe, expect, it } from 'bun:test'
import { CMD, SHORTCUT_CATALOG, isConfigurable } from './catalog'
import {
  CUSTOM_PRESET_ID,
  KEYMAP_PRESETS,
  detectActivePreset,
  presetOverrides,
  resolvePresetOverrides,
  validateKeymapPresets,
} from './presets'
import { KEYMAP_PLATFORMS } from './presetDefinitions'
import { matchesChord } from '@localixai/kit/keybindings'

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
    expect(issues).toHaveLength(3)
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
    const a = presetOverrides('jetbrains', 'windows')
    a[CMD.goToFile] = 'mod+zzz'
    expect(presetOverrides('jetbrains', 'windows')[CMD.goToFile]).toBe('mod+shift+n')
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
      for (const platform of KEYMAP_PLATFORMS) {
        expect(detectActivePreset(presetOverrides(preset.id, platform), preset.id, platform)).toBe(
          preset.id,
        )
      }
    }
  })

  it('detection is order- and token-order-independent (canonical)', () => {
    // reversed insertion order + non-canonical modifier order still matches
    const sublime = presetOverrides('sublime', 'mac')
    const reversed = Object.fromEntries(Object.entries(sublime).reverse())
    expect(detectActivePreset(reversed, undefined, 'mac')).toBe('sublime')
  })

  it('a hand-edit on top of a preset flips detection to Custom', () => {
    const edited = { ...presetOverrides('jetbrains'), [CMD.toggleSidebar]: 'mod+alt+b' }
    expect(detectActivePreset(edited)).toBe(CUSTOM_PRESET_ID)
  })

  it('an arbitrary override map with no preset match is Custom', () => {
    expect(detectActivePreset({ [CMD.goToFile]: 'mod+9' })).toBe(CUSTOM_PRESET_ID)
  })

  it('detects conflicts with inherited defaults, not only between overrides', () => {
    expect(
      validateKeymapPresets([
        { id: 'bad', label: 'Bad', description: '', overrides: { [CMD.goToFile]: 'mod+t' } },
      ]).some((issue) => issue.kind === 'chord-collision'),
    ).toBe(true)
  })

  it('rejects unsupported multi-stroke strings rather than silently disabling them', () => {
    expect(
      validateKeymapPresets([
        { id: 'bad', label: 'Bad', description: '', overrides: { [CMD.goToFile]: 'mod+x mod+f' } },
      ]).some((issue) => issue.kind === 'invalid-chord'),
    ).toBe(true)
  })

  it('preserves editor identity for equivalent batches', () => {
    for (const id of ['vscode', 'windsurf', 'notepad-plus-plus', 'vim', 'neovim', 'helix']) {
      expect(detectActivePreset(presetOverrides(id, 'windows'), id, 'windows')).toBe(id)
    }
    expect(
      detectActivePreset(presetOverrides('vscode', 'windows'), 'not-a-preset', 'windows'),
    ).toBe('vscode')
  })

  it('adapts untouched presets to the current OS and preserves custom edits exactly', () => {
    const windows = presetOverrides('jetbrains', 'windows')
    expect(resolvePresetOverrides(windows, 'jetbrains', 'mac')).toEqual(
      presetOverrides('jetbrains', 'mac'),
    )
    const custom = { ...windows, [CMD.goToFile]: 'mod+9' }
    expect(resolvePresetOverrides(custom, 'jetbrains', 'mac')).toEqual(custom)
    expect(detectActivePreset(custom, 'jetbrains', 'mac')).toBe(CUSTOM_PRESET_ID)
  })

  it('uses physical Control for terminal-editor jump history on macOS', () => {
    const chord = presetOverrides('neovim', 'mac')[CMD.navigateBack]!
    expect(
      matchesChord(
        { key: 'o', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
        chord,
        'mac',
      ),
    ).toBe(true)
    expect(
      matchesChord(
        { key: 'o', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false },
        chord,
        'mac',
      ),
    ).toBe(false)
  })
})
