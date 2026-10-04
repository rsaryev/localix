import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./UnifiedBreadcrumb.tsx', import.meta.url), 'utf8')

/** The trail's markup, from the nav element to its close. */
const trail = source.slice(
  source.indexOf('<WorkbenchBreadcrumb'),
  source.indexOf('</WorkbenchBreadcrumb>'),
)

test('the new-chat action ENDS the chain, inside the trail', () => {
  // It used to sit outside the `<ol>`, after the back button, where it read as a toolbar button
  // that happened to be nearby. A path says where you are; its last item is what you start next,
  // and being in the list is what puts it at the end of the trail's tab order rather than after
  // an unrelated action.
  expect(trail).toContain('aria-label="New chat"')
  expect(trail.indexOf('aria-label="New chat"')).toBeGreaterThan(trail.indexOf('visibleSubs.map'))
  // Nothing follows it in the chain.
  expect(trail.slice(trail.indexOf('aria-label="New chat"'))).not.toContain('<li')
})

test('the trailing action cannot be squeezed out of a deep path', () => {
  const action = trail.slice(trail.lastIndexOf('<li', trail.indexOf('aria-label="New chat"')))
  expect(action).toContain('shrink-0')
  // Ancestors give up their width first, so a long lineage truncates the crumbs a person needs
  // least rather than clipping the affordance at the end.
  expect(source).toContain("const ANCESTOR_CRUMB = 'flex min-w-0 shrink-[3] items-center'")
  expect(source).toContain("const CURRENT_CRUMB = 'flex min-w-0 shrink items-center'")
})

test('parent navigation leads the row so the chain can end with its own action', () => {
  expect(source.indexOf('aria-label="Back to parent session"')).toBeLessThan(
    source.indexOf('<WorkbenchBreadcrumb'),
  )
})

test('the visible depth is measured, not assumed', () => {
  // A flat cap at every width shrank three crumbs into unreadable stubs on a narrow titlebar.
  expect(source).toContain('visibleSubsessionCount(pathWidth)')
  expect(source).toContain('useElementWidth(pathRef)')
  expect(source).not.toContain('const MAX_SUBSESSION_SEGMENTS')
})

test('one new-chat handler, reused — the move did not fork the action', () => {
  expect(source.match(/requestNewChat/g)?.length).toBe(2) // the import and the one call site
  expect(source).toContain('tooltip={hint(')
})
