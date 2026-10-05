import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('settings action foundation', () => {
  test.each(['./PermissionEditor.tsx', './SetupSection.tsx', './keyboard/ChordRecorder.tsx'])(
    '%s delegates ordinary actions to Button or IconButton',
    (path) => {
      const source = read(path)
      expect(source).toMatch(/<(Button|IconButton)/)
      expect(source).not.toContain('<button')
    },
  )

  test('delegates settings-search result actions to the shared autocomplete option', () => {
    const source = read('./SettingsSearch.tsx')
    const rawButtons = source.match(/<button/g) ?? []

    expect(rawButtons).toHaveLength(0)
    expect(source).toContain('<AutocompleteOption')
    expect(source).not.toContain('role="option"')
    expect(source).not.toContain('MENU_ITEM')
  })
})
