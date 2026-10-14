import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./RestApiWorkspace.tsx', import.meta.url), 'utf8')
const sidebarSource = readFileSync(new URL('./RestApiSidebar.tsx', import.meta.url), 'utf8')

describe('API workspace split geometry', () => {
  test('overlays the resize hit target on the pane seam instead of opening a visual gap', () => {
    expect(source).toContain(
      'className="relative z-(--z-controls) -mx-[calc(var(--sash-hit-area)/2)]"',
    )
  })

  test('uses the same content seam color on both sides of the split', () => {
    expect(sidebarSource).toMatch(/<PanelHeader\s+title="Requests"\s+tone="content"/)
  })

  test('an empty pane speaks through the kit hint, not a hand-built text-xs paragraph', () => {
    // Three empty-state styles in one workspace: EmptyHint (text-sm) in the request and response
    // panes, and two hand-built `text-xs text-text-faint` blocks here and in the environments.
    const environments = readFileSync(
      new URL('./ui/EnvironmentEditor.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toContain('<EmptyHint>Select or create a request.</EmptyHint>')
    expect(environments).toContain('<EmptyHint className="flex-1">')
    for (const file of [source, environments]) {
      expect(file).not.toMatch(/select-none items-center justify-center px-6/)
    }
  })
})
