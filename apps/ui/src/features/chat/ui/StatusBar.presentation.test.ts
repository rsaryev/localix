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

  test('shows timing details through the shared collision-aware popover layer', () => {
    expect(source).toContain('<Popover>')
    expect(source).toContain('side="top"')
    expect(source).toContain('aria-label="Session timing details"')
    expect(source).not.toContain('useDismissableOverlay')
    expect(source).not.toContain('absolute bottom-full')
    expect(source).not.toContain('z-50')
  })
})
