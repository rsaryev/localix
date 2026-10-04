import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const grid = readFileSync(new URL('./TableGrid.tsx', import.meta.url), 'utf8')
const header = readFileSync(new URL('./HeaderCell.tsx', import.meta.url), 'utf8')

describe('virtual data table semantics', () => {
  test('publishes table dimensions and virtual row coordinates without claiming grid interaction', () => {
    expect(grid).toContain('role="table"')
    expect(grid).toContain('aria-colcount={columns.length + 1}')
    expect(grid).toContain('aria-rowcount={accessibleRowCount}')
    expect(grid).toContain('const accessibleDataRowCount = Math.max(total, rows.length)')
    expect(grid).toContain('const draftRowOffset = draft ? 1 : 0')
    expect(grid).toContain('role="rowgroup"')
    expect(grid).toContain('aria-rowindex={vi.index + 2 + draftRowOffset}')
    expect(grid).toContain('accessibleDataRowCount + draftRowOffset + insertIndex + 2')
    expect(grid).not.toContain('role="grid"')
  })

  test('labels row headers, cells, column positions and sort direction', () => {
    expect(grid).toContain('role="rowheader"')
    expect(grid).toContain('role="cell"')
    expect(grid).toContain('aria-colindex={columnIndex + 2}')
    expect(header).toContain('role="columnheader"')
    expect(header).toContain("'descending'")
    expect(header).toContain("'ascending'")
  })
})
