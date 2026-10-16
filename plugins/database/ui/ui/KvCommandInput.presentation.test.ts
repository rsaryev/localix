import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./KvConsole.tsx', import.meta.url), 'utf8')

describe('Redis command autocomplete presentation', () => {
  test('delegates its floating surface and option semantics to the shared foundation', () => {
    expect(source).toContain('<AutocompleteList')
    expect(source).toContain('<AutocompleteOption')
    expect(source).toContain('aria-activedescendant=')
    expect(source).not.toContain('absolute left-0 top-full')
    expect(source).not.toContain('POPOVER_SURFACE')
  })
})
