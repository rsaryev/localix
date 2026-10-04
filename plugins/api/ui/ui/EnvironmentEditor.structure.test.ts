import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./EnvironmentEditor.tsx', import.meta.url), 'utf8')

describe('environment editor geometry', () => {
  test('shares the canonical panel-header height with the Requests navigator', () => {
    expect(source).toContain('<PanelHeader')
    expect(source).toContain('tone="content"')
    expect(source).not.toContain('className="flex h-14 shrink-0')
  })

  test('owns one full-width footer whose column seam matches the navigator', () => {
    expect(source).toContain('data-slot="environment-editor-footer"')
    expect(source).toContain(
      'className="flex h-12 shrink-0 items-stretch border-t border-border-soft"',
    )
    expect(source).toContain(
      'className="flex w-44 shrink-0 items-center border-r border-border-soft px-2"',
    )
    expect(source).not.toContain('className="border-t border-border-soft p-2"')
  })

  test('uses the repository seam token for structural editor boundaries', () => {
    expect(source).not.toMatch(/border-(?:t|b|r|l) border-border\/(?:15|30|40|50|55|62|70)/)
  })
})
