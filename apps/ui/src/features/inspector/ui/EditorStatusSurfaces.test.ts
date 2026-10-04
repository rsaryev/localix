import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(import.meta.dir, path), 'utf8')

test('editor status strips use semantic icons without permanent status fills', () => {
  const fileTab = read('./FileTab.tsx')
  const conflictBar = read('./ConflictCompareBar.tsx')
  const surfaces = [fileTab, conflictBar].join('\n')

  // A save failure is no longer a strip of its own: it is one ProblemLine, whose glyph comes
  // from the shared severity table. Only the conflict banner (a decision, not a report) stays.
  expect(fileTab).toContain('<ProblemLine')
  expect(fileTab).toContain('<TriangleAlert')
  expect(conflictBar).toContain('<TriangleAlert')
  expect(fileTab).toContain('<WorkbenchNoticeBar')
  expect(conflictBar).toContain('<WorkbenchNoticeBar')
  expect(surfaces).not.toMatch(/bg-status-(?:error|warning|success)\/(?:5|10)\b/)
})

test('editor status bar uses shared geometry and exposes current values in accessible names', () => {
  const statusBar = read('./EditorStatusBar.tsx')

  expect(statusBar).toContain('<WorkbenchStatusBar aria-label="Editor status" align="end">')
  expect(statusBar).toContain('aria-label={`Cursor position: ${position}`}')
  expect(statusBar).toContain('aria-label={`Indentation: ${indentLabel}')
  expect(statusBar).toContain('aria-label={`Language mode: ${languageLabel(language)}')
  expect(statusBar).not.toContain('h-6')
})

/**
 * Editor status is contributed into the ONE window status bar; it never docks a
 * second bar under the editor. This pins that wiring so the doubled
 * 2 × `--statusbar-height` chrome cannot come back by accident.
 */
test('editor status is contributed into the app status bar by the FOCUSED editor only', () => {
  const fileTab = read('./FileTab.tsx')

  expect(fileTab).toContain('useWorkItemFocused')
  expect(fileTab).toContain('<WorkbenchStatusContribution active={workItemFocused}>')
  // Exactly one render site, and it is the contributed one — a second bare
  // `<EditorStatusBar>` would put the bar back under the editor.
  expect(fileTab.match(/<EditorStatusBar\b/g)?.length).toBe(1)
  expect(fileTab).toContain('</WorkbenchStatusContribution>')
})
