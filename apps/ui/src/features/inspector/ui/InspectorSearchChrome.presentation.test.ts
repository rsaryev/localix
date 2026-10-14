import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const readSource = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), 'utf8')

describe('inspector search chrome', () => {
  test('uses a shared toolbar for explorer filters', () => {
    const explorer = readSource('FileTreeSidebar.tsx')

    expect(explorer).toContain('aria-label="File search controls"')
    expect(explorer).toContain('tone="sidebar"')
    expect(explorer).not.toContain('border-b border-sidebar-border px-2 py-1.5')
  })

  test('keeps problem counts and search results on the shared status geometry', () => {
    const problems = readSource('ProblemsTab.tsx')
    const contentSearch = readSource('search/ContentSearchView.tsx')

    expect(problems).toContain('aria-label="Filtered problem counts"')
    expect(problems).toContain('<WorkbenchStatusBar')
    expect(contentSearch).toContain('aria-label="Content search summary"')
    expect(contentSearch).toContain('tone="sidebar"')
  })

  test('composes file-search inputs and toggles from shared controls', () => {
    const controls = readSource('search/SearchTreeView.tsx')
    const contentSearch = readSource('search/ContentSearchView.tsx')

    expect(controls).toContain('<IconButton')
    expect(controls).toContain('<InputGroup')
    expect(contentSearch).toContain('<InputGroup')
    expect(contentSearch).toContain('h-[var(--chrome-control-xs)]')
    expect(controls).not.toMatch(/\b(?:h|w)-5\b/)
  })
})
