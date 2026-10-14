import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const uiDir = fileURLToPath(new URL('.', import.meta.url))

function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return productionSources(path)
    if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) return []
    return [path]
  })
}

describe('settings form foundation', () => {
  test('has one shared control system and no legacy formStyles escape hatch', () => {
    expect(existsSync(join(uiDir, 'formStyles.ts'))).toBe(false)

    for (const path of productionSources(uiDir)) {
      const source = readFileSync(path, 'utf8')
      expect(source).not.toContain("from './formStyles'")
      expect(source).not.toContain('INPUT_CLS')
      expect(source).not.toContain('TEXTAREA_CLS')
      expect(source).not.toContain('BTN_PRIMARY')
      expect(source).not.toContain('BTN_SUBTLE')
      expect(source).not.toContain('BTN_DANGER')
    }
  })
})
