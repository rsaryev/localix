import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

/**
 * The reader's chrome, wherever it is drawn.
 *
 * This used to read `ReaderWorkspace.tsx` alone, which worked only while that one file was 4,386
 * lines and held every screen. Splitting it into a workspace, two panes and their shared parts
 * moved the markup without changing a rule — and a geometry guard pinned to one filename would
 * have gone quietly green on an empty search. Concatenating the surface is what keeps the rule
 * about the reader rather than about a path.
 */
const workspace = [
  'ReaderWorkspace.tsx',
  'ReaderReadingPane.tsx',
  'ReaderLibraryPane.tsx',
  'readerParts.tsx',
  'ReaderStats.tsx',
]
  .map(read)
  .join('\n')
const searchPanel = read('ReaderSearchPanel.tsx')

describe('reader workbench geometry', () => {
  test('builds every library and overlay chrome row from a workbench primitive', () => {
    // The library's second chrome row is subordinate to the identity row above it, so it
    // takes the primitive's `compact` step. At the default density the two bars carried the
    // same 36px measure and the same seam, and read as one doubled band.
    expect(workspace).toContain('<WorkbenchToolbar aria-label="Library view" density="compact">')
    expect(workspace).toContain('aria-label="Speed reading"')
    expect(workspace).toContain('aria-label="Speed reading status"')
    // The book panel's section header shares --panel-header-height with the reading toolbar.
    expect(workspace).toContain('<PanelHeader')
    expect(workspace).not.toContain('flex h-10 shrink-0 items-center gap-1 border-b')
    expect(workspace).not.toContain('flex min-h-11 shrink-0 items-center')
    expect(workspace).not.toContain('flex h-8 shrink-0 items-center border-b')
  })

  test('keeps reader chrome measures on the geometry scale', () => {
    for (const source of [workspace, searchPanel]) {
      expect(source).not.toMatch(/className="[^"]*\bh-(?:7|8|9|10|11)\b[^"]*(?:border-|shrink-0)/)
      expect(source).not.toMatch(/\bmin-h-(?:6|9|11)\b/)
    }
    expect(workspace).toContain('h-[var(--chrome-control-touch)]')
    expect(workspace).toContain('min-h-[var(--panel-header-height)]')
    expect(searchPanel).toContain('min-h-[var(--chrome-control-sm)]')
  })

  /**
   * JUNCTION RULE — one line per seam at the bottom of the reading pane.
   *
   * The whole-book progress track is a 2px rule in the full-strength border colour (the VS
   * Code ProgressBar measure, src/vs/base/browser/ui/progressbar/progressbar.css) and it
   * sits flush on top of the reading status bar. With the status bar also drawing its own
   * `border-t`, that junction rendered two stacked rules in two different weights.
   */
  test('lets the progress track own the seam above the reading status bar', () => {
    expect(workspace).toContain(
      '<WorkbenchStatusBar aria-label="Reading status" className="border-t-0">',
    )
    expect(workspace).toContain('<div className="h-0.5 shrink-0 bg-[var(--reader-rule)]"')
  })

  test('lets library data surfaces span their pane instead of a prose measure', () => {
    // Books, annotations and search results are data grids: one fluid track sizing, no
    // viewport breakpoints inside a container-queried pane, no centred max-width cap.
    expect(workspace).not.toMatch(/max-w-(?:4xl|5xl)/)
    expect(workspace).not.toContain('sm:grid-cols-2')
    const gridTracks = workspace.match(/grid-cols-\[repeat\(auto-fill,minmax\([^)]+\)\)\]/g) ?? []
    expect(gridTracks.length).toBeGreaterThanOrEqual(3)
  })

  const everySurface = [
    workspace,
    searchPanel,
    ...[
      'ReaderLibraryDialogs.tsx',
      'ReaderNotePopover.tsx',
      'ReaderReadingToolsMenu.tsx',
      'ReaderSelectionToolbar.tsx',
    ].map(read),
  ].join('\n')

  test('icon actions are the kit IconButton, with a styled tooltip rather than a native title', () => {
    // 42 `<Button size="icon" title=…>` rebuilt IconButton by hand: a second hover palette and an
    // OS tooltip that the host deliberately left out of IconButton's API.
    expect(everySurface).not.toMatch(/size="icon(?:-sm)?"/)
    expect(everySurface).toContain('<IconButton')
  })

  test('searches with the kit field and reflows on the pane, not the window', () => {
    // The search boxes were icon + Input + clear button placed by hand; the library's `sm:`
    // variants followed the window width inside a pane.
    expect(everySurface).toContain('<SearchInput')
    expect(everySurface).not.toMatch(/absolute left-2 top-1\/2 size-3\.5/)
    expect(everySurface).not.toMatch(/(?<![@\w-])sm:(?:block|inline|flex)/)
    expect(read('ReaderLibraryPane.tsx')).toContain('@container')
  })
})
