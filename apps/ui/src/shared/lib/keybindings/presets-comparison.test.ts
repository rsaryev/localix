import { expect, test } from 'bun:test'
import type { BindingOverrides } from '@localixai/kit/keybindings'

import { CMD } from './catalog'
import {
  CUSTOM_PRESET_ID,
  detectActivePreset,
  presetOverrides,
  resolvePresetOverrides,
} from './presets'

test.each([null, ''])(
  'an explicit override key stays distinct from the default preset: %s',
  (chord) => {
    const overrides = { [CMD.newChat]: chord }
    expect(detectActivePreset(overrides, 'default', 'windows')).toBe(CUSTOM_PRESET_ID)
    const resolved = resolvePresetOverrides(overrides, 'default', 'mac')
    expect(Object.hasOwn(resolved, CMD.newChat)).toBe(true)
    expect(resolved[CMD.newChat]).toBe(chord)
  },
)

test('preset matching ignores inherited bindings and does not mutate the saved batch', () => {
  const overrides: BindingOverrides = Object.assign(
    Object.create({ [CMD.newChat]: 'mod+9' }),
    presetOverrides('vscode', 'windows'),
  )
  Object.freeze(overrides)
  expect(detectActivePreset(overrides, 'vscode', 'windows')).toBe('vscode')
  expect(resolvePresetOverrides(overrides, 'vscode', 'mac')).toEqual(
    presetOverrides('vscode', 'mac'),
  )
  expect(Object.hasOwn(overrides, CMD.newChat)).toBe(false)
  expect(overrides[CMD.newChat]).toBe('mod+9')
  expect(overrides[CMD.nextEditor]).toBe('mod+pagedown')
})
