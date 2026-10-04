import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const dataWorkspace = readFileSync(new URL('./TableDataWorkspace.tsx', import.meta.url), 'utf8')
const structureEditor = readFileSync(new URL('./TableStructureEditor.tsx', import.meta.url), 'utf8')
const diagram = readFileSync(new URL('./DatabaseDiagram.tsx', import.meta.url), 'utf8')
const resultFooter = readFileSync(
  new URL('./sql-results/ResultFooter.tsx', import.meta.url),
  'utf8',
)
const resultToolbar = readFileSync(
  new URL('./sql-results/ResultToolbar.tsx', import.meta.url),
  'utf8',
)

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const structureTable = read('./table-data/StructureTable.tsx')
const structureView = read('./table-data/StructureView.tsx')
const dataView = read('./table-data/DataView.tsx')
const structureRow = read('./structure-editor/StructureRow.tsx')
const createTableDialog = read('./CreateTableDialog.tsx')

const SURFACES = [
  ['TableDataWorkspace', dataWorkspace],
  ['TableStructureEditor', structureEditor],
  ['StructureTable', structureTable],
  ['StructureView', structureView],
  ['DataView', dataView],
  ['StructureRow', structureRow],
] as const

/**
 * The object grids read as part of the pane, not as slabs laid on it. Their headers were filled
 * with `bg-surface-raised/50|/40` — a DARKER ground than the pane, so each header read as a black
 * band — and rows hovered at a `/40` step no other list uses. The header row itself was a local
 * `h-11` instead of the kit PanelHeader the explorer beside it uses.
 */
describe('database object fills', () => {
  /** The quoted string literals of a source — where class lists live; comments may name them. */
  const classText = (source: string) => (source.match(/'[^'\n]*'|"[^"\n]*"/gu) ?? []).join('\n')

  test('headers take the foreground veil and rows the shared hover', () => {
    for (const [name, source] of [...SURFACES, ['CreateTableDialog', createTableDialog] as const]) {
      expect(classText(source), name).not.toMatch(/bg-surface-raised\/\d+/u)
      expect(classText(source), name).not.toContain('hover:bg-surface-hover/')
    }
    expect(structureTable).toContain('bg-foreground/[0.04]')
    expect(createTableDialog).toContain('bg-foreground/[0.04]')
  })

  test('one table recipe serves the read-only views and the editor', () => {
    for (const [name, source] of [
      ['StructureView', structureView],
      ['TableStructureEditor', structureEditor],
    ] as const) {
      expect(source, name).toContain('<StructureTable')
      expect(source, name).not.toContain('<thead')
    }
  })

  test('the object header is the kit PanelHeader, not a hand-measured row', () => {
    expect(dataWorkspace).toContain('<PanelHeader')
    expect(classText(dataWorkspace)).not.toMatch(/\bh-11\b/u)
  })
})

/**
 * One rule across the client: a DATA surface (table, grid, log, response body) spans its
 * pane; only label-and-control FORMS and prose keep a reading measure. These object tables
 * used to sit in `mx-auto max-w-5xl`/`max-w-6xl` boxes, so on any pane wider than that they
 * stopped short of the header above them and drifted off the pane's left edge.
 */
describe('database object surfaces', () => {
  test('never caps the width of a scrolling table', () => {
    for (const [name, source] of SURFACES) {
      for (const match of source.matchAll(/className="[^"]*overflow-x-auto[^"]*"/gu))
        expect(match[0], name).not.toMatch(/max-w-|mx-auto/u)
    }
  })

  test('keeps object chrome on the shared toolbar and status-bar primitives', () => {
    expect(structureView).toContain('<WorkbenchToolbar')
    expect(dataView).toContain('<WorkbenchStatusBar')
    expect(structureEditor).toContain('<WorkbenchToolbar')
    expect(diagram).toContain('<WorkbenchStatusBar')
  })

  /**
   * JUNCTION RULE — every result pane in this plugin ends on the SAME bar.
   *
   * The SQL console's result footer was hand-rolled (`py-1` around its text, a
   * `border-border/50` rule) while the table pane beside it closed on a 28px
   * `WorkbenchStatusBar` with the `/60` seam. Split the two and the baselines stepped.
   * A surface composes exactly one status part and one seam weight per junction.
   */
  test('closes every result pane on the shared status bar, at one seam weight', () => {
    expect(resultFooter).toContain('<WorkbenchStatusBar')
    expect(resultFooter).toContain('<WorkbenchStatusItem')
    // A locally measured bottom rule/height is what the primitive replaced.
    expect(resultFooter).not.toMatch(/border-t border-border(?:\/\d+|-[a-z]+)?\b/u)
    let seamCount = 0
    for (const [name, source] of [
      ['ResultFooter', resultFooter],
      ['ResultToolbar', resultToolbar],
      ['TableDataWorkspace', dataWorkspace],
      ['DataView', dataView],
      ['StructureTable', structureTable],
    ] as const) {
      // Chrome seams get the soft border step — never a second step beside it.
      for (const match of source.matchAll(/\bborder-border(?:\/\d+|-[a-z]+)?\b/gu)) {
        seamCount += 1
        expect(match[0], name).toBe('border-border-soft')
      }
    }
    // The panes do draw seams; an empty scan would mean this rule stopped looking.
    expect(seamCount).toBeGreaterThan(0)
  })

  test('bypasses no chrome height token with an ad-hoc measure', () => {
    for (const [name, source] of [...SURFACES, ['DatabaseDiagram', diagram] as const]) {
      // Diagram NODES are canvas content, not chrome, and keep their own card geometry;
      // the assertion targets the persistent rows only.
      for (const match of source.matchAll(
        /className="flex h-(?:8|9|10)[^"]*(?:border-b|border-t)[^"]*"/gu,
      ))
        expect(match[0], name).toBeUndefined()
    }
  })
})
