import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const indexCss = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const fontsCss = readFileSync(new URL('./fonts.css', import.meta.url), 'utf8')

const expectedFamilies = [
  'Inter Variable',
  'DM Sans Variable',
  'Geist Variable',
  'JetBrains Mono Variable',
  'Fira Code Variable',
  'Fragment Mono',
] as const

describe('bundled fonts', () => {
  test('uses the curated font manifest instead of broad package entrypoints', () => {
    expect(indexCss).toMatch(/@import\s+["']\.\/fonts\.css["'];/)
    expect(indexCss).not.toMatch(/@import\s+['"]@fontsource(?:-variable)?\//)
  })

  test('keeps every configured UI family available', () => {
    for (const family of expectedFamilies) {
      expect(fontsCss).toMatch(new RegExp(`font-family: ["']${family}["'];`))
    }
  })

  test('ships only the selected Latin subsets', () => {
    expect(fontsCss).not.toMatch(/-(?:cyrillic|greek|vietnamese)-/)
    expect(fontsCss.match(/@font-face/g)).toHaveLength(17)
    expect(fontsCss.match(/-latin-wght-|fragment-mono-latin-400-/g)).toHaveLength(8)
    expect(fontsCss.match(/-latin-ext-wght-|fragment-mono-latin-ext-400-/g)).toHaveLength(8)
  })
})
