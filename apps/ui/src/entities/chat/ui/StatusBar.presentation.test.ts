import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./StatusBar.tsx', import.meta.url), 'utf8')

describe('chat status bar presentation', () => {
  test('uses the shared status geometry and only renders actionable controls as buttons', () => {
    expect(source).toContain('<WorkbenchStatusBar aria-label="Session status" divided>')
    expect(source).toContain('<WorkbenchStatusItem')
    expect(source).not.toContain('h-7')
    expect(source).not.toContain('<WorkbenchStatusButton\n      disabled')
  })

  test('leaves session run timing out of the bar', () => {
    expect(source).not.toContain('Session timing')
    expect(source).not.toContain('sessionTiming')
  })
})
