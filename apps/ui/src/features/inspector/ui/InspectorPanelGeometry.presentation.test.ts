import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const readSource = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
const readUi = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

/**
 * Inspector panels must read as ONE system: the shared toolbar/header primitives
 * own their gutters, pane-level empties go through StateNotice, and persistent
 * chrome heights come from the geometry tokens in app/index.css.
 */
describe('inspector panel geometry', () => {
  test('leaves the panel gutter to the toolbar and header primitives', () => {
    // WorkbenchToolbar densities are px-3 / px-2.5 / px-2 and PanelHeader is px-3.
    // A panel that re-pads the primitive drifts away from its siblings; only the
    // documented sidebar gutter (px-2) is an allowed override.
    const openingTags = (source: string, tag: string) =>
      source
        .split(`<${tag}`)
        .slice(1)
        .map((rest) => rest.slice(0, rest.indexOf('>')))

    for (const name of [
      'ProblemsTab.tsx',
      'MessageReplayTab.tsx',
      'LiveFileChangeTab.tsx',
      'BrowserToolbar.tsx',
      'PeekDefinitionPanel.tsx',
      'FileTreeSidebar.tsx',
      'FileTreeSearchBar.tsx',
    ]) {
      const source = readSource(name)
      for (const tag of ['WorkbenchToolbar', 'PanelHeader']) {
        for (const attrs of openingTags(source, tag)) {
          expect(attrs).not.toMatch(/\bpx-(?:1|1\.5|2\.5|3\.5|4|5|6)\b/)
        }
      }
    }
  })

  test('routes pane-level empty and error states through StateNotice', () => {
    for (const name of [
      'FileTab.tsx',
      'MediaFileTab.tsx',
      'MessageReplayTab.tsx',
      'ProblemsTab.tsx',
    ]) {
      const source = readSource(name)
      expect(source).toContain('StateNotice')
      // The hand-rolled clone of the primitive: centered column + its exact title/body sizes.
      expect(source).not.toContain('flex-col items-center justify-center gap-1 px-6')
    }
  })

  test('centers resize sashes with the shared hit-area token', () => {
    const shell = readUi('widgets/workspace-shell/ui/WorkspaceShell.tsx')
    expect(shell).toContain('-right-[calc(var(--sash-hit-area)/2)]')
    expect(shell).not.toContain('-right-[3px]')
    expect(readUi('widgets/editor-grid/ui/GridView.tsx')).toContain("'var(--sash-hit-area)'")
  })
})
