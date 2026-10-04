import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./GeneralSettings.tsx', import.meta.url), 'utf8')

describe('general settings presentation', () => {
  test('keeps the full-name field free of a decorative initial control', () => {
    expect(source).toContain('id="display-name"')
    expect(source).not.toContain('const initial =')
    expect(source).not.toContain('bg-foreground/15')
    expect(source).not.toContain('pl-10')
  })
})
