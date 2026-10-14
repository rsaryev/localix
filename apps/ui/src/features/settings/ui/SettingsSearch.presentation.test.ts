import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./SettingsSearch.tsx', import.meta.url), 'utf8')

describe('settings search presentation', () => {
  test('renders result tab names as quiet metadata instead of badges', () => {
    expect(source).toContain('ml-auto shrink-0 text-2xs font-medium text-text-faint')
    expect(source).not.toContain('rounded-md border border-border/40 bg-muted/30')
  })

  test('delegates placement, material, and listbox semantics to shared autocomplete', () => {
    expect(source).toContain('<AutocompleteList')
    expect(source).not.toContain('<PopoverContent')
    expect(source).not.toContain('w-(--radix-popover-trigger-width)')
    expect(source).not.toContain('onOpenAutoFocus')
    expect(source).not.toContain('onInteractOutside')
    expect(source).not.toContain('absolute inset-x-0')
    expect(source).not.toContain('setTimeout')
  })

  test('uses shared menu-row geometry and a one-line empty state', () => {
    expect(source).toContain('<AutocompleteOption')
    expect(source).not.toContain('MENU_ITEM')
    expect(source).toContain('px-3 py-4 text-xs text-text-faint')
    expect(source).not.toContain('Try a different name or keyword.')
  })

  test('uses the full-width primary-search treatment inside settings', () => {
    // `xl` — the 36px rung, the same name a 36px Button carries.
    expect(source).toContain('size="xl"')
    expect(source).toContain('inset')
  })
})
