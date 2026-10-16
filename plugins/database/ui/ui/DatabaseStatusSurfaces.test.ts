import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('database system feedback stays flat while data-state colors remain available', () => {
  const preview = read('./SqlPreviewDialog.tsx')
  const results = read('./sql-console/ResultsArea.tsx')
  // The table workspace's failure line lives in its data view since the workspace was split.
  const tableData = read('./TableDataWorkspace.tsx') + read('./table-data/DataView.tsx')
  const structure = read('./TableStructureEditor.tsx')
  const runBar = read('./sql-console/RunBar.tsx')
  const sidebar = read('./DatabaseSidebar.tsx')
  const feedbackSurfaces = [preview, results, tableData, structure, runBar, sidebar].join('\n')

  expect(preview).toContain('<TriangleAlert')
  // A FAILURE is the host's line, not a glyph this plugin picked: same look, and it reaches the
  // Event Center. Warnings and status dots stay local — they are not failures.
  expect(preview).toContain('<ProblemLine')
  expect(results).toContain('<ProblemLine')
  expect(tableData).toContain('<ProblemLine')
  expect(structure).toContain('<ProblemLine')
  expect(runBar).toContain('<StatusDot')
  expect(sidebar).toContain('<ProblemLine')
  expect(feedbackSurfaces).not.toMatch(/bg-status-(?:error|warning|success)\/(?:5|10)\b/)
  expect(feedbackSurfaces).not.toContain('bg-surface-raised/25')
})
