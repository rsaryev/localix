import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const uiRoot = resolve(import.meta.dir)
const read = (path: string) => readFileSync(resolve(uiRoot, path), 'utf8')

describe('Documents workbench geometry', () => {
  test('builds toolbar controls from primitives on the geometry scale', () => {
    const toolbar = read('table/TableToolbar.tsx')
    expect(toolbar).toContain('<WorkbenchToolbar wrap aria-label="Table controls">')
    expect(toolbar).toContain('<DropdownMenuTrigger asChild>')
    expect(toolbar).not.toMatch(/\bh-(?:7|8|9|10)\b/)
    expect(toolbar).not.toMatch(/<WorkbenchToolbar[^>]*className=/s)
  })

  test('renders the truncation notice through the shared in-flow primitive', () => {
    const tab = read('DocumentFileTab.tsx')
    expect(tab).toContain('<WorkbenchNoticeBar')
    expect(tab).not.toContain('border-b border-status-warning/20')
  })
})
