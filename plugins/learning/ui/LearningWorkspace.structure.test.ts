import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const workspace = readFileSync(new URL('./LearningWorkspace.tsx', import.meta.url), 'utf8')
const library = readFileSync(new URL('./LearningLibrary.tsx', import.meta.url), 'utf8')
const steps = readFileSync(new URL('./components/LessonSteps.tsx', import.meta.url), 'utf8')

describe('learning workbench geometry', () => {
  test('renders the course path on the shared breadcrumb at the panel-header measure', () => {
    expect(workspace).toMatch(/<WorkbenchBreadcrumb\s+aria-label="Course path"/)
    expect(workspace).toContain('className="h-[var(--panel-header-height)] shrink-0 px-3"')
  })

  test('renders the load failure on the host problem line, not a local strip', () => {
    expect(workspace).toContain('<ProblemLine')
    expect(workspace).not.toContain('tone="error"')
    expect(workspace).not.toContain('border-b border-status-error/20')
  })

  test('keeps lesson chrome heights on the geometry scale', () => {
    expect(steps).toContain('min-h-[var(--chrome-control-touch)]')
    for (const source of [workspace, steps]) {
      expect(source).not.toMatch(/\bmin-h-(?:8|9|11)\b/)
    }
  })

  test('lets the course grid span its pane instead of capping a data surface', () => {
    expect(library).not.toMatch(/grid[^"]*max-w-/)
    expect(library).toContain('className="grid gap-2 @3xl:grid-cols-2 @6xl:grid-cols-3"')
  })
})
