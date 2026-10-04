import { describe, expect, test } from 'bun:test'
import { nextThemeMode, resolveNativeThemePreference } from './useTheme'

describe('native theme preference', () => {
  test('keeps System native so it can follow the operating system', () => {
    // Flattening it to whichever colour the webview reported would strand the shell on that colour
    // after the native override is released.
    expect(resolveNativeThemePreference('system', 'light')).toBe('system')
    expect(resolveNativeThemePreference('system', 'dark')).toBe('system')
  })

  test('explicit modes use the resolved appearance', () => {
    expect(resolveNativeThemePreference('dark', 'dark')).toBe('dark')
    expect(resolveNativeThemePreference('light', 'light')).toBe('light')
  })
})

describe('appearance cycle', () => {
  test('runs dark → light → system and back', () => {
    // The two concrete choices come first so seeing the other appearance is one press; the third
    // press hands control back to the OS.
    expect(nextThemeMode('dark')).toBe('light')
    expect(nextThemeMode('light')).toBe('system')
    expect(nextThemeMode('system')).toBe('dark')
  })

  test('the cycle is closed — three presses return to where it started', () => {
    expect(nextThemeMode(nextThemeMode(nextThemeMode('dark')))).toBe('dark')
    expect(nextThemeMode(nextThemeMode(nextThemeMode('light')))).toBe('light')
    expect(nextThemeMode(nextThemeMode(nextThemeMode('system')))).toBe('system')
  })
})
