import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('composer autocomplete foundation', () => {
  test('anchors rich completion panels through the shared collision-aware primitive', () => {
    // The composer's text field owns the completion menus (see ComposerTextField.tsx).
    const prompt = read('./ComposerTextField.tsx')
    const menu = read('./CompletionMenu.tsx')

    expect(prompt).toContain('<Autocomplete open={completionOpen}>')
    expect(prompt).toContain('<AutocompleteAnchor asChild>')
    expect(menu).toContain('<AutocompletePanel side="top" sideOffset={6}>')
    expect(menu).toContain('<AutocompleteBody>')
    expect(menu).toContain('<AutocompleteOptions')
    expect(menu).toContain('<AutocompleteOption')
    expect(menu).not.toContain('absolute inset-x-0')
    expect(menu).not.toContain('<button')
    expect(existsSync(new URL('./ComposerMenuSurface.tsx', import.meta.url))).toBe(false)
  })

  test('routes slash arguments through the same listbox and option implementation', () => {
    const menu = read('./SlashArgMenu.tsx')

    expect(menu).toContain('<CompletionMenu')
    expect(menu).not.toContain('role="listbox"')
    expect(menu).not.toContain('role="option"')
    expect(menu).not.toContain('<button')
  })
})
