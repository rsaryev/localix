import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./UnifiedBreadcrumb.tsx', import.meta.url), 'utf8')

/** The trail's markup, from the nav element to its close. */
const trail = source.slice(
  source.indexOf('<WorkbenchBreadcrumb'),
  source.indexOf('</WorkbenchBreadcrumb>'),
)

test('the path contains locations without an agent picker or agent-specific chat filter', () => {
  expect(source).not.toContain('Switch agent')
  expect(source).not.toContain('useCrumbAgents')
  expect(source).not.toContain('currentAgent')
  expect(source).toContain('activeSessionId: sessionSeg?.session.id ?? activeSessionId')
  expect(trail).toContain('ariaLabel="Switch workspace"')
  expect(trail).toContain('ariaLabel="Switch session"')
  expect(trail).toContain('subSegs.map')
})

test('the path does not duplicate the new-chat action', () => {
  expect(trail).not.toContain('aria-label="New chat"')
  expect(source).not.toContain('requestNewChat')
  expect(source).not.toContain('<Plus')
})

test('segments keep their width inside the scrollable path', () => {
  expect(source).toContain("const ANCESTOR_CRUMB = 'flex min-w-0 shrink-0 items-center'")
  expect(source).toContain("const CURRENT_CRUMB = 'flex min-w-0 shrink-0 items-center'")
})

test('parent navigation leads the path', () => {
  expect(source.indexOf('aria-label="Back to parent session"')).toBeLessThan(
    source.indexOf('<WorkbenchBreadcrumb'),
  )
})

test('every level remains available and navigation reveals the end of the path', () => {
  expect(trail).toContain('scrollable')
  expect(trail).toContain('scrollToEndKey=')
  expect(trail).toContain('segments')
  expect(source).not.toContain('SessionPathOverflow')
})
